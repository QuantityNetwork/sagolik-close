"use client";
/**
 * Proves control of a wallet with a signed message. The wallet shows the
 * exact text; signing it is free and can't move money or approve spending.
 * Sagolik never asks for a recovery phrase or private key.
 */
import { Alert, buttonClasses, Field, Input, Textarea } from "@sagolik/ui";
import { Check, Copy, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { connectWalletAction, walletChallengeAction, type WalletChallengeData } from "@/app/actions/wallets";

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

const browserWallet = () => (typeof window === "undefined" ? undefined : (window as unknown as { ethereum?: Eip1193 }).ethereum);
const utf8Hex = (s: string) => `0x${Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("")}`;

function walletError(e: unknown): string {
  const err = e as { code?: number; message?: string } | null;
  if (err?.code === 4001) return "You cancelled in your wallet. Nothing was signed.";
  return err?.message || "Something went wrong. Please try again.";
}

export function WalletConnect({ transactionId, networkLabel }: { transactionId: string; networkLabel: string }) {
  const router = useRouter();
  const [hasBrowserWallet, setHasBrowserWallet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [pending, setPending] = useState<WalletChallengeData | null>(null);
  const [signature, setSignature] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => setHasBrowserWallet(!!browserWallet()), []);

  async function challenge(addr: string): Promise<WalletChallengeData> {
    const fd = new FormData();
    fd.set("transactionId", transactionId);
    fd.set("address", addr);
    const r = await walletChallengeAction(null, fd);
    if (!r?.ok) throw new Error(r?.error ?? "Something went wrong. Please try again.");
    return r.data as WalletChallengeData;
  }

  async function confirm(token: string, sig: string) {
    const fd = new FormData();
    fd.set("token", token);
    fd.set("signature", sig);
    const r = await connectWalletAction(null, fd);
    if (!r?.ok) throw new Error(r?.error ?? "Something went wrong. Please try again.");
    router.refresh();
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(walletError(e));
    } finally {
      setBusy(false);
    }
  }

  const connectBrowserWallet = () =>
    run(async () => {
      const eth = browserWallet();
      if (!eth) throw new Error("No browser wallet was found.");
      const [addr] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (!addr) throw new Error("Your wallet didn't share an address.");
      const c = await challenge(addr);
      const sig = (await eth.request({ method: "personal_sign", params: [utf8Hex(c.message), addr] })) as string;
      await confirm(c.token, sig);
    });

  return (
    <div className="space-y-3">
      {hasBrowserWallet ? (
        <button type="button" onClick={connectBrowserWallet} disabled={busy} className={buttonClasses("secondary", "md")}>
          <Wallet className="h-4 w-4" aria-hidden /> {busy && !pending ? "Waiting for your wallet…" : "Confirm with your browser wallet"}
        </button>
      ) : null}
      <details className="smooth rounded-lg border border-line px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-ink-2">{hasBrowserWallet ? "Use another wallet app" : "Confirm a wallet with your wallet app"}</summary>
        {!pending ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Field label={`Wallet address on ${networkLabel}`} htmlFor="wallet-address" className="min-w-64 flex-1">
              <Input id="wallet-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} />
            </Field>
            <button type="button" onClick={() => run(async () => setPending(await challenge(address)))} disabled={busy || !address.trim()} className={buttonClasses("secondary", "md")}>
              Get the message to sign
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-[13px] text-ink-3">
              In your wallet app, choose &ldquo;Sign message&rdquo; and sign exactly this text, then paste the signature below. It expires at {new Date(pending.expiresAt).toLocaleTimeString()}.
            </p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-control border border-line bg-canvas p-3 font-mono text-[12px] leading-relaxed text-ink-2">{pending.message}</pre>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(pending.message).catch(() => undefined);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className={buttonClasses("ghost", "sm")}
            >
              {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? "Copied" : "Copy message"}
            </button>
            <Field label="Signature" htmlFor="wallet-signature">
              <Textarea id="wallet-signature" value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="0x…" className="min-h-20 font-mono text-[12px]" spellCheck={false} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  run(async () => {
                    await confirm(pending.token, signature);
                    setPending(null);
                    setSignature("");
                    setAddress("");
                  })
                }
                disabled={busy || !signature.trim()}
                className={buttonClasses("primary", "md")}
              >
                {busy ? "Checking…" : "Confirm wallet"}
              </button>
              <button type="button" onClick={() => setPending(null)} className={buttonClasses("ghost", "md")}>
                Start over
              </button>
            </div>
          </div>
        )}
      </details>
      {error ? <Alert tone="blocked">{error}</Alert> : null}
    </div>
  );
}
