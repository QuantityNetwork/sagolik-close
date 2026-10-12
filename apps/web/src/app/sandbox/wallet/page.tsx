import { maskAddress, openWalletChallenge } from "@sagolik/core";
import { demoWallet } from "@sagolik/integrations";
import { buttonClasses, Card, CardBody } from "@sagolik/ui";
import { Lock, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { signDemoWalletSandbox } from "@/app/actions/sandbox";
import { ActionForm, SubmitButton } from "@/components/forms";
import { requireContext } from "@/lib/server/context";

export const metadata: Metadata = { title: "Sandbox wallet" };

/** Stands in for a wallet app's "Sign message" screen, for the signed-in person's fictional demo wallet. */
export default async function SandboxWallet({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const sp = await searchParams;
  const { ctx, actor } = await requireContext("/app");
  const wallet = demoWallet(actor.userId);
  const request = sp.token ? await openWalletChallenge(ctx, sp.token).catch(() => null) : null;
  if (!request || request.address !== wallet.address) {
    return (
      <Card>
        <CardBody className="p-7">
          <p className="font-medium">This signing request has expired.</p>
          <Link href="/app" className={buttonClasses("secondary", "md", "mt-4")}>
            Back to Sagolik Close
          </Link>
        </CardBody>
      </Card>
    );
  }
  const back = `/app/transactions/${request.transactionId}/money#wallets`;
  return (
    <Card>
      <CardBody className="p-7">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-navy-800 text-white">
            <Wallet className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <p className="text-lg font-semibold">Demo wallet {maskAddress(wallet.address)}</p>
            <p className="text-[13px] text-ink-3">{request.networkLabel} · fictional test USDC</p>
          </div>
        </div>
        <p className="mt-6 text-[15px]">
          <span className="font-semibold">Signature request</span> — sign this message?
        </p>
        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-control border border-line bg-canvas p-3 font-mono text-[12px] leading-relaxed text-ink-2">{request.message}</pre>
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-canvas p-3 text-[13px] text-ink-3">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> A real wallet shows the same text. Signing a message proves the wallet is yours. It can&apos;t send money or approve spending, and no network fee applies.
        </p>
        <div className="mt-6 flex gap-3">
          <ActionForm action={signDemoWalletSandbox}>
            <input type="hidden" name="token" value={request.token} />
            <SubmitButton pendingLabel="Signing…">Sign</SubmitButton>
          </ActionForm>
          <Link href={back} className={buttonClasses("ghost")}>
            Cancel
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
