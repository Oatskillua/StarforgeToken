/* eslint-disable no-unused-expressions */
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OGNFT — transfers & approvals revert (extra coverage)", function () {
  async function deployAndMint() {
    const [owner, minter, alice, bob, operator] = await ethers.getSigners();

    const OGNFT = await ethers.getContractFactory("OGNFT");
    const og = await OGNFT.deploy();
    await og.waitForDeployment();

    const MINTER_ROLE = await og.MINTER_ROLE();
    await og.grantRole(MINTER_ROLE, minter.address);

    const tokenId = 1;
    const validRank = 1;
    await og.connect(minter).mint(alice.address, validRank);

    return { owner, minter, alice, bob, operator, og, tokenId };
  }

  it("transferFrom overload reverts (soulbound)", async function () {
    const { alice, bob, og, tokenId } = await deployAndMint();

    await expect(
      og
        .connect(alice)
        ["transferFrom(address,address,uint256)"](alice.address, bob.address, tokenId)
    ).to.be.reverted;
  });

  it("approve & getApproved: approve reverts; getApproved stays zero", async function () {
    const { alice, og, tokenId } = await deployAndMint();

    // ERC721::approve should be blocked for soulbound.
    await expect(og.connect(alice).approve(alice.address, tokenId)).to.be.reverted;

    // Readback should remain zero since approvals can't be set.
    expect(await og.getApproved(tokenId)).to.equal(ethers.ZeroAddress);
  });

  it("isApprovedForAll default false; setApprovalForAll reverts", async function () {
    const { alice, operator, og } = await deployAndMint();

    expect(await og.isApprovedForAll(alice.address, operator.address)).to.equal(false);

    await expect(
      og.connect(alice).setApprovalForAll(operator.address, true)
    ).to.be.reverted;
  });
});
