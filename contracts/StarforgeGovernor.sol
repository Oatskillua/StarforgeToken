// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ─────────────────────────────────────────────────────────────────────────────
// NOTE: console.sol is Hardhat-only. It's stripped by Hardhat and will compile
// fine on Hardhat networks (including forking). If you ever build with a tool
// that doesn't support it, comment out the import & console.log lines.
// ─────────────────────────────────────────────────────────────────────────────
import "hardhat/console.sol";

import "@openzeppelin/contracts/access/AccessControl.sol";

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import "@openzeppelin/contracts/governance/utils/IVotes.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";

import "./IStarForge.sol"; // for burnRanks(account)

contract StarforgeGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl,
    AccessControl
{
    // Roles
    bytes32 public constant VOTE_TIER_SETTER_ROLE = keccak256("VOTE_TIER_SETTER_ROLE");

    // Tier storage (rank -> weightBps). Example: 10000 = 1.00x, 11000 = 1.10x
    mapping(uint256 => uint256) public voteTierBps;
    uint256 private _nextTierId = 1;

    // Token with burnRanks() (your SFG token)
    IStarForge public immutable sfgToken;

    // Debug event (persists only if tx doesn't revert)
    event Debug(string tag, bytes data);
    event VoteTierUpdated(uint256 indexed tierOrRank, uint256 weightBps);

    constructor(IVotes token_, TimelockController timelock_)
        Governor("StarforgeGovernor")
        GovernorSettings(
            1,         // voting delay (blocks)
            45818,     // voting period (~1 week @ ~15s)
            0          // proposal threshold
        )
        GovernorVotes(token_)
        GovernorVotesQuorumFraction(4)      // 4% quorum
        GovernorTimelockControl(timelock_)
    {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VOTE_TIER_SETTER_ROLE, msg.sender);

        sfgToken = IStarForge(address(token_));

        console.log("[Governor::ctor] sender=%s", msg.sender);
        console.log("[Governor::ctor] token=%s timelock=%s", address(token_), address(timelock_));
        emit Debug("ctor", abi.encode(msg.sender, address(token_), address(timelock_)));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Vote tier helpers (rank → weightBps). Defaults to 1.00x if unset.
    // ─────────────────────────────────────────────────────────────────────

    /// Single-arg setter used by tests: assigns to next sequential id (for convenience).
    function setVoteTier(uint256 weightBps) external onlyRole(VOTE_TIER_SETTER_ROLE) {
        uint256 tier = _nextTierId++;
        voteTierBps[tier] = weightBps;
        console.log("[setVoteTier/1] by=%s tier=%s weightBps=%s", msg.sender, tier, weightBps);
        emit Debug("setVoteTier/1", abi.encode(msg.sender, tier, weightBps));
        emit VoteTierUpdated(tier, weightBps);
    }

    /// Explicit setter for a given rank/tier id.
    function setVoteTier(uint256 tierOrRank, uint256 weightBps) external onlyRole(VOTE_TIER_SETTER_ROLE) {
        voteTierBps[tierOrRank] = weightBps;
        if (tierOrRank >= _nextTierId) _nextTierId = tierOrRank + 1;
        console.log("[setVoteTier/2] by=%s tier=%s weightBps=%s", msg.sender, tierOrRank, weightBps);
        emit Debug("setVoteTier/2", abi.encode(msg.sender, tierOrRank, weightBps));
        emit VoteTierUpdated(tierOrRank, weightBps);
    }

    /// Compatibility getter for old tests: mirrors prior `voteTier(tier)` name.
    function voteTier(uint256 tierOrRank) external view returns (uint256) {
        return voteTierBps[tierOrRank];
    }

    // ─────────────────────────────────────────────────────────────────────
    // Apply rank-based multipliers to voting power
    // ─────────────────────────────────────────────────────────────────────

    /// @dev Override vote power fetch to multiply by rank-based weight (in bps).
    /// Default weight = 10000 (1.00x) when unset.
    function _getVotes(
        address account,
        uint256 blockNumber,
        bytes memory params
    )
        internal
        view
        override(Governor, GovernorVotes)
        returns (uint256)
    {
        uint256 base = super._getVotes(account, blockNumber, params);

        // Fetch rank from SFG token (burnRanks). If call fails, assume rank 0.
        uint256 rank = 0;
        try sfgToken.burnRanks(account) returns (uint256 r) { rank = r; } catch {}

        uint256 weightBps = voteTierBps[rank];
        if (weightBps == 0) {
            // default 1.00x if not configured
            return base;
        }
        // Multiply with bps: base * weightBps / 10000
        return (base * weightBps) / 10_000;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Governor params
    // ─────────────────────────────────────────────────────────────────────

    function votingDelay()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    { return super.votingDelay(); }

    function votingPeriod()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    { return super.votingPeriod(); }

    function quorum(uint256 blockNumber)
        public
        view
        override(Governor, GovernorVotesQuorumFraction)
        returns (uint256)
    { return super.quorum(blockNumber); }

    function proposalThreshold()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    { return super.proposalThreshold(); }

    // ─────────────────────────────────────────────────────────────────────
    // Timelock/Governor integration (traced)
    // ─────────────────────────────────────────────────────────────────────

    function state(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    {
        ProposalState s = super.state(proposalId);
        console.log("[state] proposalId=%s state=%s", proposalId, uint256(s));
        return s;
    }

    function proposalNeedsQueuing(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (bool)
    {
        bool needs = super.proposalNeedsQueuing(proposalId);
        console.log("[proposalNeedsQueuing] id=%s needs=%s", proposalId, needs);
        return needs;
    }

    function _queueOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    )
        internal
        override(Governor, GovernorTimelockControl)
        returns (uint48)
    {
        console.log("[_queueOperations] id=%s targets=%s", proposalId, targets.length);
        emit Debug("_queueOperations", abi.encode(proposalId, targets, values, calldatas, descriptionHash));
        return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _executeOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    )
        internal
        override(Governor, GovernorTimelockControl)
    {
        console.log("[_executeOperations] id=%s calls=%s", proposalId, targets.length);
        emit Debug("_executeOperations", abi.encode(proposalId, targets.length));
        super._executeOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    )
        internal
        override(Governor, GovernorTimelockControl)
        returns (uint256)
    {
        console.log("[_cancel] calls=%s", targets.length);
        emit Debug("_cancel", abi.encode(targets.length));
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns (address)
    { return super._executor(); }

    // ─────────────────────────────────────────────────────────────────────
    // Introspection
    // ─────────────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(Governor, AccessControl)
        returns (bool)
    { return super.supportsInterface(interfaceId); }
}
