/**
 * Open banking. Consent always happens on the provider's hosted screen;
 * Sagolik never asks for online-banking credentials. Access tokens are
 * encrypted at rest in a table with no client access and never logged.
 */
import { assertStepUp } from "@sagolik/auth";
import { isFlagEnabled } from "@sagolik/config";
import { ProviderError } from "@sagolik/integrations";
import { decryptField, encryptField, keyVersionOf } from "@sagolik/security";
import { type BankAccount, type BankConnection, CreateBankConnectionInput } from "@sagolik/types";
import type { TransactionSnapshot } from "@sagolik/workflow";
import { type ServiceContext, requireUser } from "../context";
import { AppError, badRequest, conflict, notFound } from "../errors";
import { audit, emit } from "../events";
import { moneyCaller, viaMoney } from "../money/bridge";
import { type MoneyBankConnection, MoneyServiceError } from "../money/client";
import { loadAuthorized } from "../snapshot";
import { newId, nowIso } from "../util";
import { reconcile } from "./engine";
import { notify } from "./notifications";
import { completeTasksFor } from "./transactions";
import { fundsStillNeeded } from "./views";

/*
 * Two modes. Without the money service, the web app talks to the banking
 * provider and keeps the access token encrypted in its own database. With
 * MONEY_SERVICE_URL set, the Go money service talks to Plaid and holds the
 * token; the web app keeps a masked mirror (bank_connections/bank_accounts,
 * no secret row) so pages and tasks work the same way.
 */
const MONEY_LINK = "link:";
const MONEY_CONN = "money:";

export function moneyConnectionId(conn: BankConnection): string | null {
  return conn.externalConnectionId?.startsWith(MONEY_CONN) ? conn.externalConnectionId.slice(MONEY_CONN.length) : null;
}

function assertBankingEnabled(ctx: ServiceContext) {
  if (!isFlagEnabled("bank_integrations", { overrides: ctx.flags })) throw badRequest("Bank connections aren't available right now.");
}

/** How the connect form should look: Plaid (direct or via the money service) shows its own bank search. */
export function bankConnectMode(ctx: ServiceContext): { chooseAtProvider: boolean; providerName: string } {
  if (ctx.money) return { chooseAtProvider: true, providerName: "Plaid" };
  const bank = ctx.providers.banking;
  return { chooseAtProvider: bank.providerChoosesInstitution, providerName: bank.info.displayName };
}

export async function listInstitutions(ctx: ServiceContext, country: string) {
  assertBankingEnabled(ctx);
  if (bankConnectMode(ctx).chooseAtProvider) return [];
  if (!ctx.providers.banking.supportedCountries.includes(country.toUpperCase() as never)) return [];
  return ctx.providers.banking.listInstitutions(country);
}

export async function startBankConnection(ctx: ServiceContext, raw: unknown, callbackUrl: string) {
  const actor = requireUser(ctx);
  assertBankingEnabled(ctx);
  const input = CreateBankConnectionInput.parse(raw);
  if (ctx.money) return startMoneyBankLink(ctx, input.transactionId);
  if (input.transactionId) await loadAuthorized(ctx, input.transactionId, "transaction.view");
  const bank = ctx.providers.banking;
  // Providers with their own bank search (Plaid) don't need our list.
  const institution = input.institutionId
    ? await bank.getInstitution(input.institutionId)
    : bank.providerChoosesInstitution
      ? { id: "", name: "Your bank", country: input.country, logoInitials: "BK" }
      : null;
  if (!institution) throw badRequest("We couldn't find that bank. Please choose another.");
  const now = nowIso(ctx);
  const conn = await ctx.writer.bank_connections.insert({
    id: newId(),
    userId: actor.userId,
    transactionId: input.transactionId ?? null,
    provider: ctx.providers.banking.info.id,
    institutionId: institution.id || "chosen_at_provider",
    institutionName: institution.name,
    externalConnectionId: null,
    status: "connecting",
    consentCreatedAt: null,
    consentExpiresAt: null,
    lastSyncedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  });
  const started = await ctx.providers.banking.connectBank({
    userId: actor.userId,
    fullName: actor.displayName,
    institutionId: institution.id || undefined,
    country: input.country,
    redirectUri: callbackUrl,
    state: conn.id,
  });
  // Provider-side correlation (e.g. Plaid link_token) is kept until the exchange.
  if (started.state !== conn.id) await ctx.writer.bank_connections.update(conn.id, { externalConnectionId: started.state });
  return { connectionId: conn.id, redirectUrl: started.redirectUrl };
}

