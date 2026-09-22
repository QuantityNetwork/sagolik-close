/**
 * Account: profile, recovery codes, step-up verification, sign-in audit.
 */
import { generateRecoveryCodes, hashRecoveryCode, verifyTotp } from "@sagolik/auth";
import { Locale } from "@sagolik/types";
import { z } from "zod";
import { type ServiceContext, requireUser } from "../context";
import { badRequest } from "../errors";
import { audit } from "../events";
import { newId, nowIso } from "../util";
import { claimInvitations } from "./transactions";

const ProfileInput = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, "Use an international phone number, e.g. +1 512 555 0100")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  locale: Locale,
});

export async function updateProfile(ctx: ServiceContext, raw: unknown) {
  const actor = requireUser(ctx);
  const input = ProfileInput.parse(raw);
  return ctx.writer.profiles.update(actor.userId, { fullName: input.fullName, phone: input.phone ?? null, locale: input.locale });
}

/** Issue ten new single-use recovery codes, invalidating any previous set. Returns the plain codes ONCE. */
export async function regenerateRecoveryCodes(ctx: ServiceContext): Promise<string[]> {
  const actor = requireUser(ctx);
  const existing = await ctx.writer.mfa_recovery_codes.find({ userId: actor.userId, usedAt: null });
  for (const c of existing) await ctx.writer.mfa_recovery_codes.update(c.id, { usedAt: nowIso(ctx) });
  const { codes, hashes } = generateRecoveryCodes();
  await ctx.writer.mfa_recovery_codes.insertMany(hashes.map((codeHash) => ({ id: newId(), userId: actor.userId, codeHash, usedAt: null, createdAt: nowIso(ctx) })));
  await audit(ctx, { action: "user.mfa_enrolled", resourceType: "recovery_codes", resourceId: actor.userId, metadata: { count: codes.length } });
  return codes;
}

export async function recoveryCodeStatus(ctx: ServiceContext) {
  const actor = requireUser(ctx);
  const all = await ctx.writer.mfa_recovery_codes.find({ userId: actor.userId });
  return { remaining: all.filter((c) => !c.usedAt).length, issued: all.length > 0 };
}

/**
 * Step-up verification for demo/local mode (a sandbox authenticator secret)
 * or with a recovery code. In Supabase mode, TOTP step-up is verified by
 * Supabase Auth (AAL2) in the web layer; recovery codes still come here.
 */
export async function verifyStepUpCode(ctx: ServiceContext, code: string, opts: { totpSecret: string | null }): Promise<"totp" | "recovery"> {
  const actor = requireUser(ctx);
  const clean = code.trim().toLowerCase();
  if (opts.totpSecret && /^\d{6}$/.test(clean) && verifyTotp(opts.totpSecret, clean, ctx.now().getTime())) {
    await audit(ctx, { action: "user.step_up", resourceType: "session", resourceId: actor.sessionId, metadata: { method: "totp" } });
    return "totp";
  }
  if (/^[a-z2-7]{5}-[a-z2-7]{5}$/.test(clean)) {
    const row = await ctx.writer.mfa_recovery_codes.findOne({ userId: actor.userId, codeHash: hashRecoveryCode(clean), usedAt: null });
    if (row) {
      const claimed = await ctx.writer.mfa_recovery_codes.updateIf(row.id, { usedAt: null }, { usedAt: nowIso(ctx) });
      if (claimed) {
        await audit(ctx, { action: "user.step_up", resourceType: "session", resourceId: actor.sessionId, metadata: { method: "recovery_code" } });
        return "recovery";
      }
    }
  }
  await audit(ctx, { action: "user.step_up_failed", resourceType: "session", resourceId: actor.sessionId });
  throw badRequest("That code didn't work. Check your authenticator app and try again.");
}

/** Called right after a successful sign-in. */
export async function recordSignIn(ctx: ServiceContext, method: string) {
  const actor = requireUser(ctx);
  await claimInvitations(ctx, actor);
  await audit(ctx, { action: "user.login", resourceType: "session", resourceId: actor.sessionId, metadata: { method } });
}

export async function recordSignOut(ctx: ServiceContext) {
  const actor = requireUser(ctx);
  await audit(ctx, { action: "user.logout", resourceType: "session", resourceId: actor.sessionId });
}

/** First sign-in through Supabase Auth: create the profile from the auth user. */
export async function ensureProfile(ctx: ServiceContext, user: { id: string; email: string; fullName: string | null }) {
  const existing = await ctx.writer.profiles.get(user.id);
  if (existing) return existing;
  return ctx.writer.profiles.insert({
    id: user.id,
    email: user.email.toLowerCase(),
    fullName: user.fullName?.trim() || user.email.split("@")[0]!,
    phone: null,
    locale: "en",
    avatarUrl: null,
    isPlatformAdmin: false,
    createdAt: nowIso(ctx),
    updatedAt: nowIso(ctx),
  });
}
