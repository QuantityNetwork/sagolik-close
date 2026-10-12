"use server";
/**
 * Wallet proof of funds and the deal record. Sagolik never holds wallet keys
 * and never moves money: these actions hand out a message to sign, check the
 * signature, read balances and check the public record.
 */
import * as core from "@sagolik/core";
import { RATE_LIMITS } from "@sagolik/security";
import type { ActionState } from "@/components/forms";
import { formString, runAction } from "@/lib/server/action";
import { rateLimit, requireContext } from "@/lib/server/context";

const txPath = (id: string) => `/app/transactions/${id}`;

function uuid(fd: FormData, key: string) {
  const v = formString(fd, key);
  if (!v || !/^[0-9a-f-]{36}$/i.test(v)) throw core.badRequest("Missing or invalid reference.");
  return v;
}

/** Wallet and record checks read from a blockchain node: limit them per person. */
async function chainContext() {
  const { ctx, actor } = await requireContext();
  const rl = await rateLimit(`chain:${actor.userId}`, RATE_LIMITS.chain);
  if (!rl.allowed) throw new core.AppError("rate_limited", "You're doing that too often. Please wait a moment and try again.", 429);
  return ctx;
}

const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export interface WalletChallengeData {
  token: string;
  message: string;
  address: string;
  networkLabel: string;
  expiresAt: string;
}

/** Step 1: the exact message a wallet will sign for this person, closing and address. */
export async function walletChallengeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    const c = await core.walletChallenge(ctx, uuid(fd, "transactionId"), formString(fd, "address") ?? "");
    const data: WalletChallengeData = { token: c.token, message: c.message, address: c.address, networkLabel: c.networkLabel, expiresAt: c.expiresAt };
    return { data };
  });
}

/** Step 2: the signature comes back; the wallet's USDC balance is read. */
export async function connectWalletAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await chainContext();
    const w = await core.connectWallet(ctx, formString(fd, "token") ?? "", formString(fd, "signature") ?? "");
    return { message: "Wallet confirmed. You can now check it against the funds still needed.", revalidate: [txPath(w.transactionId)] };
  });
}

export async function checkWalletFundsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await chainContext();
    const r = await core.checkWalletFunds(ctx, uuid(fd, "walletId"));
    return {
      message: r.sufficient
        ? `This wallet's USDC covers the ${usd(r.required)} still needed for closing.`
        : `This wallet's USDC is ${usd(r.required - r.available)} short of the ${usd(r.required)} still needed for closing.`,
      revalidate: ["/app"],
    };
  });
}

export async function refreshWalletAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await chainContext();
    const w = await core.refreshWallet(ctx, uuid(fd, "walletId"));
    return { revalidate: [txPath(w.transactionId)] };
  });
}

export async function removeWalletAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { ctx } = await requireContext();
    await core.removeWallet(ctx, uuid(fd, "walletId"));
    return { revalidate: ["/app"] };
  });
}

/** Replays our receipts against the registry on Base. */
export async function verifyDealRecordAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await chainContext();
    return { data: await core.verifyDealRecord(ctx, uuid(fd, "transactionId")) };
  });
}
