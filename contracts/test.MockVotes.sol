// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/utils/Nonces.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockVotes is ERC20, ERC20Permit, ERC20Votes, Ownable {
    constructor()
        ERC20("MockVotes", "MV")
        ERC20Permit("MockVotes")
        Ownable(msg.sender) // OZ v5 pattern: set initial owner
    {}

    /// @notice simple mint for tests
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount); // NOTE: do NOT override _mint/_burn in OZ v5; ERC20Votes hooks via _update now
    }

    // --- Required single override in OZ v5 (replaces _mint/_burn overrides from v4) ---
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    // --- Resolve multiple inheritance of Nonces (both ERC20Permit and ERC20Votes pull it in) ---
    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}