export async function completeBankConnection(ctx: ServiceContext, state: string, code: string): Promise<BankConnection> {
  const actor = requireUser(ctx);
  const conn = await ctx.db.bank_connections.get(state);
  // The callback must come back to the same person who started it.
  if (!conn || conn.userId !== actor.userId) throw notFound("That bank connection request");
  if (conn.status !== "connecting" && conn.status !== "reauthentication_required") throw conflict("This bank connection was already completed.");

  let exchanged;
  try {
    exchanged = await ctx.providers.banking.exchangeAuthorization({ code, state: conn.externalConnectionId ?? conn.id });
  } catch (e) {
    await ctx.writer.bank_connections.update(conn.id, { status: "error", lastError: e instanceof ProviderError ? e.userMessage : "Connection failed." });
    throw e;
  }
  const encrypted = encryptField(exchanged.accessToken, ctx.keyRing, `bank_connection:${conn.id}`);
  const existingSecret = await ctx.writer.bank_connection_secrets.findOne({ connectionId: conn.id });
  if (existingSecret) throw conflict("This bank connection was already completed.");
  await ctx.writer.bank_connection_secrets.insert({
    id: newId(),
    connectionId: conn.id,
    encryptedAccessToken: encrypted,
    keyVersion: Number(keyVersionOf(encrypted).replace(/^v/, "")) || 1,
    createdAt: nowIso(ctx),
  });
  const connected = await ctx.writer.bank_connections.update(conn.id, {
    status: "connected",
    externalConnectionId: exchanged.externalConnectionId,
    institutionId: exchanged.institution.id,
    institutionName: exchanged.institution.name,
    consentCreatedAt: exchanged.consentCreatedAt,
    consentExpiresAt: exchanged.consentExpiresAt,
    lastError: null,
  });
  await syncAccounts(ctx, connected, exchanged.accessToken, actor.displayName);
  await audit(ctx, {
    action: "bank.connected",
    resourceType: "bank_connection",
    resourceId: conn.id,
    transactionId: conn.transactionId,
    metadata: { provider: conn.provider, institution: exchanged.institution.name },
  });
  await emit(ctx, { type: "bank.connected", aggregateType: "bank_connection", aggregateId: conn.id, transactionId: conn.transactionId });
  if (conn.transactionId) {
    const participant = await ctx.writer.transaction_participants.findOne({ transactionId: conn.transactionId, userId: actor.userId });
    if (participant) await completeTasksFor(ctx, conn.transactionId, "connect_bank", participant.id);
    await reconcile(ctx, conn.transactionId);
  }
  return connected;
}

async function syncAccounts(ctx: ServiceContext, conn: BankConnection, accessToken: string, expectedName: string) {
  const bank = ctx.providers.banking;
  const [accounts, balances, ownership] = await Promise.all([
    bank.listAccounts(accessToken),
    bank.getBalances(accessToken),
    bank.verifyAccountOwnership(accessToken, expectedName),
  ]);
  const now = nowIso(ctx);
  const existing = await ctx.writer.bank_accounts.find({ connectionId: conn.id });
  // Closing funds come from cash accounts only; credit cards, loans and investments aren't kept.
  for (const a of accounts.filter((x) => x.type === "checking" || x.type === "savings")) {
    const bal = balances.find((b) => b.externalAccountId === a.externalAccountId);
    const own = ownership.find((o) => o.externalAccountId === a.externalAccountId);
    const patch = {
      name: a.name,
      mask: a.mask,
      currency: a.currency,
      availableBalance: bal?.available ?? null,
      currentBalance: bal?.current ?? null,
      balanceAsOf: bal?.asOf ?? null,
      ownerNames: own?.ownerNames ?? [],
      ownershipVerified: own?.match ?? false,
      ownershipVerifiedAt: own?.match ? now : null,
    };
    const row = existing.find((r) => r.externalAccountId === a.externalAccountId);
    if (row) await ctx.writer.bank_accounts.update(row.id, patch);
    else
      await ctx.writer.bank_accounts.insert({
        id: newId(),
        connectionId: conn.id,
        userId: conn.userId,
        externalAccountId: a.externalAccountId,
        ...patch,
        createdAt: now,
        updatedAt: now,
      });
  }
  await ctx.writer.bank_connections.update(conn.id, { lastSyncedAt: now });
}

