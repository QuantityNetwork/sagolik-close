/**
 * Wallet proof of funds. A person proves they control a wallet by signing a
 * short message, which is free and moves nothing. Sagolik then reads the
 * wallet's USDC balance on Base. Sagolik never holds wallet keys, never asks
 * for spending approval and never moves money. The closing's escrow and
 * verifiers see the result ("covers the amount still needed"), never the
 * balance or the address.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { can } from "@sagolik/auth";
import { LOCAL_SESSION_SECRET } from "@sagolik/config";
import type { ChainProvider } from "@sagolik/integrations";
import type { FundsCheck, WalletConnection } from "@sagolik/types";
import type { TransactionSnapshot } from "@sagolik/workflow";
import { type Address, getAddress, type Hex, isHex } from "viem";
import { type ServiceContext, requireUser } from "../context";
import { AppError, badRequest, conflict, notFound } from "../errors";
import { audit } from "../events";
import { accessContext, loadAuthorized } from "../snapshot";
import { newId, nowIso } from "../util";
import { fundsStillNeeded } from "./views";

const CHALLENGE_TTL_MS = 10 * 60_000;

interface ChallengePayload {
  v: 1;
  /** user, transaction, network, chain id, address, nonce, issued, expires */
  u: string;
  t: string;
  net: string;
  cid: number;
  a: Address;
  n: string;
  iat: number;
  exp: number;
}

export interface WalletChallenge {
  /** Opaque and signed by us: binds the message to this person, closing, wallet and time. */
  token: string;
  /** Exactly what the wallet shows and signs. */
  message: string;
  address: Address;
  networkLabel: string;
  expiresAt: string;
}

function chainFor(ctx: ServiceContext): ChainProvider {
  const chain = ctx.providers.chain;
  if (!chain) throw badRequest("Wallet proof of funds isn't available right now.");
  return chain;
}

function challengeKey(ctx: ServiceContext) {
  return ctx.env.SESSION_SECRET && ctx.env.SESSION_SECRET.length >= 32 ? ctx.env.SESSION_SECRET : LOCAL_SESSION_SECRET;
}

function mac(ctx: ServiceContext, body: string) {
  // Domain-separated from session cookies signed with the same secret.
  return createHmac("sha256", challengeKey(ctx)).update(`sagolik-close/wallet-challenge/v1:${body}`).digest("base64url");
}

function parseAddress(raw: string): Address {
  try {
    return getAddress(raw.trim());
  } catch {
    throw badRequest("That isn't a valid wallet address. It starts with 0x followed by 40 letters and numbers.");
  }
}

export function maskAddress(address: string): string {
  return `•••• ${address.slice(-4)}`;
}

function walletLabel(chain: ChainProvider, address: string) {
  return `USDC wallet on ${chain.info.networkLabel} ${maskAddress(address)}`;
}

function renderMessage(ctx: ServiceContext, p: ChallengePayload, reference: string, networkLabel: string): string {
  const host = new URL(ctx.env.APP_URL).host;
  return [
    `${host} asks you to confirm you control this wallet.`,
    "",
    `Wallet: ${p.a}`,
    `Network: ${networkLabel}`,
    `Purpose: proof of funds for closing ${reference}`,
    `Nonce: ${p.n}`,
    `Issued: ${new Date(p.iat).toISOString()}`,
    `Expires: ${new Date(p.exp).toISOString()}`,
    "",
    "Signing is free. It does not send money, approve spending or give anyone access to your wallet.",
  ].join("\n");
}

/** Proof of funds is for the people paying: the buyers. */
async function loadForPayer(ctx: ServiceContext, transactionId: string) {
  const s = await loadAuthorized(ctx, transactionId, "payment.initiate");
  if (s.transaction.currency !== "USD") throw badRequest("Wallet proof of funds counts USDC, so it's available for closings in US dollars.");
  return s;
}

