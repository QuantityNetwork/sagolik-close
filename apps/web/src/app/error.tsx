"use client";

import { buttonClasses } from "@sagolik/ui";
import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="flex min-h-[60vh] flex-col items-center justify-center gap-5 px-4 text-center">
      <h1 className="text-[28px] text-navy-800">Something went wrong on our side</h1>
      <p className="max-w-md text-[15px] text-ink-2">Nothing you did caused this, and no payment or signature was affected. Please try again. If it keeps happening, contact support{error.digest ? " and quote the reference below" : ""}.</p>
      {error.digest ? <code className="rounded bg-sand px-2 py-1 text-[12px] text-ink-3">Reference {error.digest}</code> : null}
      <div className="flex gap-3">
        <button type="button" onClick={reset} className={buttonClasses("primary")}>
          Try again
        </button>
        <Link href="/app" className={buttonClasses("secondary")}>
          Go to my closings
        </Link>
      </div>
    </main>
  );
}
