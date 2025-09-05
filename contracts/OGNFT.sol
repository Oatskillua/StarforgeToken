// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./IOGNFT.sol";

contract OGNFT is ERC721, AccessControl, IOGNFT {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint256 public tokenIdCounter;     // start from 1
    uint256 private _totalSupply;
    mapping(uint256 => string) private _tokenURIs;

    constructor() ERC721("OGNFT", "OGNFT") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        tokenIdCounter = 1;
    }

    function mint(address to, uint256 rank) external onlyRole(MINTER_ROLE) {
        require(rank >= 1 && rank <= 4, "Invalid rank");

        uint256 tokenId = tokenIdCounter++;
        _tokenURIs[tokenId] = _rankToURI(rank);

        // effects before interactions
        _totalSupply += 1;

        _safeMint(to, tokenId);
    }

    /// @dev OZ v5 hook that runs for mints/transfers/burns.
    /// Allow mint (from == 0), allow burn only for admin, block transfers.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from == address(0)) {
            // mint
            return super._update(to, tokenId, auth);
        }
        if (to == address(0)) {
            // burn
            require(hasRole(DEFAULT_ADMIN_ROLE, auth), "Soulbound: not revocable");
            return super._update(to, tokenId, auth);
        }
        // any transfer
        revert("Soulbound: non-transferable");
    }

    /// @notice Admin-only revoke (burn).
    function adminRevoke(uint256 tokenId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        super._burn(tokenId);
        if (bytes(_tokenURIs[tokenId]).length != 0) {
            delete _tokenURIs[tokenId];
        }
        unchecked { _totalSupply -= 1; }
    }

    // Explicitly disable approvals/transfers (UX-friendly).
    function approve(address, uint256) public pure override(ERC721, IERC721) { revert("Soulbound"); }
    function setApprovalForAll(address, bool) public pure override(ERC721, IERC721) { revert("Soulbound"); }
    function transferFrom(address, address, uint256) public pure override(ERC721, IERC721) { revert("Soulbound"); }

    // NOTE: Do NOT override safeTransferFrom in OZ v5 (it is not virtual).
    // Attempts to use safeTransferFrom will still revert via _update().

    // --- Views ---
    function totalSupply() public view override returns (uint256) {
        return _totalSupply;
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, IOGNFT)
        returns (string memory)
    {
        require(_ownerOf(tokenId) != address(0), "Nonexistent token");
        return _tokenURIs[tokenId];
    }

    function _rankToURI(uint256 rank) internal pure returns (string memory) {
        if (rank == 1) return "ipfs://spark_carrier";
        if (rank == 2) return "ipfs://flame_guardian";
        if (rank == 3) return "ipfs://starforger";
        return "ipfs://cosmic_flame"; // rank 4
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl, IERC165)
        returns (bool)
    {
        return interfaceId == type(IOGNFT).interfaceId || super.supportsInterface(interfaceId);
    }
}