/** Step 1: the message for a wallet to sign. */
export async function walletChallenge(ctx: ServiceContext, transactionId: string, rawAddress: string): Promise<WalletChallenge> {
  const actor = requireUser(ctx);
  const chain = chainFor(ctx);
  const s = await loadForPayer(ctx, transactionId);
  const now = ctx.now().getTime();
  const p: ChallengePayload = {
    v: 1,
    u: actor.userId,
    t: transactionId,
    net: chain.info.network,
    cid: chain.info.chainId,
    a: parseAddress(rawAddress),
    n: randomBytes(16).toString("hex"),
    iat: now,
    exp: now + CHALLENGE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  return {
    token: `${body}.${mac(ctx, body)}`,
    message: renderMessage(ctx, p, s.transaction.reference, chain.info.networkLabel),
    address: p.a,
    networkLabel: chain.info.networkLabel,
    expiresAt: new Date(p.exp).toISOString(),
  };
}

/** Reads a challenge back, but only for the person it was issued to and only while it's valid. */
export async function openWalletChallenge(ctx: ServiceContext, token: string): Promise<WalletChallenge & { transactionId: string; nonce: string }> {
  const actor = requireUser(ctx);
  const chain = chainFor(ctx);
  const [body, given] = token.split(".");
  const expired = new AppError("bad_request", "This signing request has expired. Please start again.", 400);
  if (!body || !given) throw expired;
  const a = Buffer.from(mac(ctx, body));
  const b = Buffer.from(given);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw expired;
  let p: ChallengePayload;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString()) as ChallengePayload;
  } catch {
    throw expired;
  }
  if (p.v !== 1 || p.u !== actor.userId || p.exp < ctx.now().getTime()) throw expired;
  if (p.net !== chain.info.network || p.cid !== chain.info.chainId) throw expired;
  const s = await loadForPayer(ctx, p.t);
  return {
    token,
    message: renderMessage(ctx, p, s.transaction.reference, chain.info.networkLabel),
    address: p.a,
    networkLabel: chain.info.networkLabel,
    expiresAt: new Date(p.exp).toISOString(),
    transactionId: p.t,
    nonce: p.n,
  };
}

/** Step 2: the signed message comes back. Verifies it, then reads the wallet's USDC balance. */
export async function connectWallet(ctx: ServiceContext, token: string, rawSignature: string): Promise<WalletConnection> {
  const actor = requireUser(ctx);
  const chain = chainFor(ctx);
  const c = await openWalletChallenge(ctx, token);
  const signature = rawSignature.trim() as Hex;
  if (!isHex(signature) || signature.length < 132) throw badRequest("That doesn't look like a wallet signature. Copy the whole signature, starting with 0x.");

  const replay = await ctx.writer.wallet_connections.findOne({ challengeNonce: c.nonce });
  if (replay) {
    if (replay.userId !== actor.userId) throw notFound("That signing request");
    return replay; // the same signature submitted twice
  }
  if (!(await chain.verifyWalletSignature({ address: c.address, message: c.message, signature }))) {
    throw badRequest("That signature doesn't match this wallet and message. Please sign again with the same wallet.");
  }

  const now = nowIso(ctx);
  const existing = await ctx.writer.wallet_connections.findOne({ transactionId: c.transactionId, userId: actor.userId, network: chain.info.network, address: c.address, status: "verified" });
  let wallet = existing
    ? await ctx.writer.wallet_connections.update(existing.id, { challengeNonce: c.nonce, verifiedAt: now })
    : await ctx.writer.wallet_connections.insert({
        id: newId(),
        userId: actor.userId,
        transactionId: c.transactionId,
        network: chain.info.network,
        chainId: chain.info.chainId,
        address: c.address,
        challengeNonce: c.nonce,
        status: "verified",
        verifiedAt: now,
        usdcBalance: null,
        balanceBlock: null,
        balanceAsOf: null,
        createdAt: now,
        updatedAt: now,
      });
  wallet = (await readBalance(ctx, chain, wallet).catch(() => null)) ?? wallet;
  const s = await loadAuthorized(ctx, c.transactionId, "transaction.view");
  await audit(ctx, {
    action: "wallet.connected",
    resourceType: "wallet_connection",
    resourceId: wallet.id,
    transactionId: c.transactionId,
    organizationId: s.transaction.organizationId,
    metadata: { network: chain.info.network, wallet: maskAddress(c.address) },
  });
  return wallet;
}

async function readBalance(ctx: ServiceContext, chain: ChainProvider, wallet: WalletConnection): Promise<WalletConnection> {
  const balance = await chain.usdcBalance(wallet.address as Address);
  return ctx.writer.wallet_connections.update(wallet.id, { usdcBalance: balance.cents, balanceBlock: balance.blockNumber, balanceAsOf: balance.asOf });
}

