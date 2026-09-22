import Image from "next/image";
import Link from "next/link";

/** Official Sagolik Close logo (from the supplied brand artwork). */
export function Logo({ variant = "color", className = "h-9 w-auto", href = "/" }: { variant?: "color" | "light"; className?: string; href?: string | null }) {
  const img = (
    <Image
      src={variant === "light" ? "/brand/sagolik-close-logo-light.png" : "/brand/sagolik-close-logo-transparent.png"}
      alt="Sagolik Close — From Decision to Ownership"
      width={1200}
      height={231}
      priority
      className={className}
    />
  );
  return href ? (
    <Link href={href} aria-label="Sagolik Close home" className="inline-flex shrink-0">
      {img}
    </Link>
  ) : (
    img
  );
}

export function Mark({ variant = "color", size = 32 }: { variant?: "color" | "light"; size?: number }) {
  return <Image src={variant === "light" ? "/brand/sagolik-mark-light.png" : "/brand/sagolik-mark.png"} alt="" width={size} height={size} className="h-auto" style={{ width: size }} />;
}
