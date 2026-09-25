import { describe, expect, it } from "vitest";
import { createTestHarness } from "../testing";
import { HELD_BY_MONEY_SERVICE } from "./bridge";
import { runF1Scenario } from "./scenario";

describe("payment instructions and escrow movements (in-process)", () => {
  it("runs the F1 scenario with every control enforced", async () => {
    const h = await createTestHarness();
    const { instructionId } = await runF1Scenario(h);
    const row = await h.db.bank_instructions.get(instructionId);
    expect(row!.encryptedAccountNumber).not.toBe(HELD_BY_MONEY_SERVICE); // sealed locally without the money service
    expect(row!.encryptedAccountNumber).not.toContain("555123456");
  });
});
