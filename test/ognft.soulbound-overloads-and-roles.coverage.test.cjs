/* eslint-disable no-unused-expressions */
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OGNFT — soulbound overloads & roles (extra coverage)", function () {
  async function deployOG() {
    const [owner, minter, alice, bob, operator] = await ethers.getSigners();

    const OGNFT = await ethers.getContractFactory("OGNFT");
    // Assumes no constructor args (matches your existing OGNFT tests).
    const og = await OGNFT.deploy();
    await og.waitForDeployment();

    // Grant MINTER_ROLE to `minter` so we can mint from a non-admin later.
    const MINTER_ROLE = await og.MINTER_ROLE();
    await og.grantRole(MINTER_ROLE, minter.address);

    return { owner, minter, alice, bob, operator, og, MINTER_ROLE };
  }

  it("blocks both safeTransferFrom overloads (soulbound)", async function () {
    const { minter, alice, bob, og } = await deployOG();

    // Mint a token with a valid rank to Alice.
    // (Your suite already validates rank bounds elsewhere; we just need a valid rank here.)
    const validRank = 1;
    await og.connect(minter).mint(alice.address, validRank);

    // Overload #1: safeTransferFrom(address,address,uint256)
    await expect(
      og
        .connect(alice)
        ["safeTransferFrom(address,address,uint256)"](alice.address, bob.address, 1)
    ).to.be.reverted;

    // Overload #2: safeTransferFrom(address,address,uint256,bytes)
    await expect(
      og
        .connect(alice)
        ["safeTransferFrom(address,address,uint256,bytes)"](alice.address, bob.address, 1, "0x")
    ).to.be.reverted;
  });

  it("setApprovalForAll is blocked (soulbound)", async function () {
    const { minter, alice, operator, og } = await deployOG();

    const validRank = 1;
    await og.connect(minter).mint(alice.address, validRank);

    await expect(
      og.connect(alice).setApprovalForAll(operator.address, true)
    ).to.be.reverted;
  });

  it("revoking MINTER_ROLE prevents minting", async function () {
    const { owner, minter, alice, og, MINTER_ROLE } = await deployOG();

    const rank = 1;

    // Sanity: minter can mint when role is present
    await og.connect(minter).mint(alice.address, rank);

    // Revoke and ensure further minting fails
    await og.connect(owner).revokeRole(MINTER_ROLE, minter.address);

    await expect(
      og.connect(minter).mint(alice.address, rank)
    ).to.be.reverted; // AccessControl revert string includes dynamic data; just assert revert.
  });
});
