// OGNFT — EOA mint + revoke/grant role cycle (extra coverage)
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

describe("OGNFT — EOA mint & role cycle (coverage)", function () {
  let og, owner, user;

  beforeEach(async () => {
    [owner, user] = await ethers.getSigners();
    const OGNFT = await ethers.getContractFactory("OGNFT");
    og = await OGNFT.deploy();
    await og.waitForDeployment();

    // Give deployer MINTER_ROLE
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    await og.connect(owner).grantRole(MINTER_ROLE, await owner.getAddress());
  });

  it("safe-mints to an EOA address", async () => {
    // Rank 1 is a valid rank in your suite; mint to EOA address
    await og.connect(owner).mint(await user.getAddress(), 1);

    const bal = await og.balanceOf(await user.getAddress());
    expect(bal).to.equal(1n);

    // Touch tokenURI of the first token (non-empty)
    const uri = await og.tokenURI(1);
    expect(uri.length).to.be.greaterThan(0);
  });

  it("revoking MINTER_ROLE blocks mint; granting back re-enables mint", async () => {
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

    // Revoke role from owner
    await og.connect(owner).revokeRole(MINTER_ROLE, await owner.getAddress());

    // Now mint should revert
    await expect(og.connect(owner).mint(await user.getAddress(), 1)).to.be.reverted;

    // Grant back and mint works
    await og.connect(owner).grantRole(MINTER_ROLE, await owner.getAddress());
    await og.connect(owner).mint(await user.getAddress(), 1);

    const bal = await og.balanceOf(await user.getAddress());
    expect(bal).to.equal(1n); // exactly one successful mint in this test
  });
});
