/* eslint-disable no-unused-expressions */
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OGNFT — approvals & operator edges (soulbound)", function () {
  it("blocks approve / setApprovalForAll and keeps readbacks sane", async function () {
    const [owner, alice, bob] = await ethers.getSigners();

    const OGNFT = await ethers.getContractFactory("OGNFT");
    const og = await OGNFT.deploy();
    await og.waitForDeployment();

    // Grant MINTER_ROLE to owner so we can mint
    const MINTER_ROLE = await og.MINTER_ROLE();
    await og.grantRole(MINTER_ROLE, owner.address);

    // Mint a valid rank token to owner
    const rank = 1;
    await og.mint(owner.address, rank);
    const tokenId = 1; // first mint should be tokenId 1 in this contract

    // Baseline readbacks
    expect(await og.isApprovedForAll(owner.address, alice.address)).to.equal(false);
    expect(await og.getApproved(tokenId)).to.equal(ethers.ZeroAddress);

    // Approvals are blocked for soulbound tokens
    await expect(og.connect(owner).approve(alice.address, tokenId)).to.be.reverted;
    await expect(og.connect(owner).setApprovalForAll(alice.address, true)).to.be.reverted;

    // Readbacks remain unchanged
    expect(await og.isApprovedForAll(owner.address, alice.address)).to.equal(false);
    expect(await og.getApproved(tokenId)).to.equal(ethers.ZeroAddress);

    // Non-owner also cannot approve / setApprovalForAll
    await expect(og.connect(bob).approve(alice.address, tokenId)).to.be.reverted;
    await expect(og.connect(bob).setApprovalForAll(alice.address, true)).to.be.reverted;
  });

  it("nonexistent token approvals & queries revert cleanly", async function () {
    const [owner, alice] = await ethers.getSigners();

    const OGNFT = await ethers.getContractFactory("OGNFT");
    const og = await OGNFT.deploy();
    await og.waitForDeployment();

    const MINTER_ROLE = await og.MINTER_ROLE();
    await og.grantRole(MINTER_ROLE, owner.address);
    await og.mint(owner.address, 1); // create at least one token (id 1)

    const nonexistentId = 999999;

    // Approving a nonexistent token should revert (non-brittle check)
    await expect(og.connect(owner).approve(alice.address, nonexistentId)).to.be.reverted;

    // Querying getApproved on a nonexistent token should also revert
    await expect(og.getApproved(nonexistentId)).to.be.reverted;

    // isApprovedForAll is an address-pair check (not token-bound) — default stays false
    expect(await og.isApprovedForAll(owner.address, alice.address)).to.equal(false);
  });

  it("setApprovalForAll remains blocked even before any mints", async function () {
    const [, alice] = await ethers.getSigners();

    const OGNFT = await ethers.getContractFactory("OGNFT");
    const og = await OGNFT.deploy();
    await og.waitForDeployment();

    // No tokens minted; still should revert because contract is soulbound
    await expect(og.setApprovalForAll(alice.address, true)).to.be.reverted;
  });
});
