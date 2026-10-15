# Deal record and wallet proof of funds (Base)

Sagolik Close uses a blockchain to **record and verify**, never to hold or move money:

- **Deal record.** Each key fact of a closing (deal opened, milestones, signed documents, verified payment instructions, funds received by escrow, ownership transferred) gets a receipt. The receipt's fingerprint is appended to the `SagolikDealRegistry` contract on Base. Anyone holding a receipt can check it against the public chain without trusting Sagolik. Nobody, Sagolik included, can alter or remove an entry once it is recorded.
- **Wallet proof of funds.** A buyer proves they control a wallet by signing a short message. Signing is free, moves nothing and approves nothing. Sagolik then reads the wallet's USDC balance and compares it with what the closing still needs. Escrow sees the result, never the balance or the address.
- **Payment evidence.** When a payer sends USDC directly from their own wallet (to an address escrow gave them through its own channels), escrow can attach the transaction hash when it records the funds as received. Sagolik reads the transaction and checks the amount. Escrow still decides what it received.

What it never does: hold keys to anyone's wallet, ask for a recovery phrase, request spending approval, send or receive money, put names, addresses, amounts or documents on chain, or hold funds in a contract (the registry has no payable functions).

## Pieces

| Piece | Where |
| --- | --- |
| Registry contract (Solidity 0.8.30, OpenZeppelin 5) | `packages/contracts/contracts/SagolikDealRegistry.sol` |
| Contract tests (Hardhat 3, node:test, viem, OP-stack simulation) | `packages/contracts/test/` |
| Chain adapter interface, Base adapter, sandbox chain | `packages/integrations/src/chain/` |
| Receipt and hashing rules (shared by everyone who verifies) | `packages/integrations/src/chain/records.ts` |
| Deal record service: receipts, delivery, verification, export | `packages/core/src/services/deal-record.ts` |
| Wallet proof of funds | `packages/core/src/services/wallets.ts` |
| Payment evidence | `paymentEvidence` in `packages/core/src/services/escrow.ts` |
| Tables and row-level security | `supabase/migrations/20261012000001_wallets_and_deal_record.sql` |
| Screens | Money tab ("Your wallets", "Buyer's proof of funds", escrow's "Record funds"); Record tab; `/sandbox/wallet` (demo) |

## The registry contract

```solidity
function record(bytes32 dealId, bytes32 kind, bytes32 digest) external onlyRole(RECORDER_ROLE) returns (uint64 sequence, bytes32 head);
function dealOf(bytes32 dealId) external view returns (uint64 entries, bytes32 head);
event Recorded(bytes32 indexed dealId, uint64 indexed sequence, bytes32 indexed kind, bytes32 digest, bytes32 head, uint64 recordedAt);
```

- **Append-only, per deal.** Every deal has its own sequence and running fingerprint (a hash chain):
  `head(n) = keccak256(abi.encode(head(n-1), kind, digest, uint64 n))` with `head(0) = 0x00…00`.
  Removing, reordering or changing any entry would change every later head.
- **Roles.** `RECORDER_ROLE` is the recording service's account. It can append and do nothing else, and pays only its own gas. `DEFAULT_ADMIN_ROLE` is the Sagolik Treasury wallet. It can grant or revoke the recorder (for example, to rotate a leaked key; earlier entries stay). Moving the admin role takes two steps with a 3-day delay (`AccessControlDefaultAdminRules`).
- **No money.** There are no payable functions, `receive` or `fallback`, so plain ETH transfers revert. The tests check this.
- **Cost.** About 1.0M gas to deploy (around 1.3M with headroom). An entry costs about 72k gas for the first one of a deal and 38k for each one after it, a fraction of a cent on Base.

## Receipts and privacy

```jsonc
{
  "v": 1,
  "dealId": "0x…",          // HMAC-SHA256(CHAIN_DEAL_SALT, "sagolik-close/deal/v1:" + transactionId)
  "kind": "funds.received",
  "facts": { "amountCents": 2500000, "currency": "USD", "source": "settled_payment" },
  "occurredAt": "2026-09-17T15:00:00.000Z",
  "nonce": "0x…"            // 32 random bytes: identical facts never produce a guessable fingerprint
}
```

- `digest = keccak256(UTF-8 of the canonical JSON)`: object keys sorted at every level, no whitespace.
- On chain there are only `dealId`, `kind` (a short label such as `milestone.completed`), `digest` and the running head. The deal id can't be linked to a transaction without the deployment's secret salt.
- Facts never include names, contact details, addresses or account numbers. A signed document is identified by its category, version and SHA-256. Verified payment instructions are identified by a fingerprint of the instructions as everyone saw them (beneficiary, bank, account mask, routing, version). Ownership uses the public recording reference.
- **Who sees receipts.** Everyone on the transaction sees the entries. Entries about money (`instruction.verified`, `funds.received`) are shown only to people with financial access. RLS and the service layer both apply this rule.
- **Immutability.** The `chain_records_guard` trigger makes what an entry commits to fixed from creation. Only its delivery may change, a confirmed entry is final, and entries can't be deleted.

## Delivery

Domain events (`transaction.created`, `transaction.state_changed`, `document.signed`, `bank_instruction.verified`, `escrow.deposit_received`, `ownership.transferred`) trigger reactions that append entries. Each fact is recorded once (`dedupe_key`). A reaction never fails the closing step it follows.

1. **Queued.** The entry and its receipt are saved.
2. **Signed, saved, sent.** The recording service signs the transaction, **saves its hash and nonce first**, then sends it. If the process stops in between, nothing is lost: the hash is known and the nonce can be reused.
3. **Confirmed** after 3 blocks on Base (1 locally). The `Recorded` event must carry exactly this entry.
4. **Recovery.**
   - A submission the network has never seen is re-sent after 10 minutes. One stuck for 30 minutes is re-sent with higher fees. Both use the same nonce, so at most one can ever land.
   - A reverted transaction appended nothing, so the entry is sent again.
   - If the nonce went to another transaction, the entry is sent fresh.
   - The registry refusing the entry (for example, the recorder lost its role) marks it **failed**. That is logged as an error and audited.

In production, the worker (`apps/worker`) sends and confirms entries every tick. Pages only check confirmations, so the web app doesn't need the recording key. In demo and local mode, everything happens in-process on the sandbox chain.

## Verifying a record

**In the app:** Record tab → *Check against Base*. Sagolik recomputes every receipt's fingerprint, replays the confirmed entries in order and compares the result with `dealOf(dealId)` on chain:
- *match*: everything agrees.
- *settling*: entries are still confirming.
- *mismatch*: a problem is described, for example the chain holds an entry we have no receipt for, or a receipt no longer hashes to its fingerprint.

**Without Sagolik:** *Download the receipts (JSON)* exports the receipts the viewer may see, with the registry address, chain id, deal id, transaction hashes and these rules:

1. For each entry, `keccak256(canonicalJson(receipt))` must equal `digest`.
2. The `Recorded` event in `txHash` must carry the same `dealId`, `kind` (UTF-8 label, right-padded to 32 bytes), `digest` and `sequence`.
3. Replaying `head(n)` over all entries must give `SagolikDealRegistry.dealOf(dealId).head`. This needs every entry, including the money ones.

## Wallet proof of funds

1. The buyer enters, or their browser wallet shares, an address. Sagolik issues a challenge: a message plus an opaque token, HMAC-signed with the session secret and bound to the person, the closing, the network and the address. It expires after 10 minutes. The message reads:

   ```
   close.sagolik.com asks you to confirm you control this wallet.

   Wallet: 0x…
   Network: Base
   Purpose: proof of funds for closing SC-2026-…
   Nonce: …
   Issued: …
   Expires: …

   Signing is free. It does not send money, approve spending or give anyone access to your wallet.
   ```

2. The wallet signs it with `personal_sign` (or the buyer pastes a signature from any wallet app). Sagolik verifies it with viem's `verifyMessage`, which covers ordinary wallets and smart-contract wallets (EIP-1271/6492). Each challenge can create one connection only.
3. Sagolik reads the wallet's USDC balance at the latest block. USDC counts at face value (1 USDC = $1.00), so wallets apply to closings in US dollars. *Check funds for closing* compares the balance with what escrow still needs and records a `funds_checks` result: the source label (`USDC wallet on Base •••• 3f9A`), required amount, sufficient yes/no and time. The buyer's own wallet row (address, balance) is visible only to them.

USDC contracts: Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, Base Sepolia `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Circle).

## Configuration

| Variable | Meaning |
| --- | --- |
| `CHAIN_NETWORK` | `off`, `sandbox` (in-memory demo chain), `base-sepolia`, `base` or `local`. Default: `sandbox` in demo mode, otherwise `off`. Production allows only `base` or `off`. |
| `CHAIN_REGISTRY_ADDRESS` | The deployed registry. Required for live networks. |
| `CHAIN_DEAL_SALT` | Secret (≥32 characters) that makes deal ids unlinkable. Required for live networks. **Keep it stable:** changing it starts a new deal id for every closing. |
| `CHAIN_RECORDER_KEY_ID` | The recording account's key in Azure Key Vault, with its version: an HSM-backed EC key on curve P-256K (secp256k1). Key Vault signs each entry; the key never leaves the HSM, and the recording account is its address (which is why the version is pinned). Required in production. Set it where entries are sent (the worker). Without a recording key, entries wait in the queue. |
| `CHAIN_RECORDER_KEY` | Test networks only: the recording account's private key (`RECORDER_ROLE` only). Refused in production. |
| `CHAIN_RPC_URL` | JSON-RPC endpoint (https). Defaults to the public Base endpoint, which is rate-limited; use a provider in production. |
| `CHAIN_USDC_ADDRESS` | Local test networks only. |

Store the salt as a sensitive secret, never in the repository.

## Deploying the registry (Base Sepolia first)

Deployment is signed by the treasury wallet (for example in PayBox). No private key is configured in Hardhat or in this repository.

```bash
pnpm --filter @sagolik/contracts build
cd packages/contracts
# 1. A recording account for the service: on Azure, the infrastructure creates the key inside Key Vault's HSM
#    (chain-recorder in the core vault), and the key ceremony prints its address and versioned id
#    (docs/azure/runbook.md). Only the address ever leaves the vault.
# 2. Build the unsigned deployment transaction (prints the transaction, the future contract address and the most it can cost).
node --experimental-strip-types scripts/deploy-tx.ts --network base-sepolia --admin <treasury address> --recorder <recorder address>
# 3. Sign that transaction with the treasury wallet. 4. Send it and check the roles:
node --experimental-strip-types scripts/broadcast.ts --network base-sepolia --raw 0x<signed transaction>
```

Then:
1. Send the recording account a little ETH for gas (a few dollars lasts thousands of entries).
2. Set `CHAIN_NETWORK`, `CHAIN_REGISTRY_ADDRESS`, `CHAIN_DEAL_SALT`, `CHAIN_RECORDER_KEY_ID` and `CHAIN_RPC_URL` on the worker. Give the worker's managed identity the right to sign with that one key, nothing else.
3. Deploy the app and record a test closing.
4. When satisfied, repeat on `base`.

Admin operations go through the treasury wallet: `grantRole` and `revokeRole` for the recorder, and the delayed `beginDefaultAdminTransfer` for the admin role.

## Tests

- `pnpm --filter @sagolik/contracts test`: contract behaviour (roles, hash chain, event replay, refusals, revocation, admin delay, no money) and a check that the ABI and bytecode the app uses match the compiled contract.
- `pnpm test`: record rules, sandbox chain, wallet proof of funds, delivery and recovery (outage, crash between saving and sending, refusal), verification and divergence, the full closing lifecycle's record, and the seeded demo record.
- `bash packages/contracts/scripts/integration.sh`: the real Base adapter against a local Hardhat node running the compiled contracts (signatures, USDC balances, records, replacement, payment evidence), including a recording account that signs the way Key Vault does (digest in, raw signature out, normalised to Ethereum's low-s form).
- `pnpm test:db`: row-level security and immutability on PostgreSQL.
