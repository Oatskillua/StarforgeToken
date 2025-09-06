/* eslint-disable no-undef */
const { expect } = require("chai");
const { ethers } = require("hardhat");

const parse = (v) => (ethers.parseEther ? ethers.parseEther(v) : ethers.utils.parseEther(v));
const waitDeployed = async (c) => (c.waitForDeployment ? c.waitForDeployment() : c.deployed());
const addrOf = async (c) => (c.getAddress ? c.getAddress() : c.address);

describe("OGNFT ↔ Staking — rank boost integration (non-brittle)", function () {
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

    // Rewards funder = owner for this test (permissioned notify)
    await staking.connect(owner).setRewardsFunder(owner.address);

    // Mint an OG rank to Alice (assumes owner has MINTER_ROLE by default; if not, grant it)
    try {
      await og.connect(owner).mint(alice.address, 1); // rank 1 as a baseline boost
    } catch {
      const MINTER_ROLE = await og.MINTER_ROLE();
      await og.connect(owner).grantRole(MINTER_ROLE, owner.address);
      await og.connect(owner).mint(alice.address, 1);
    }

    // Fund rewards pool (push-based): move tokens into staking, then notify exact amount
    const rewardFund = parse("10000");
    await sfg.connect(funder).transfer(await addrOf(staking), rewardFund);
    await staking.connect(owner).notifyRewardReceived(rewardFund);

    // Give Alice and Bob equal stake balances
    const stakeAmt = parse("1000");
    await sfg.connect(funder).transfer(alice.address, stakeAmt);
    await sfg.connect(funder).transfer(bob.address, stakeAmt);
    await sfg.connect(alice).approve(await addrOf(staking), stakeAmt);
    await sfg.connect(bob).approve(await addrOf(staking), stakeAmt);

    // Stake equal amounts
    await staking.connect(alice).stake(stakeAmt);
    await staking.connect(bob).stake(stakeAmt);
  });

  it("Alice (with OG rank) earns strictly more rewards than Bob (no OG)", async () => {
    // Let time pass to accrue rewards
    await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 30]); // +30 days
    await ethers.provider.send("evm_mine");

    // Track balances before
    const balA0 = await sfg.balanceOf(alice.address);
    const balB0 = await sfg.balanceOf(bob.address);
    const reserve0 = await staking.rewardsReserve();

    // Claims
    await staking.connect(alice).claimRewards();
    await staking.connect(bob).claimRewards();

    // Track balances after
    const balA1 = await sfg.balanceOf(alice.address);
    const balB1 = await sfg.balanceOf(bob.address);
    const reserve1 = await staking.rewardsReserve();

    const rewardA = balA1 - balA0;
    const rewardB = balB1 - balB0;

    // Non-brittle assertions: both > 0, OG > non-OG, reserve decreased by ≈ sum of claims
    expect(rewardA).to.be.gt(0n);
    expect(rewardB).to.be.gt(0n);
    expect(rewardA).to.be.gt(rewardB);

    const paidOut = reserve0 - reserve1;
    // allow for minor rounding dust
    const diff = (paidOut > rewardA + rewardB) ? (paidOut - (rewardA + rewardB)) : ((rewardA + rewardB) - paidOut);
    expect(diff).to.be.lte(10n);
  });
});
