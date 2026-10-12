// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

/**
 * @title Sagolik Close deal registry
 * @notice A tamper-evident, append-only record of what happened in a closing:
 *         completed milestones, document fingerprints, verified payment
 *         instructions, escrow-reported receipts and the recorded transfer.
 *
 * It deliberately cannot do anything else:
 *  - It holds no money. Nothing is payable and there is no receive or
 *    fallback function, so sending ETH to it reverts.
 *  - It stores no personal data. A deal is identified by a salted hash that
 *    only its parties can link to the deal, and each entry is the hash of an
 *    off-chain receipt that includes a random nonce, so an entry's contents
 *    can't be guessed from the chain.
 *  - Entries are never edited or removed. Each one commits to the one before
 *    it (a hash chain per deal), so a deal's history can't be reordered or
 *    trimmed without detection. Corrections are new entries.
 *
 * Only accounts with RECORDER_ROLE can append (Sagolik's recording service).
 * The admin (Sagolik's treasury, ideally a multisig) adds or revokes
 * recorders; transferring the admin role takes two steps and a delay.
 */
contract SagolikDealRegistry is AccessControlDefaultAdminRules {
    bytes32 public constant RECORDER_ROLE = keccak256("RECORDER_ROLE");

    struct Deal {
        uint64 entries;
        bytes32 head;
    }

    mapping(bytes32 dealId => Deal) private _deals;

    /**
     * @param dealId     Salted hash identifying the deal.
     * @param sequence   1 for a deal's first entry, then 2, 3, …
     * @param kind       Short ASCII label, right-padded with zeros (e.g. "milestone.completed").
     * @param digest     Hash of the off-chain receipt for this entry.
     * @param head       Running hash after this entry (see {chain}).
     * @param recordedAt Block timestamp.
     */
    event Recorded(bytes32 indexed dealId, uint64 indexed sequence, bytes32 indexed kind, bytes32 digest, bytes32 head, uint64 recordedAt);

    error EmptyDealId();
    error EmptyKind();
    error EmptyDigest();

    /// @param admin    Account that manages recorders (Sagolik's treasury).
    /// @param recorder Initial recording account, or address(0) for none.
    constructor(address admin, address recorder) AccessControlDefaultAdminRules(3 days, admin) {
        if (recorder != address(0)) _grantRole(RECORDER_ROLE, recorder);
    }

    /// @notice Appends one entry to a deal's record.
    function record(bytes32 dealId, bytes32 kind, bytes32 digest) external onlyRole(RECORDER_ROLE) returns (uint64 sequence, bytes32 head) {
        if (dealId == bytes32(0)) revert EmptyDealId();
        if (kind == bytes32(0)) revert EmptyKind();
        if (digest == bytes32(0)) revert EmptyDigest();
        Deal storage deal = _deals[dealId];
        sequence = deal.entries + 1;
        head = chain(deal.head, kind, digest, sequence);
        deal.entries = sequence;
        deal.head = head;
        emit Recorded(dealId, sequence, kind, digest, head, uint64(block.timestamp));
    }

    /// @notice A deal's entry count and current head (both zero for an unknown deal).
    function dealOf(bytes32 dealId) external view returns (uint64 entries, bytes32 head) {
        Deal storage deal = _deals[dealId];
        return (deal.entries, deal.head);
    }

    /// @notice The running-hash rule, so anyone can recompute a deal's head from its events.
    function chain(bytes32 previousHead, bytes32 kind, bytes32 digest, uint64 sequence) public pure returns (bytes32) {
        return keccak256(abi.encode(previousHead, kind, digest, sequence));
    }
}
