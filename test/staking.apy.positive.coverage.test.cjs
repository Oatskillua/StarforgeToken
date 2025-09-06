/* eslint-disable no-undef */
const { expect } = require("chai");
const { ethers } = require("hardhat");

const parse = (v) => (ethers.parseEther ? ethers.parseEther(v) : ethers.utils.parseEther(v));
const waitDeployed = async (c) => (c.waitForDeployment ? c.waitForDeployment() : c.deployed());
const addrOf = async (c) => (c.getAddress ? c.getAddress() : c.address);
const bn = (x) => BigInt(x);

describe("StarforgeStaking — positive APY update within step after cooldown", function () {
  let owner, funder, alice, og, sfg, staking;

  beforeEach(async () => {
    [owner, funder, alice] = await ethers.getSigners();

    // Deploy OG (no special setup needed for this test)
    const OGNFT = await ethers.getContractFactory("OGNFT");
    og = await OGNFT.deploy();
    await waitDeployed(og);

    // Deploy SFG token: funder holds initial supply
    // StarForge args: (initialHolder, treasury, council, ogAddress)
    const StarForge = await ethers.getContractFactory("StarForge");
    sfg = await StarForge.deploy(
      funder.address,
      owner.address,
      owner.address,
      await addrOf(og)
    );
    await waitDeployed(sfg);

    // Deploy Staking
    const Staking = await ethers.getContractFactory("StarforgeStaking");
    staking = await Staking.deploy(await addrOf(sfg), await addrOf(og));
    await waitDeployed(staking);

    // ----- Prepare reward reserve & funder -----
    // Set the rewards funder to the account that will call notifyRewardReceived
    await staking.connect(owner).setRewardsFunder(owner.address);

    // Move a healthy chunk of SFG into the staking contract, then notify.
    // Use a fraction of the funder's balance to avoid assuming an exact supply.
    const funderBal = await sfg.balanceOf(funder.address);
    let reserveAmt = funderBal / 10n; // 10% of funder balance
    if (reserveAmt === 0n) {
      // extremely defensive fallback (shouldn't happen with real supply)
      reserveAmt = parse("1000");
    }

    // Push-based funding: transfer tokens to the staking contract, then notify as the designated funder.
    await sfg.connect(funder).transfer(await addrOf(staking), reserveAmt);
    await staking.connect(owner).notifyRewardReceived(reserveAmt);

    // ----- Prepare a small stake so runway is generous -----
    // Give Alice some SFG and stake a small amount compared to reserve.
    const stakeAmt = (await sfg.balanceOf(funder.address)) / 100n; // ~1% of remaining funder bal
    const chosenStake = stakeAmt > 0n ? stakeAmt : parse("10");
    await sfg.connect(funder).transfer(alice.address, chosenStake);
    await sfg.connect(alice).approve(await addrOf(staking), chosenStake);
    await staking.connect(alice).stake(chosenStake);
  });

  it("updates APY by ≤100 bps after 90 days and affects rewards", async () => {
    // Cooldown: 90 days must pass before updating base APY
    const ninetyDays = 90 * 24 * 60 * 60;
    await ethers.provider.send("evm_increaseTime", [ninetyDays]);
    await ethers.provider.send("evm_mine");

    // Read current base APY and increase within step (≤100 bps)
    const current = await staking.baseApyBps();
    const increment = 50; // 50 bps <= 100 bps step
    const target = bn(current) + bn(increment);

    // Owner updates APY — should NOT revert (cooldown satisfied & within step)
    await staking.connect(owner).setBaseApyBps(target);

    // Confirm it took effect
    const after = await staking.baseApyBps();
    expect(after).to.equal(target);

    // Let some time pass to accrue rewards at the new APY
    const thirtyDays = 30 * 24 * 60 * 60;
    await ethers.provider.send("evm_increaseTime", [thirtyDays]);
    await ethers.provider.send("evm_mine");

    // Snapshot reserve, claim, and verify reserve decreased (rewards paid out)
    const beforeReserve = await staking.rewardsReserve();
    await staking.connect(alice).claimRewards();
    const afterReserve = await staking.rewardsReserve();
    expect(afterReserve).to.be.lt(beforeReserve); // reserve reduced => rewards paid
  });
});
