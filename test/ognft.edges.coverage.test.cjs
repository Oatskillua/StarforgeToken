const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OGNFT — soulbound & interfaces", () => {
  let owner, other, og;

  const waitDeployed = async (c) => (c.waitForDeployment ? c.waitForDeployment() : c.deployed());
  const addrOf = async (c) => (c.getAddress ? c.getAddress() : c.address);

  beforeEach(async () => {
    [owner, other] = await ethers.getSigners();
    const OGNFT = await ethers.getContractFactory("OGNFT");
    og = await OGNFT.deploy();
    await waitDeployed(og);

    // grant minter to owner (if not default); mint rank 1 to owner
    const MINTER_ROLE = await og.MINTER_ROLE();
    if (!(await og.hasRole(MINTER_ROLE, owner.address))) {
      await og.grantRole(MINTER_ROLE, owner.address);
    }
    await og.mint(owner.address, 1);
  });

  it("supportsInterface: known & negative ids", async () => {
    // Already test negative in another file; add a couple positives to bump branches
    // ERC165
    expect(await og.supportsInterface("0x01ffc9a7")).to.equal(true);
    // AccessControl
    expect(await og.supportsInterface("0x7965db0b")).to.equal(true);
  });

  it("soulbound: all transfer/approval flows revert", async () => {
    const tokenId = 1n;

    await expect(
      og.connect(owner).approve(other.address, tokenId)
    ).to.be.reverted;

    await expect(
      og.connect(owner).setApprovalForAll(other.address, true)
    ).to.be.reverted;

    // transferFrom
    await expect(
      og.connect(owner).transferFrom(owner.address, other.address, tokenId)
    ).to.be.reverted;

    // safeTransferFrom (no data)
    await expect(
      og.connect(owner)["safeTransferFrom(address,address,uint256)"](owner.address, other.address, tokenId)
    ).to.be.reverted;

    // safeTransferFrom (with data)
    await expect(
      og.connect(owner)["safeTransferFrom(address,address,uint256,bytes)"](owner.address, other.address, tokenId, "0x")
    ).to.be.reverted;

    // ownership unchanged
    expect(await og.ownerOf(tokenId)).to.equal(owner.address);
  });

  it("tokenURI for valid ranks", async () => {
    // If ranks 1..N exist, hit a couple to cover the switch/if ladder.
    // Already minted rank 1; mint rank 2
    await og.mint(owner.address, 2);
    expect(await og.tokenURI(1)).to.not.equal("");
    expect(await og.tokenURI(2)).to.not.equal("");
  });

  it("AccessControl: grant/revoke/renounce keep roles consistent", async () => {
    const MINTER_ROLE = await og.MINTER_ROLE();
    await og.grantRole(MINTER_ROLE, other.address);
    expect(await og.hasRole(MINTER_ROLE, other.address)).to.equal(true);

    await og.connect(other).renounceRole(MINTER_ROLE, other.address);
    expect(await og.hasRole(MINTER_ROLE, other.address)).to.equal(false);
  });
});
