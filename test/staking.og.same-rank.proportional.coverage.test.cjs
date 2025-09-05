/* eslint-disable no-undef */
const { expect } = require("chai");
const { ethers } = require("hardhat");

const parse = (v) => (ethers.parseEther ? ethers.parseEther(v) : ethers.utils.parseEther(v));
const waitDeployed = async (c) => (c.waitForDeployment ? c.waitForDeployment() : c.deployed());
const addrOf = async (c) => (c.getAddress ? c.getAddress() : c.address);

describe("StarforgeStaking — proportionality with equal OG rank and unequal stakes", function () {
  let owner, funder, alice, bob, og, sfg, staking;

  beforeEach(async () => {
    [owner, funder, alice, bob] = await ethers.getSigners();

    // OGNFT
    const OGNFT = await ethers.getContractFactory("OGNFT");
    og = await OGNFT.deploy();
    await waitDeployed(og);

    // SFG token (funder holds initial supply)
    const StarForge = await ethers.getContractFactory("StarForge");
    sfg = await StarForge.deploy(
      funder.address, // initial holder
      owner.address,  // treasury
      owner.address,  // council
      await addrOf(og)
    );
    await waitDeployed(sfg);

    // Staking
    const Staking = await ethers.getContractFactory("StarforgeStaking");
    staking = await Staking.deploy(await addrOf(sfg), await addrOf(og));
    await waitDeployed(staking);

    // Rewards funder = owner for notify()
    await staking.connect(owner).setRewardsFunder(owner.address);

    // Give both Alice & Bob the SAME OG rank (e.g., rank 1) so boosts are identical
    try {
      await og.connect(owner).mint(alice.address, 1);
      await og.connect(owner).mint(bob.address, 1);
    } catch {
      const MINTER_ROLE = await og.MINTER_ROLE();
      await og.connect(owner).grantRole(MINTER_ROLE, owner.address);
      await og.connect(owner).mint(alice.address, 1);
      await og.connect(owner).mint(bob.address, 1);
    }

    // Fund rewards pool
    const rewardFund = parse("40000");
    await sfg.connect(funder).transfer(await addrOf(staking), rewardFund);
    await staking.connect(owner).notifyRewardReceived(rewardFund);

    // Unequal stakes but same OG rank for both
    // Use 1:4 ratio to make proportionality check crisp
    const stakeA = parse("1000"); // Alice
    const stakeB = parse("4000"); // Bob

    await sfg.connect(funder).transfer(alice.address, stakeA);
    await sfg.connect(funder).transfer(bob.address, stakeB);

    await sfg.connect(alice).approve(await addrOf(staking), stakeA);
    await sfg.connect(bob).approve(await addrOf(staking), stakeB);

    await staking.connect(alice).stake(stakeA);
    await staking.connect(bob).stake(stakeB);
  });

  it("same rank boosts apply equally — reward ratio follows stake ratio", async () => {
    // accrue ~30 days
    await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 30]);
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
    expect(rewardB).to.be.gt(rewardA);

    // Because both have the SAME OG rank (same multiplier), the ratio should match stakes: 1:4
    // Cross-multiply to avoid floats: rewardB ≈ 4 * rewardA
    const ideal = rewardA * 4n;
    const diff = ideal > rewardB ? ideal - rewardB : rewardB - ideal;

    // Allow small rounding drift (~2%) + a few wei
    const tolerance = rewardB / 50n + 10n;
    expect(diff).to.be.lte(tolerance);

    // Reserve should have decreased by approximately the sum of both rewards
    const paid = reserve0 - reserve1;
    const dust = paid > rewardA + rewardB ? paid - (rewardA + rewardB) : (rewardA + rewardB) - paid;
    expect(dust).to.be.lte(10n);
  });
});
