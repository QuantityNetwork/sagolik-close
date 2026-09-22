/**
 * Uploads the demo vault files (fictional PDFs) that supabase/seed.sql refers
 * to. Local Supabase only — refuses to run against production.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... pnpm seed:storage
 */
import { createClient } from "@supabase/supabase-js";
import { LOCAL_ENCRYPTION_KEYS } from "../packages/config/src/env";
import { buildDemoData } from "../packages/core/src/demo/seed";
import { parseKeyRing } from "../packages/security/src/crypto";

// Must match the anchor in gen-seed-sql.ts so file hashes match the seeded document rows.
const ANCHOR = "2026-09-22T12:00:00.000Z";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (local project).");
  process.exit(1);
}
if (process.env.APP_ENV === "production" || !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url)) {
  console.error(`Refusing to seed demo files into ${url}. Demo data is for local Supabase only.`);
  process.exit(1);
}

const client = createClient(url, key, { auth: { persistSession: false } });
const { files } = buildDemoData(new Date(ANCHOR), parseKeyRing(LOCAL_ENCRYPTION_KEYS));
let uploaded = 0;
for (const f of files) {
  const { error } = await client.storage.from("documents").upload(f.key, f.bytes, { contentType: f.mimeType, upsert: true });
  if (error) {
    console.error(`failed ${f.key}: ${error.message}`);
    process.exitCode = 1;
  } else uploaded++;
}
console.log(`uploaded ${uploaded}/${files.length} demo files to the documents bucket`);
