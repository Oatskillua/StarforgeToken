/* eslint-disable no-undef */
const { expect } = require("chai");
const { ethers } = require("hardhat");

const parse = (v) => (ethers.parseEther ? ethers.parseEther(v) : ethers.utils.parseEther(v));
const waitDeployed = async (c) => (c.waitForDeployment ? c.waitForDeployment() : c.deployed());
const addrOf = async (c) => (c.getAddress ? c.getAddress() : c.address);

describe("StarforgeStaking — funding edges (funder role & reserve accounting)", function () {
  let owner, funder, bob, og, sfg, staking;

  beforeEach(async () => {
    [owner, funder, bob] = await ethers.getSigners();

    const OGNFT = await ethers.getContractFactory("OGNFT");
    og = await OGNFT.deploy();
    await waitDeployed(og);

    // StarForge(args): (initialHolder, treasury, council, ogAddress)
    const StarForge = await ethers.getContractFactory("StarForge");
    sfg = await StarForge.deploy(
      funder.address,
      owner.address,
      owner.address,
      await addrOf(og)
    );
    await waitDeployed(sfg);

    const Staking = await ethers.getContractFactory("StarforgeStaking");
    staking = await Staking.deploy(await addrOf(sfg), await addrOf(og));
    await waitDeployed(staking);
  });

  it("onlyOwner can set the rewards funder", async () => {
    await expect(staking.connect(bob).setRewardsFunder(bob.address)).to.be.reverted;

    await staking.connect(owner).setRewardsFunder(bob.address);
    // No explicit getter needed; behavior verified in next test by permission enforcement.
  });

  it("only designated funder can notify; reserve increases exactly by amount", async () => {
    // Make owner the funder for this test
    await staking.connect(owner).setRewardsFunder(owner.address);

    const amt = parse("1234");
    // Push-based funding: tokens must already be in the staking contract
    await sfg.connect(funder).transfer(await addrOf(staking), amt);

    // Non-funder should revert
    await expect(staking.connect(funder).notifyRewardReceived(amt)).to.be.reverted;

    // Funder succeeds; reserve increases
    const before = await staking.rewardsReserve();
    await staking.connect(owner).notifyRewardReceived(amt);
    const after = await staking.rewardsReserve();
    expect(after - before).to.equal(amt);
  });
});
