/**
 * User assertions for the Go money service: a compact JWS signed with
 * Ed25519 (alg "EdDSA"), valid for at most 60 seconds and used once.
 * The money service verifies these independently and re-checks every money
 * rule itself — the assertion only says who is asking and how they signed in.
 *
 * Contract shared with services/money/internal/assertion (see the test vector).
 */
import { createPrivateKey, createPublicKey, randomBytes, sign, type KeyObject } from "node:crypto";

export const ASSERTION_ISSUER = "sagolik-web";
export const ASSERTION_AUDIENCE = "sagolik-money";
export const ASSERTION_LIFETIME_SECONDS = 60;

export interface AssertionClaims {
  sub: string;
  txn?: string;
  role?: string;
  aal: "aal1" | "aal2";
  step_up_at?: number;
  iat: number;
  exp: number;
  jti: string;
  iss: string;
  aud: string;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Loads the signing key from a JWK (kty OKP, crv Ed25519, with d). */
export function assertionSigningKey(jwk: { kty: string; crv: string; d: string; x: string }): KeyObject {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.d) throw new Error("assertion signing key must be an Ed25519 private JWK");
  return createPrivateKey({ key: jwk, format: "jwk" });
}

/** The public JWKS the money service loads to verify assertions. */
export function assertionJwks(privateKey: KeyObject, kid: string) {
  const pub = createPublicKey(privateKey).export({ format: "jwk" }) as { x: string };
  return { keys: [{ kty: "OKP", crv: "Ed25519", kid, x: pub.x, use: "sig", alg: "EdDSA" }] };
}

export function signUserAssertion(
  input: { userId: string; transactionId?: string; role?: string; aal2: boolean; stepUpAt?: Date | null },
  key: { privateKey: KeyObject; kid: string },
  opts: { now?: Date; jti?: string } = {},
): string {
  const iat = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const claims: AssertionClaims = {
    iss: ASSERTION_ISSUER,
    aud: ASSERTION_AUDIENCE,
    sub: input.userId,
    ...(input.transactionId ? { txn: input.transactionId } : {}),
    ...(input.role ? { role: input.role } : {}),
    aal: input.aal2 ? "aal2" : "aal1",
    ...(input.stepUpAt ? { step_up_at: Math.floor(input.stepUpAt.getTime() / 1000) } : {}),
    iat,
    exp: iat + ASSERTION_LIFETIME_SECONDS,
    jti: opts.jti ?? randomBytes(24).toString("base64url"),
  };
  const signingInput = `${b64url(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: key.kid }))}.${b64url(JSON.stringify(claims))}`;
  const sig = sign(null, Buffer.from(signingInput), key.privateKey);
  return `${signingInput}.${b64url(sig)}`;
}
