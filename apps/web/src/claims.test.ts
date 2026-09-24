import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Sagolik makes no claims it can't back. This scans every user-facing source
 * (pages, components, demo seed) for wording that asserts certifications,
 * customer proof or guarantees we don't have. If a claim becomes true, add it
 * deliberately with evidence and adjust the allow list — never loosen the patterns.
 */
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SOURCES = ["apps/web/src", "packages/core/src/demo"];

const BANNED: Array<[RegExp, string]> = [
  [/testimonial/i, "customer testimonials"],
  [/customer stor(y|ies)/i, "customer stories"],
  [/trusted by/i, "'trusted by' social proof"],
  [/\b(soc ?2|iso ?27001|pci[- ]?dss|hipaa|fedramp)\b[^.]{0,40}\b(certified|compliant|audited|attested)/i, "certification claims"],
  [/\b(certified|certification)\b/i, "'certified' wording"],
  [/\b(compliant)\b/i, "'compliant' wording"],
  [/\b(bank|military)[- ]grade\b/i, "'bank/military-grade' marketing"],
  [/\bguarantee(d|s)?\b/i, "guarantees"],
  [/\b\d[\d,.]*\s*(\+|k\+|m\+)?\s*(happy )?(customers|clients|closings|transactions closed|users|agents|brokerages|companies)\b/i, "usage figures"],
  [/[★⭐]|\b[1-5](\.\d)?\s*(\/\s*5|out of 5|stars?)\b/i, "ratings"],
  [/\baward[- ]winning\b|\bindustry[- ]leading\b|\b#1\b/i, "superlatives"],
];

// Deliberate, accurate uses (quote the exact phrase and why).
const ALLOWED = [
  "cannot guarantee uninterrupted operation", // terms page: disclaims a guarantee
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(tsx?|md)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("no unverifiable claims", () => {
  it("user-facing sources contain no certification, social-proof or guarantee claims", () => {
    const hits: string[] = [];
    for (const f of SOURCES.flatMap((d) => files(join(ROOT, d)))) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (ALLOWED.some((a) => line.includes(a))) return;
          for (const [re, what] of BANNED) if (re.test(line)) hits.push(`${f.replace(ROOT, "")}:${i + 1} ${what}: ${line.trim().slice(0, 120)}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
