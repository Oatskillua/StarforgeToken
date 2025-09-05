/* eslint-disable node/no-unpublished-require */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

async function deployOgFixture() {
  const [owner] = await ethers.getSigners();
  const og = await ethers.deployContract("OGNFT", []);
  await og.waitForDeployment();
  return { owner, og };
}

describe("OGNFT — extras (edges for coverage)", function () {
  it("tokenURI(nonexistent) reverts & supportsInterface negative id", async function () {
    const { owner, og } = await loadFixture(deployOgFixture);

    // Grant MINTER_ROLE if your constructor sets it to admin by default, else skip
    const MINTER_ROLE = await og.MINTER_ROLE();
    await (await og.grantRole(MINTER_ROLE, owner.address)).wait();

    // Mint one legit token to avoid empty-state weirdness
    await (await og.mint(owner.address, 1)).wait();

    // Negative interface id
    expect(await og.supportsInterface("0xffffffff")).to.equal(false);

    // Nonexistent tokenURI revert (use a clearly out-of-range id)
    await expect(og.tokenURI(9999n)).to.be.revertedWith("Nonexistent token");
  });
});
