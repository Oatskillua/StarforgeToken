/* eslint-disable no-undef */
const { expect } = require("chai");
const { ethers } = require("hardhat");

const parse = (v) => (ethers.parseEther ? ethers.parseEther(v) : ethers.utils.parseEther(v));
const waitDeployed = async (c) => (c.waitForDeployment ? c.waitForDeployment() : c.deployed());
const addrOf = async (c) => (c.getAddress ? c.getAddress() : c.address);

describe("StarforgeStaking — fairness when both have same OG rank", function () {
  let owner, funder, alice, bob, og, sfg, staking;

  beforeEach(async () => {
    [owner, funder, alice, bob] = await ethers.getSigners();

    // OGNFT
    const OGNFT = await ethers.getContractFactory("OGNFT");
    og = await OGNFT.deploy();
    await waitDeployed(og);

    // SFG token
    const StarForge = await ethers.getContractFactory("StarForge");
    sfg = await StarForge.deploy(
      funder.address,
      owner.address,  // treasury
      owner.address,  // council
      await addrOf(og)
    );
    await waitDeployed(sfg);

    // Staking
    const Staking = await ethers.getContractFactory("StarforgeStaking");
    staking = await Staking.deploy(await addrOf(sfg), await addrOf(og));
    await waitDeployed(staking);

    // Rewards funder
    await staking.connect(owner).setRewardsFunder(owner.address);

    // Mint the same OG rank to Alice & Bob
    try {
      await og.connect(owner).mint(alice.address, 1);
      await og.connect(owner).mint(bob.address, 1);
    } catch {
      const MINTER_ROLE = await og.MINTER_ROLE();
      await og.connect(owner).grantRole(MINTER_ROLE, owner.address);
      await og.connect(owner).mint(alice.address, 1);
      await og.connect(owner).mint(bob.address, 1);
    }

    // Fund rewards
    const rewardFund = parse("15000");
    await sfg.connect(funder).transfer(await addrOf(staking), rewardFund);
    await staking.connect(owner).notifyRewardReceived(rewardFund);

    // Equal stakes
    const stakeAmt = parse("2000");
    await sfg.connect(funder).transfer(alice.address, stakeAmt);
    await sfg.connect(funder).transfer(bob.address, stakeAmt);
    await sfg.connect(alice).approve(await addrOf(staking), stakeAmt);
    await sfg.connect(bob).approve(await addrOf(staking), stakeAmt);
    await staking.connect(alice).stake(stakeAmt);
    await staking.connect(bob).stake(stakeAmt);
  });

  it("equal ranks + equal stakes → (nearly) equal rewards", async () => {
    await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 30]); // +30 days
    await ethers.provider.send("evm_mine");

    const balA0 = await sfg.balanceOf(alice.address);
    const balB0 = await sfg.balanceOf(bob.address);
    const reserve0 = await staking.rewardsReserve();

    await staking.connect(alice).claimRewards();
    await staking.connect(bob).claimRewards();

    const balA1 = await sfg.balanceOf(alice.address);
    const balB1 = await sfg.balanceOf(bob.address);
    const reserve1 = await staking.rewardsReserve();

    const rewardA = balA1 - balA0;
    const rewardB = balB1 - balB0;

    expect(rewardA).to.be.gt(0n);
    expect(rewardB).to.be.gt(0n);

    // They should be almost equal (tolerate rounding dust)
    const diff = rewardA > rewardB ? rewardA - rewardB : rewardB - rewardA;
    expect(diff).to.be.lte(10n);

    const paid = (reserve0 - reserve1);
    const dust = paid > rewardA + rewardB ? paid - (rewardA + rewardB) : (rewardA + rewardB) - paid;
    expect(dust).to.be.lte(10n);
  });
});
