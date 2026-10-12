import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { encodeAbiParameters, getAddress, keccak256, parseEther, stringToHex, zeroAddress, zeroHash, type Hex } from "viem";

const kind = (label: string) => stringToHex(label, { size: 32 });
const id = (label: string) => keccak256(stringToHex(label));

/** The contract's running-hash rule, computed independently. */
function chain(previous: Hex, k: Hex, digest: Hex, sequence: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint64" }], [previous, k, digest, sequence]));
}

describe("SagolikDealRegistry", async () => {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [admin, recorder, outsider] = await viem.getWalletClients();

  async function deploy() {
    return viem.deployContract("SagolikDealRegistry", [admin.account.address, recorder.account.address]);
  }

  it("gives the treasury admin and the recording service their roles, and nobody else", async () => {
    const registry = await deploy();
    const RECORDER = await registry.read.RECORDER_ROLE();
    assert.equal(await registry.read.defaultAdmin(), getAddress(admin.account.address));
    assert.equal(await registry.read.hasRole([RECORDER, recorder.account.address]), true);
    assert.equal(await registry.read.hasRole([RECORDER, outsider.account.address]), false);
    assert.equal(await registry.read.hasRole([RECORDER, admin.account.address]), false);
  });

  it("appends entries as a hash chain per deal, and anyone can recompute it", async () => {
    const registry = await deploy();
    const deal = id("deal-1");
    const entries = [
      [kind("milestone.completed"), id("receipt-1")],
      [kind("document.version"), id("receipt-2")],
      [kind("ownership.transferred"), id("receipt-3")],
    ] as const;
    let head: Hex = zeroHash;
    for (const [i, [k, digest]] of entries.entries()) {
      const sequence = BigInt(i + 1);
      head = chain(head, k, digest, sequence);
      await viem.assertions.emitWithArgs(registry.write.record([deal, k, digest], { account: recorder.account }), registry, "Recorded", [deal, sequence, k, digest, head, (v: bigint) => v > 0n]);
    }
    assert.deepEqual(await registry.read.dealOf([deal]), [3n, head]);
    assert.equal(await registry.read.chain([zeroHash, entries[0][0], entries[0][1], 1n]), chain(zeroHash, entries[0][0], entries[0][1], 1n));

    // Verification from public data alone: replay the events and compare.
    const events = await publicClient.getContractEvents({ address: registry.address, abi: registry.abi, eventName: "Recorded", args: { dealId: deal }, fromBlock: 0n, strict: true });
    let replay: Hex = zeroHash;
    for (const e of events) replay = chain(replay, e.args.kind, e.args.digest, e.args.sequence);
    assert.equal(replay, head);
    assert.deepEqual(
      events.map((e) => e.args.sequence),
      [1n, 2n, 3n],
    );
  });

  it("keeps deals independent", async () => {
    const registry = await deploy();
    await registry.write.record([id("deal-a"), kind("milestone.completed"), id("a1")], { account: recorder.account });
    await registry.write.record([id("deal-a"), kind("milestone.completed"), id("a2")], { account: recorder.account });
    await registry.write.record([id("deal-b"), kind("milestone.completed"), id("b1")], { account: recorder.account });
    assert.equal((await registry.read.dealOf([id("deal-a")]))[0], 2n);
    assert.equal((await registry.read.dealOf([id("deal-b")]))[0], 1n);
    assert.deepEqual(await registry.read.dealOf([id("unknown")]), [0n, zeroHash]);
  });

  it("only lets the recording service append", async () => {
    const registry = await deploy();
    for (const account of [outsider.account, admin.account]) {
      await viem.assertions.revertWithCustomError(registry.write.record([id("deal"), kind("milestone.completed"), id("x")], { account }), registry, "AccessControlUnauthorizedAccount");
    }
  });

  it("refuses empty deal ids, kinds and digests", async () => {
    const registry = await deploy();
    const as = { account: recorder.account };
    await viem.assertions.revertWithCustomError(registry.write.record([zeroHash, kind("k"), id("d")], as), registry, "EmptyDealId");
    await viem.assertions.revertWithCustomError(registry.write.record([id("deal"), zeroHash, id("d")], as), registry, "EmptyKind");
    await viem.assertions.revertWithCustomError(registry.write.record([id("deal"), kind("k"), zeroHash], as), registry, "EmptyDigest");
  });

  it("lets the admin revoke a compromised recorder; its earlier entries stay", async () => {
    const registry = await deploy();
    const RECORDER = await registry.read.RECORDER_ROLE();
    await registry.write.record([id("deal"), kind("milestone.completed"), id("d1")], { account: recorder.account });
    await viem.assertions.revertWithCustomError(registry.write.revokeRole([RECORDER, recorder.account.address], { account: outsider.account }), registry, "AccessControlUnauthorizedAccount");
    await registry.write.revokeRole([RECORDER, recorder.account.address], { account: admin.account });
    await viem.assertions.revertWithCustomError(registry.write.record([id("deal"), kind("milestone.completed"), id("d2")], { account: recorder.account }), registry, "AccessControlUnauthorizedAccount");
    assert.equal((await registry.read.dealOf([id("deal")]))[0], 1n);
  });

  it("can be deployed without a recorder, and admin hand-over is two-step with a delay", async () => {
    const registry = await viem.deployContract("SagolikDealRegistry", [admin.account.address, zeroAddress]);
    assert.equal(await registry.read.hasRole([await registry.read.RECORDER_ROLE(), zeroAddress]), false);
    assert.equal(Number(await registry.read.defaultAdminDelay()), 3 * 24 * 60 * 60);
    await registry.write.beginDefaultAdminTransfer([outsider.account.address], { account: admin.account });
    await viem.assertions.revertWithCustomError(registry.write.acceptDefaultAdminTransfer({ account: outsider.account }), registry, "AccessControlEnforcedDefaultAdminDelay");
    assert.equal(await registry.read.defaultAdmin(), getAddress(admin.account.address));
  });

  it("cannot hold money: no payable functions, and plain ETH transfers revert", async () => {
    const registry = await deploy();
    const payable = registry.abi.filter((item) => "stateMutability" in item && item.stateMutability === "payable");
    assert.deepEqual(payable, []);
    assert.equal(
      registry.abi.some((item) => item.type === "receive" || item.type === "fallback"),
      false,
    );
    await assert.rejects(outsider.sendTransaction({ to: registry.address, value: parseEther("1") }));
    assert.equal(await publicClient.getBalance({ address: registry.address }), 0n);
  });
});
