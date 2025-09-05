/* eslint-disable no-unused-expressions */
// test/ognft.access.coverage.test.cjs
const hre = require("hardhat");
const { expect } = require("chai");
const { ethers } = hre;

describe("OGNFT — AccessControl edges (coverage)", function () {
  it("only admin can grant MINTER_ROLE; holder can renounce their role", async function () {
    const [admin, user, notAdmin] = await ethers.getSigners();

    const OGNFT = await ethers.getContractFactory("OGNFT", admin);
    const og = await OGNFT.deploy();
    await og.waitForDeployment();

    const DEFAULT_ADMIN_ROLE = await og.DEFAULT_ADMIN_ROLE();
    const MINTER_ROLE = await og.MINTER_ROLE();

    // Admin can grant MINTER_ROLE
    await expect(og.grantRole(MINTER_ROLE, user.address))
      .to.emit(og, "RoleGranted")
      .withArgs(MINTER_ROLE, user.address, admin.address);

    // Non-admin cannot grant roles
    await expect(
      og.connect(notAdmin).grantRole(MINTER_ROLE, notAdmin.address)
    ).to.be.reverted;

    // Holder can renounce their own role
    await expect(og.connect(user).renounceRole(MINTER_ROLE, user.address))
      .to.emit(og, "RoleRevoked")
      .withArgs(MINTER_ROLE, user.address, user.address);

    // Sanity: admin still has DEFAULT_ADMIN_ROLE
    expect(await og.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.equal(true);
  });
});
