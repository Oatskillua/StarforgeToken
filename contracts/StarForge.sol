// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./IOGNFT.sol";

contract StarForge is ERC20, ERC20Permit, ERC20Votes, AccessControl, Pausable {
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    IOGNFT public immutable ogNFT;
    mapping(address => uint256) public burnRanks;
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 10**18; // 1B SFG

    constructor(address founder, address treasury, address council, address _ogNFT) 
        ERC20("StarForge", "SFG") 
        ERC20Permit("StarForge") {
        require(founder != address(0) && treasury != address(0) && council != address(0) && _ogNFT != address(0), "Zero address");
        ogNFT = IOGNFT(_ogNFT);
        _mint(founder, TOTAL_SUPPLY);
        _grantRole(DEFAULT_ADMIN_ROLE, founder);
        _grantRole(BURNER_ROLE, treasury);
        _grantRole(PAUSER_ROLE, council);
    }

    function burnUser(uint256 amount) external whenNotPaused {
        require(amount > 0, "Invalid amount");
        _burn(msg.sender, amount);
        uint256 rank = burnRanks[msg.sender] + 1;
        burnRanks[msg.sender] = rank;
        ogNFT.mint(msg.sender, rank);
    }

    function burnExcessTreasury(uint256 amount) external onlyRole(BURNER_ROLE) {
        require(amount > 0, "Invalid amount");
        _burn(msg.sender, amount);
    }

    function burnMilestone(uint256 amount) external onlyRole(BURNER_ROLE) {
        require(amount > 0, "Invalid amount");
        _burn(msg.sender, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _update(address from, address to, uint256 amount) 
        internal override(ERC20, ERC20Votes) whenNotPaused {
        super._update(from, to, amount);
    }

    function nonces(address owner) 
        public view virtual override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}