export async function accessTokenFor(ctx: ServiceContext, connectionId: string): Promise<string> {
  const secret = await ctx.writer.bank_connection_secrets.findOne({ connectionId });
  if (!secret) throw new AppError("provider_error", "Your bank needs you to reconnect before we can refresh the account.", 409);
  return decryptField(secret.encryptedAccessToken, ctx.keyRing, `bank_connection:${connectionId}`);
}

export async function refreshBankConnection(ctx: ServiceContext, connectionId: string) {
  const actor = requireUser(ctx);
  const conn = await ctx.db.bank_connections.get(connectionId);
  if (!conn || conn.userId !== actor.userId) throw notFound("That bank connection");
  if (conn.status === "revoked") throw conflict("This bank was disconnected. Connect it again to refresh.");
  const moneyId = moneyConnectionId(conn);
  if (moneyId) return refreshMoneyConnection(ctx, conn, moneyId);
  try {
    const token = await accessTokenFor(ctx, connectionId);
    await syncAccounts(ctx, conn, token, actor.displayName);
    await ctx.writer.bank_connections.update(connectionId, { status: "connected", lastError: null });
    await audit(ctx, { action: "bank.refreshed", resourceType: "bank_connection", resourceId: connectionId, transactionId: conn.transactionId });
    return { status: "connected" as const, message: null };
  } catch (e) {
    if (e instanceof ProviderError && e.opts.action === "reconnect_bank") {
      await ctx.writer.bank_connections.update(connectionId, { status: "reauthentication_required", lastError: e.userMessage });
      ctx.log.warn("bank refresh requires reauth", { provider: e.provider, code: e.code, connectionId });
      await notify(ctx, {
        userIds: [actor.userId],
        transactionId: conn.transactionId,
        kind: "bank_reconnect",
        title: `${conn.institutionName} needs you to reconnect`,
        body: e.userMessage,
        linkPath: "/app/settings/banks",
      });
      await emit(ctx, { type: "bank.reauth_required", aggregateType: "bank_connection", aggregateId: connectionId, transactionId: conn.transactionId });
      return { status: "reauthentication_required" as const, message: e.userMessage };
    }
    throw e;
  }
}

export async function disconnectBank(ctx: ServiceContext, connectionId: string) {
  const actor = requireUser(ctx);
  assertStepUp(actor, "bank.disconnect", ctx.now().getTime());
  const conn = await ctx.db.bank_connections.get(connectionId);
  if (!conn || conn.userId !== actor.userId) throw notFound("That bank connection");
  if (conn.status === "revoked") return conn;
  const moneyId = moneyConnectionId(conn);
  if (moneyId && conn.transactionId) {
    const s = await loadAuthorized(ctx, conn.transactionId, "transaction.view");
    await viaMoney(() => ctx.money!.disconnectBank(moneyCaller(ctx, s, "payment.initiate"), moneyId));
    const updated = await ctx.writer.bank_connections.update(connectionId, { status: "revoked" });
    await audit(ctx, { action: "bank.disconnected", resourceType: "bank_connection", resourceId: connectionId, transactionId: conn.transactionId });
    return updated;
  }
  try {
    await ctx.providers.banking.disconnectBank(await accessTokenFor(ctx, connectionId));
  } catch (e) {
    ctx.log.warn("provider disconnect failed; revoking locally", { connectionId, error: e instanceof ProviderError ? e.code : String(e) });
  }
  const updated = await ctx.writer.bank_connections.update(connectionId, { status: "revoked" });
  await audit(ctx, { action: "bank.disconnected", resourceType: "bank_connection", resourceId: connectionId, transactionId: conn.transactionId });
  return updated;
}

export interface BankOverview {
  connection: BankConnection;
  accounts: BankAccount[];
}

/** The signed-in person's own connections. Account numbers are never loaded — only masks. */
export async function myBankConnections(ctx: ServiceContext): Promise<BankOverview[]> {
  const actor = requireUser(ctx);
  const conns = await ctx.db.bank_connections.find({ userId: actor.userId }, { orderBy: "createdAt", ascending: false });
  const accounts = conns.length ? await ctx.db.bank_accounts.find({ connectionId: conns.map((c) => c.id) }) : [];
  return conns
    .filter((c) => c.status !== "connecting")
    .map((c) => ({ connection: c, accounts: accounts.filter((a) => a.connectionId === c.id) }));
}

// ---------------------------------------------------------------- money service mode

