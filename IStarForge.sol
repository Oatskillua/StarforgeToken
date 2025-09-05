// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal interface for the SFG token used by Staking, Vesting, and Governor.
/// @dev Extends IERC20 and exposes burn + rank read. Governance helpers mirror ERC20Votes.
interface IStarForge is IERC20 {
    // ─────────────────────────────────────────────────────────────────────────
    // Custom SFG methods used elsewhere
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Burn tokens from the caller’s balance (e.g., staking withdrawal fee kept by contract).
    /// @dev MUST burn from msg.sender and revert on insufficient balance.
    function burnExcessTreasury(uint256 amount) external;

    /// @notice Rank used for vote-weight multipliers. Return 0 if unused.
    function burnRanks(address account) external view returns (uint256);

    // ─────────────────────────────────────────────────────────────────────────
    // Governance / votes (ERC20Votes-compatible helpers)
    // ─────────────────────────────────────────────────────────────────────────

    function getVotes(address account) external view returns (uint256);
    function getPastVotes(address account, uint256 blockNumber) external view returns (uint256);
    function getPastTotalSupply(uint256 blockNumber) external view returns (uint256);
    function delegates(address account) external view returns (address);
    function delegate(address delegatee) external;
    function delegateBySig(
        address delegatee,
        uint256 nonce,
        uint256 expiry,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}
