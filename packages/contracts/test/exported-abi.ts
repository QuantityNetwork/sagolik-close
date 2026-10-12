import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { FILES } from "../scripts/export-abi.ts";

describe("exported ABI", () => {
  it("matches the compiled artifacts (run scripts/export-abi.ts after changing a contract)", () => {
    for (const f of FILES) assert.equal(readFileSync(f.path, "utf8"), f.content(), f.path);
  });
});