async function startMoneyBankLink(ctx: ServiceContext, transactionId: string | undefined) {
  const actor = requireUser(ctx);
  if (!transactionId) throw badRequest("Connect your bank from the closing it's for.");
  const s = await loadAuthorized(ctx, transactionId, "transaction.view");
  const started = await viaMoney(() => ctx.money!.startBankLink(moneyCaller(ctx, s, "payment.initiate"), { legalName: actor.displayName }));
  const now = nowIso(ctx);
  const conn = await ctx.writer.bank_connections.insert({
    id: newId(),
    userId: actor.userId,
    transactionId,
    provider: "plaid",
    institutionId: "chosen_at_provider",
    institutionName: "Your bank",
    externalConnectionId: `${MONEY_LINK}${started.linkId}`,
    status: "connecting",
    consentCreatedAt: null,
    consentExpiresAt: null,
    lastSyncedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  });
  return { connectionId: conn.id, redirectUrl: started.hostedLinkUrl };
}

/** Plaid sent the person back (?link=…): finish in the money service and mirror the masked result. */
export async function completeMoneyBankLink(ctx: ServiceContext, linkId: string): Promise<BankConnection> {
  const actor = requireUser(ctx);
  if (!ctx.money) throw notFound("That bank connection request");
  const conn = await ctx.db.bank_connections.findOne({ externalConnectionId: `${MONEY_LINK}${linkId}` });
  if (!conn || conn.userId !== actor.userId || !conn.transactionId) throw notFound("That bank connection request");
  const s = await loadAuthorized(ctx, conn.transactionId, "transaction.view");
  let result: MoneyBankConnection;
  try {
    ({ connection: result } = await ctx.money.completeBankLink(moneyCaller(ctx, s, "payment.initiate"), linkId, { legalName: actor.displayName }));
  } catch (e) {
    if (e instanceof MoneyServiceError) {
      await ctx.writer.bank_connections.update(conn.id, { status: "error", lastError: e.userMessage });
      throw new AppError(e.code, e.userMessage, e.status);
    }
    throw e;
  }
  const connected = await mirrorMoneyConnection(ctx, conn, result);
  await audit(ctx, {
    action: "bank.connected",
    resourceType: "bank_connection",
    resourceId: conn.id,
    transactionId: conn.transactionId,
    metadata: { provider: "plaid", institution: result.institutionName, via: "money_service" },
  });
  await emit(ctx, { type: "bank.connected", aggregateType: "bank_connection", aggregateId: conn.id, transactionId: conn.transactionId });
  const participant = await ctx.writer.transaction_participants.findOne({ transactionId: conn.transactionId, userId: actor.userId });
  if (participant) await completeTasksFor(ctx, conn.transactionId, "connect_bank", participant.id);
  await reconcile(ctx, conn.transactionId);
  return connected;
}

/** Copies the money service's masked view into the web app's mirror rows. */
async function mirrorMoneyConnection(ctx: ServiceContext, conn: BankConnection, m: MoneyBankConnection): Promise<BankConnection> {
  const now = nowIso(ctx);
  const updated = await ctx.writer.bank_connections.update(conn.id, {
    status: m.status,
    externalConnectionId: `${MONEY_CONN}${m.id}`,
    institutionName: m.institutionName,
    consentCreatedAt: conn.consentCreatedAt ?? m.createdAt,
    consentExpiresAt: m.consentExpiresAt,
    lastSyncedAt: now,
    lastError: null,
  });
  const existing = await ctx.writer.bank_accounts.find({ connectionId: conn.id });
  for (const a of m.accounts) {
    const check = a.lastFundsCheck;
    const patch = {
      name: a.name,
      mask: a.mask,
      currency: (a.currency || "USD") as BankAccount["currency"],
      ownerNames: [],
      ownershipVerified: a.ownershipMatched === true,
      ownershipVerifiedAt: a.ownershipMatched ? a.ownershipCheckedAt : null,
      ...(check && check.checkedBy === conn.userId ? { availableBalance: check.available, currentBalance: check.current, balanceAsOf: check.checkedAt } : {}),
    };
    const row = existing.find((r) => r.externalAccountId === a.id);
    if (row) await ctx.writer.bank_accounts.update(row.id, patch);
    else
      await ctx.writer.bank_accounts.insert({
        id: newId(),
        connectionId: conn.id,
        userId: conn.userId,
        externalAccountId: a.id,
        availableBalance: null,
        currentBalance: null,
        balanceAsOf: null,
        ...patch,
        createdAt: now,
        updatedAt: now,
      });
  }
  return updated;
}

