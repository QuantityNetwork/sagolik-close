import { resolve } from "node:path";
import type { NextConfig } from "next";

const workspacePackages = [
  "@sagolik/audit",
  "@sagolik/auth",
  "@sagolik/config",
  "@sagolik/core",
  "@sagolik/database",
  "@sagolik/i18n",
  "@sagolik/integrations",
  "@sagolik/security",
  "@sagolik/types",
  "@sagolik/ui",
  "@sagolik/workflow",
];

const nextConfig: NextConfig = {
  transpilePackages: workspacePackages,
  // Container builds (Dockerfile) ship the self-contained server; Vercel ignores this.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // Document uploads (25 MB max after validation) + multipart overhead.
      bodySizeLimit: "26mb",
    },
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
