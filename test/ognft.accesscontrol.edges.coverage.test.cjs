/* eslint-disable no-unused-expressions */
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OGNFT — AccessControl edges (coverage)", function () {
  it("only admin can grant MINTER_ROLE; non-admin grant/revoke reverts; holder can renounce", async function () {
    const [owner, alice, bob] = await ethers.getSigners();

    const OGNFT = await ethers.getContractFactory("OGNFT");
    const og = await OGNFT.deploy();
    await og.waitForDeployment();

    const DEFAULT_ADMIN_ROLE = await og.DEFAULT_ADMIN_ROLE();
    const MINTER_ROLE = await og.MINTER_ROLE();

    // Deployer should be default admin
    expect(await og.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.equal(true);

    // Non-admin cannot grant
    await expect(og.connect(bob).grantRole(MINTER_ROLE, alice.address)).to.be.reverted;

    // Admin grants MINTER_ROLE to Alice
    await og.grantRole(MINTER_ROLE, alice.address);
    expect(await og.hasRole(MINTER_ROLE, alice.address)).to.equal(true);

    // Alice can mint when she has MINTER_ROLE (quick smoke)
    await og.connect(alice).mint(alice.address, 1);
    // Token 1 should now exist owned by Alice
    expect(await og.ownerOf(1)).to.equal(alice.address);

    // Non-admin cannot revoke
    await expect(og.connect(bob).revokeRole(MINTER_ROLE, alice.address)).to.be.reverted;

    // Admin revokes MINTER_ROLE from Alice
    await og.revokeRole(MINTER_ROLE, alice.address);
    expect(await og.hasRole(MINTER_ROLE, alice.address)).to.equal(false);

    // Re-grant then test renounce from the holder
    await og.grantRole(MINTER_ROLE, alice.address);
    expect(await og.hasRole(MINTER_ROLE, alice.address)).to.equal(true);

    // Only the holder can renounce their own role
    await expect(og.connect(bob).renounceRole(MINTER_ROLE, alice.address)).to.be.reverted; // wrong caller
    await og.connect(alice).renounceRole(MINTER_ROLE, alice.address);
    expect(await og.hasRole(MINTER_ROLE, alice.address)).to.equal(false);
  });

  it("revoking MINTER_ROLE prevents further minting", async function () {
    const [owner, alice] = await ethers.getSigners();

    const OGNFT = await ethers.getContractFactory("OGNFT");
    const og = await OGNFT.deploy();
    await og.waitForDeployment();

    const MINTER_ROLE = await og.MINTER_ROLE();
    await og.grantRole(MINTER_ROLE, alice.address);

    // Alice mints once successfully
    await og.connect(alice).mint(alice.address, 1);
    expect(await og.ownerOf(1)).to.equal(alice.address);

    // Revoke and verify she can no longer mint
    await og.revokeRole(MINTER_ROLE, alice.address);
    await expect(og.connect(alice).mint(alice.address, 1)).to.be.reverted;
  });
});
