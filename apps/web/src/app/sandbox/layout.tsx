import { getRuntime } from "@sagolik/core";
import { FlaskConical } from "lucide-react";
import { notFound } from "next/navigation";

/**
 * Sandbox stand-ins for provider-hosted pages (bank consent, identity check,
 * e-signature ceremony). Only exist in demo mode.
 */
export default async function SandboxLayout({ children }: { children: React.ReactNode }) {
  const rt = await getRuntime();
  if (!rt.env.demoMode) notFound();
  return (
    <div className="min-h-screen bg-[repeating-linear-gradient(45deg,#faf8f4,#faf8f4_16px,#f3efe8_16px,#f3efe8_32px)]">
      <div className="border-b border-attention/30 bg-attention-50 px-4 py-2 text-center text-[13px] text-[#6b4000]">
        <FlaskConical className="mr-1.5 inline h-4 w-4" aria-hidden />
        Sandbox provider — this page simulates an external service. No real bank, identity check or signature is involved.
      </div>
      <main id="main" className="mx-auto max-w-lg px-4 py-12">
        {children}
      </main>
    </div>
  );
}