async function refreshMoneyConnection(ctx: ServiceContext, conn: BankConnection, moneyId: string) {
  const actor = requireUser(ctx);
  if (!conn.transactionId) throw notFound("That bank connection");
  const s = await loadAuthorized(ctx, conn.transactionId, "transaction.view");
  try {
    const { connection } = await ctx.money!.refreshBankConnection(moneyCaller(ctx, s, "payment.initiate"), moneyId, { legalName: actor.displayName });
    await mirrorMoneyConnection(ctx, conn, connection);
    await audit(ctx, { action: "bank.refreshed", resourceType: "bank_connection", resourceId: conn.id, transactionId: conn.transactionId });
    return { status: "connected" as const, message: null };
  } catch (e) {
    if (e instanceof MoneyServiceError && e.reconnectRequired) {
      await ctx.writer.bank_connections.update(conn.id, { status: "reauthentication_required", lastError: e.userMessage });
      return { status: "reauthentication_required" as const, message: e.userMessage };
    }
    if (e instanceof MoneyServiceError) throw new AppError(e.code, e.userMessage, e.status);
    throw e;
  }
}

// ---------------------------------------------------------------- proof of funds

export interface FundsCheckResult {
  sufficient: boolean;
  available: number | null;
  required: number;
  currency: string;
  checkedAt: string;
}

/**
 * Proof of funds: compares one of the buyer's own accounts, in real time,
 * with what the closing still needs. The amount comes from the transaction,
 * never from the request. With the money service, the result is recorded
 * there and escrow sees it (the result, not the balance).
 */
export async function checkFundsForClosing(ctx: ServiceContext, connectionId: string, accountId: string): Promise<FundsCheckResult> {
  const actor = requireUser(ctx);
  const conn = await ctx.db.bank_connections.get(connectionId);
  if (!conn || conn.userId !== actor.userId || !conn.transactionId) throw notFound("That bank account");
  if (conn.status !== "connected") throw conflict("Reconnect this bank before checking funds.");
  const account = await ctx.db.bank_accounts.get(accountId);
  if (!account || account.connectionId !== conn.id) throw notFound("That bank account");
  const s = await loadAuthorized(ctx, conn.transactionId, "transaction.view");
  const required = fundsStillNeeded(s, nowIso(ctx));
  if (required <= 0) throw conflict("Nothing is outstanding for closing right now.");
  const currency = s.transaction.currency;
  if (account.currency !== currency) throw badRequest("This account holds a different currency from the closing.");

  const moneyId = moneyConnectionId(conn);
  if (moneyId) {
    const caller = moneyCaller(ctx, s, "payment.initiate");
    const { fundsCheck } = await viaMoney(() => ctx.money!.proofOfFunds(caller, moneyId, account.externalAccountId, { requiredAmount: required, currency }));
    await ctx.writer.bank_accounts.update(account.id, { availableBalance: fundsCheck.available, currentBalance: fundsCheck.current, balanceAsOf: fundsCheck.checkedAt });
    return { sufficient: fundsCheck.sufficient, available: fundsCheck.available, required, currency, checkedAt: fundsCheck.checkedAt };
  }

  const balances = await ctx.providers.banking.getBalances(await accessTokenFor(ctx, conn.id));
  const bal = balances.find((b) => b.externalAccountId === account.externalAccountId);
  if (!bal) throw conflict("Your bank didn't return this account. Please reconnect it.");
  const checkedAt = nowIso(ctx);
  await ctx.writer.bank_accounts.update(account.id, { availableBalance: bal.available, currentBalance: bal.current, balanceAsOf: bal.asOf });
  const sufficient = bal.available !== null && bal.available >= required;
  await audit(ctx, {
    action: "bank.funds_checked",
    resourceType: "bank_account",
    resourceId: account.id,
    transactionId: conn.transactionId,
    metadata: { required, currency, sufficient },
  });
  return { sufficient, available: bal.available, required, currency, checkedAt };
}

/** Proof-of-funds results for the transaction's other parties (money service mode only). */
export async function proofOfFundsFor(ctx: ServiceContext, s: TransactionSnapshot) {
  if (!ctx.money) return [];
  try {
    const { proofOfFunds } = await ctx.money.funds(moneyCaller(ctx, s, "financial.view"));
    return proofOfFunds ?? [];
  } catch (e) {
    ctx.log.warn("proof of funds unavailable", { error: e instanceof MoneyServiceError ? e.code : String(e) });
    return [];
  }
}