async function ownWallet(ctx: ServiceContext, walletId: string): Promise<{ wallet: WalletConnection; chain: ChainProvider }> {
  const actor = requireUser(ctx);
  const chain = chainFor(ctx);
  const wallet = await ctx.db.wallet_connections.get(walletId);
  if (!wallet || wallet.userId !== actor.userId || wallet.status !== "verified") throw notFound("That wallet");
  if (wallet.network !== chain.info.network) throw conflict(`This wallet was checked on another network. Add it again on ${chain.info.networkLabel}.`);
  return { wallet, chain };
}

export interface WalletFundsResult {
  sufficient: boolean;
  available: number;
  required: number;
  currency: string;
  checkedAt: string;
}

/**
 * Proof of funds from a wallet: its USDC balance (counted at face value,
 * 1 USDC = 1 USD), read now, against what the closing still needs. The
 * amount comes from the transaction, never from the request.
 */
export async function checkWalletFunds(ctx: ServiceContext, walletId: string): Promise<WalletFundsResult> {
  const actor = requireUser(ctx);
  const { wallet, chain } = await ownWallet(ctx, walletId);
  const s = await loadForPayer(ctx, wallet.transactionId);
  const required = fundsStillNeeded(s, nowIso(ctx));
  if (required <= 0) throw conflict("Nothing is outstanding for closing right now.");
  const updated = await readBalance(ctx, chain, wallet);
  const available = updated.usdcBalance ?? 0;
  const checkedAt = nowIso(ctx);
  const sufficient = available >= required;
  await recordFundsCheck(ctx, {
    transactionId: wallet.transactionId,
    userId: actor.userId,
    source: "wallet",
    sourceId: wallet.id,
    sourceLabel: walletLabel(chain, wallet.address),
    ownershipProven: true,
    requiredAmount: required,
    currency: s.transaction.currency,
    sufficient,
    checkedAt,
  });
  await audit(ctx, {
    action: "wallet.funds_checked",
    resourceType: "wallet_connection",
    resourceId: wallet.id,
    transactionId: wallet.transactionId,
    organizationId: s.transaction.organizationId,
    metadata: { required, currency: s.transaction.currency, sufficient, network: wallet.network },
  });
  return { sufficient, available, required, currency: s.transaction.currency, checkedAt };
}

export async function refreshWallet(ctx: ServiceContext, walletId: string): Promise<WalletConnection> {
  const { wallet, chain } = await ownWallet(ctx, walletId);
  return readBalance(ctx, chain, wallet);
}

/** Stops using a wallet for this closing. Earlier results stay in the record. */
export async function removeWallet(ctx: ServiceContext, walletId: string): Promise<void> {
  const actor = requireUser(ctx);
  const wallet = await ctx.db.wallet_connections.get(walletId);
  if (!wallet || wallet.userId !== actor.userId) throw notFound("That wallet");
  if (wallet.status === "removed") return;
  await ctx.writer.wallet_connections.update(wallet.id, { status: "removed" });
  await audit(ctx, { action: "wallet.removed", resourceType: "wallet_connection", resourceId: wallet.id, transactionId: wallet.transactionId, metadata: { network: wallet.network, wallet: maskAddress(wallet.address) } });
}

/** The signed-in person's own wallets for one closing. */
export async function myWallets(ctx: ServiceContext, transactionId: string): Promise<WalletConnection[]> {
  const actor = requireUser(ctx);
  return ctx.db.wallet_connections.find({ userId: actor.userId, transactionId, status: "verified" }, { orderBy: "createdAt" });
}

export async function recordFundsCheck(ctx: ServiceContext, check: Omit<FundsCheck, "id" | "createdAt">): Promise<FundsCheck> {
  return ctx.writer.funds_checks.insert({ id: newId(), ...check, createdAt: nowIso(ctx) });
}

/**
 * Proof-of-funds results the viewer may see (their own, or all of them for
 * escrow and verifiers): the newest result per account or wallet.
 */
export async function fundsChecksFor(ctx: ServiceContext, s: TransactionSnapshot): Promise<FundsCheck[]> {
  const actor = requireUser(ctx);
  const access = accessContext(s);
  const seeAll = can(actor, "escrow.manage", access) || can(actor, "beneficiary.verify", access);
  const rows = await ctx.db.funds_checks.find({ transactionId: s.transaction.id }, { orderBy: "checkedAt", ascending: false });
  const latest = new Map<string, FundsCheck>();
  for (const r of rows) if ((seeAll || r.userId === actor.userId) && !latest.has(r.sourceId)) latest.set(r.sourceId, r);
  return [...latest.values()];
}
