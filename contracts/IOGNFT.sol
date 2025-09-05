// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IOGNFT is IERC721 {
    // Project-specific methods your OGNFT implements/you may call:
    function mint(address to, uint256 rank) external;
    function tokenURI(uint256 tokenId) external view returns (string memory);
    function totalSupply() external view returns (uint256);
}
