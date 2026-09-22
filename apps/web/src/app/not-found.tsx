import { buttonClasses } from "@sagolik/ui";
import Link from "next/link";
import { Logo } from "@/components/brand";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-4 text-center">
      <Logo className="h-9 w-auto" />
      <div>
        <h1 className="text-[32px] text-navy-800">We couldn't find that page</h1>
        <p className="mt-2 max-w-md text-[15px] text-ink-2">It may have moved, or you may not have access to it. If you followed a link from an email, sign in first and try again.</p>
      </div>
      <div className="flex gap-3">
        <Link href="/app" className={buttonClasses("primary")}>
          Go to my closings
        </Link>
        <Link href="/" className={buttonClasses("secondary")}>
          Home
        </Link>
      </div>
    </main>
  );
}
