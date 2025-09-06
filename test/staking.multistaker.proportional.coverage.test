/* eslint-disable no-undef */
const { expect } = require("chai");
const { ethers } = require("hardhat");

const parse = (v) => (ethers.parseEther ? ethers.parseEther(v) : ethers.utils.parseEther(v));
const waitDeployed = async (c) => (c.waitForDeployment ? c.waitForDeployment() : c.deployed());
const addrOf = async (c) => (c.getAddress ? c.getAddress() : c.address);

describe("StarforgeStaking — multi-staker proportionality (same OG rank)", function () {
  let owner, funder, alice, bob, carol, og, sfg, staking;

  beforeEach(async () => {
    [owner, funder, alice, bob, carol] = await ethers.getSigners();

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

    // Give ALL three the SAME OG rank so boost is identical across them
    // (Ensures rewards split purely by stake proportions.)
    try {
      await og.connect(owner).mint(alice.address, 1);
      await og.connect(owner).mint(bob.address, 1);
      await og.connect(owner).mint(carol.address, 1);
    } catch {
      const MINTER_ROLE = await og.MINTER_ROLE();
      await og.connect(owner).grantRole(MINTER_ROLE, owner.address);
      await og.connect(owner).mint(alice.address, 1);
      await og.connect(owner).mint(bob.address, 1);
      await og.connect(owner).mint(carol.address, 1);
    }

    // Fund rewards pool once
    const rewardFund = parse("60000");
    await sfg.connect(funder).transfer(await addrOf(staking), rewardFund);
    await staking.connect(owner).notifyRewardReceived(rewardFund);

    // Stakes in 1 : 2 : 7 ratio (Alice : Bob : Carol)
    const stakeA = parse("1000");
    const stakeB = parse("2000");
    const stakeC = parse("7000");

    // Distribute stake tokens
    await sfg.connect(funder).transfer(alice.address, stakeA);
    await sfg.connect(funder).transfer(bob.address, stakeB);
    await sfg.connect(funder).transfer(carol.address, stakeC);

    // Approvals
    await sfg.connect(alice).approve(await addrOf(staking), stakeA);
    await sfg.connect(bob).approve(await addrOf(staking), stakeB);
    await sfg.connect(carol).approve(await addrOf(staking), stakeC);

    // Stake
    await staking.connect(alice).stake(stakeA);
    await staking.connect(bob).stake(stakeB);
    await staking.connect(carol).stake(stakeC);
  });

  it("rewards split ~1:2:7 when all have same rank", async () => {
    // accrue ~30 days
    await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 30]);
    await ethers.provider.send("evm_mine");

    const balA0 = await sfg.balanceOf(alice.address);
    const balB0 = await sfg.balanceOf(bob.address);
    const balC0 = await sfg.balanceOf(carol.address);
    const reserve0 = await staking.rewardsReserve();

    await staking.connect(alice).claimRewards();
    await staking.connect(bob).claimRewards();
    await staking.connect(carol).claimRewards();

    const balA1 = await sfg.balanceOf(alice.address);
    const balB1 = await sfg.balanceOf(bob.address);
    const balC1 = await sfg.balanceOf(carol.address);
    const reserve1 = await staking.rewardsReserve();

    const rA = balA1 - balA0;
    const rB = balB1 - balB0;
    const rC = balC1 - balC0;

    expect(rA).to.be.gt(0n);
    expect(rB).to.be.gt(0n);
    expect(rC).to.be.gt(0n);
    expect(rC).to.be.gt(rB);
    expect(rB).to.be.gt(rA);

    // Target ratios: A:B:C = 1:2:7
    // Cross-multiply checks to avoid floats
    const diffAB = (rA * 2n > rB) ? (rA * 2n - rB) : (rB - rA * 2n);
    const diffAC = (rA * 7n > rC) ? (rA * 7n - rC) : (rC - rA * 7n);
    const diffBC = (rB * 7n > rC * 2n) ? (rB * 7n - rC * 2n) : (rC * 2n - rB * 7n);

    // Allow small rounding drift (~2%) + a few wei
    const tolAB = rB / 50n + 10n;      // ~2% of B + 10 wei
    const tolAC = rC / 50n + 10n;      // ~2% of C + 10 wei
    const tolBC = (rC * 2n) / 50n + 10n;

    expect(diffAB).to.be.lte(tolAB);
    expect(diffAC).to.be.lte(tolAC);
    expect(diffBC).to.be.lte(tolBC);

    // Reserve accounting: decrease ~= total paid
    const paid = reserve0 - reserve1;
    const sum = rA + rB + rC;
    const dust = paid > sum ? paid - sum : sum - paid;
    expect(dust).to.be.lte(10n);
  });
});
