import type { MetadataRoute } from "next";

/** Reads APP_URL at request time so one build can serve any domain. */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/app", "/admin", "/sandbox", "/api", "/auth"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
