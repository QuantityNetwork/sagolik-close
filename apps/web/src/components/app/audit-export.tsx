"use client";
import { buttonClasses } from "@sagolik/ui";
import { Download, Loader2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { exportAuditAction, exportMyDataAction } from "@/app/actions/governance";

function saveJson(filename: string, json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Exports the hash-sealed audit package (requires a fresh step-up). */
export function AuditExport({ transactionId }: { transactionId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; stepUp: boolean } | null>(null);
  const pathname = usePathname();
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className={buttonClasses("secondary", "sm")}
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const r = await exportAuditAction(transactionId);
          setPending(false);
          if (r?.ok && r.data) {
            const pkg = r.data as { filename: string; json: string; sha256: string };
            saveJson(pkg.filename, pkg.json);
          } else if (r && !r.ok) setError({ message: r.error, stepUp: r.code === "step_up_required" });
        }}
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />} Export audit package
      </button>
      {error ? (
        <p className="text-[12px] text-danger" role="alert">
          {error.message}{" "}
          {error.stepUp ? (
            <Link href={`/app/step-up?next=${encodeURIComponent(pathname)}`} className="font-medium underline">
              Confirm it's you
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

export function PersonalDataExport() {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      className={buttonClasses("secondary")}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const r = await exportMyDataAction();
        setPending(false);
        if (r?.ok && r.data) saveJson("sagolik-close-my-data.json", JSON.stringify(r.data, null, 2));
      }}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />} Download my data
    </button>
  );
}
