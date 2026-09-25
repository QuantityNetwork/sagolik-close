import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS } from "./permissions";

// The Go money service embeds this file and enforces it independently.
const FILE = fileURLToPath(new URL("../../../services/money/internal/policy/roles.json", import.meta.url));

describe("money service policy parity", () => {
  it("role lists match the Go service for every money permission", () => {
    const embedded = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, string[]>;
    for (const [permission, roles] of Object.entries(embedded)) {
      const expected = Object.entries(ROLE_PERMISSIONS)
        .filter(([, perms]) => (perms as readonly string[]).includes(permission))
        .map(([role]) => role);
      expect(roles, permission).toEqual(expected);
    }
    expect(Object.keys(embedded).sort()).toEqual(["beneficiary.modify", "beneficiary.verify", "escrow.manage", "financial.view", "payment.initiate"]);
  });
});
