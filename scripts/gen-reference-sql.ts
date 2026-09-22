import { writeFileSync } from "node:fs";
import { generateReferenceSql } from "../packages/database/src/reference-sql";

const target = new URL("../supabase/migrations/20260922000002_reference_data.sql", import.meta.url);
writeFileSync(target, generateReferenceSql());
console.log(`wrote ${target.pathname}`);
