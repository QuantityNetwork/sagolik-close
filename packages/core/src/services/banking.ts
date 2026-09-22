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
import { type ServiceContext, requireUser } from "../context";
import { AppError, badRequest, conflict, notFound } from "../errors";
import { audit, emit } from "../events";
import { loadAuthorized } from "../snapshot";
import { newId, nowIso } from "../util";
import { reconcile } from "./engine";
import { notify } from "./notifications";
import { completeTasksFor } from "./transactions";

function assertBankingEnabled(ctx: ServiceContext) {
  if (!isFlagEnabled("bank_integrations", { overrides: ctx.flags })) throw badRequest("Bank connections aren't available right now.");
}

export async function listInstitutions(ctx: ServiceContext, country: string) {
  assertBankingEnabled(ctx);
  if (!ctx.providers.banking.supportedCountries.includes(country.toUpperCase() as never)) return [];
  return ctx.providers.banking.listInstitutions(country);
}

export async function startBankConnection(ctx: ServiceContext, raw: unknown, callbackUrl: string) {
  const actor = requireUser(ctx);
  assertBankingEnabled(ctx);
  const input = CreateBankConnectionInput.parse(raw);
  if (input.transactionId) await loadAuthorized(ctx, input.transactionId, "transaction.view");
  const institution = await ctx.providers.banking.getInstitution(input.institutionId);
  if (!institution) throw badRequest("We couldn't find that bank. Please choose another.");
  const now = nowIso(ctx);
  const conn = await ctx.writer.bank_connections.insert({
    id: newId(),
    userId: actor.userId,
    transactionId: input.transactionId ?? null,
    provider: ctx.providers.banking.info.id,
    institutionId: institution.id,
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
    institutionId: institution.id,
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
  for (const a of accounts) {
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

async function accessTokenFor(ctx: ServiceContext, connectionId: string): Promise<string> {
  const secret = await ctx.writer.bank_connection_secrets.findOne({ connectionId });
  if (!secret) throw new AppError("provider_error", "Your bank needs you to reconnect before we can refresh the account.", 409);
  return decryptField(secret.encryptedAccessToken, ctx.keyRing, `bank_connection:${connectionId}`);
}

export async function refreshBankConnection(ctx: ServiceContext, connectionId: string) {
  const actor = requireUser(ctx);
  const conn = await ctx.db.bank_connections.get(connectionId);
  if (!conn || conn.userId !== actor.userId) throw notFound("That bank connection");
  if (conn.status === "revoked") throw conflict("This bank was disconnected. Connect it again to refresh.");
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
