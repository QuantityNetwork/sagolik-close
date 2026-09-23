import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { display, sans } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Sagolik Close — From Decision to Ownership",
    template: "%s · Sagolik Close",
  },
  description:
    "A modern closing infrastructure for buyers, sellers, agents, lenders, title partners and escrow providers. One structured workspace from decision to ownership.",
  applicationName: "Sagolik Close",
  icons: { icon: "/icon.png", apple: "/icon.png" },
  openGraph: {
    title: "Sagolik Close — From Decision to Ownership",
    description: "The orchestration layer for real-estate closings: identity, documents, signatures, escrow, financing, title and recording in one place.",
    siteName: "Sagolik Close",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#032a52",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The CSP uses a per-request nonce (src/proxy.ts); Next.js can only apply it to
  // dynamically rendered pages, so no HTML page may be prerendered at build time.
  await connection();
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-navy-800 focus:px-3 focus:py-2 focus:text-white">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
