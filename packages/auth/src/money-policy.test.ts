import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS } from "./permissions";

// The Go money service embeds this list and enforces it independently.
const FILE = fileURLToPath(new URL("../../../services/money/internal/policy/financial_view_roles.json", import.meta.url));

describe("money service policy parity", () => {
  it("financial.view roles match the Go service", () => {
    const roles = Object.entries(ROLE_PERMISSIONS)
      .filter(([, perms]) => (perms as readonly string[]).includes("financial.view"))
      .map(([role]) => role);
    expect(JSON.parse(readFileSync(FILE, "utf8"))).toEqual(roles);
  });
});
