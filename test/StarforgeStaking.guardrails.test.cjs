// test/StarforgeStaking.guardrails.test.cjs
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

const {
  banner,
  dbg,
  staticCall,
  expectRevertSubstring,
  parse,
  waitDeployed,
  addrOf,
  fastForward,
} = require("./test.helpers.debug.cjs");

const DAY = 24 * 60 * 60;

describe("StarforgeStaking — guardrails & funding", function () {
  let owner, user, sfg, og, staking;

  async function deployAll() {
    [owner, user] = await ethers.getSigners();

    const OGNFT = await ethers.getContractFactory("OGNFT");
    og = await OGNFT.deploy();
    await waitDeployed(og);

    const StarForge = await ethers.getContractFactory("StarForge");
    sfg = await StarForge.deploy(
      owner.address, // founder
      owner.address, // treasury (BURNER_ROLE)
      owner.address, // council (PAUSER_ROLE)
      await addrOf(og)
    );
    await waitDeployed(sfg);

    // allow token to mint OG NFTs from burnUser()
    await og.grantRole(await og.MINTER_ROLE(), await addrOf(sfg));

    const Staking = await ethers.getContractFactory("StarforgeStaking");
    staking = await Staking.deploy(await addrOf(sfg), await addrOf(og));
    await waitDeployed(staking);

    // burn role to staking for the 1% unstake fee
    await sfg.grantRole(await sfg.BURNER_ROLE(), await addrOf(staking));

    // fund balances & set funder
    await sfg.transfer(user.address, parse("1000000"));
    await staking.setRewardsFunder(owner.address);
  }

  beforeEach(deployAll);

  it("push-based funding: notifyRewardReceived increases rewardsReserve", async () => {
    const tranche = parse("100000");
    await sfg.transfer(await addrOf(staking), tranche);
    await staking.notifyRewardReceived(tranche);
    expect(await staking.rewardsReserve()).to.equal(tranche);
  });

  // Effective APY cap with OG boost (200 bps) ⇒ base cap is 500 bps.
  it("APY hard cap: base must be ≤ 500 bps when OG boost is 200 bps", async () => {
    await fastForward(90 * DAY + 1);
    await staking.setBaseApyBps(450);

    await fastForward(90 * DAY + 1);
    await staking.setBaseApyBps(500);

    await fastForward(90 * DAY + 1);
    await expect(staking.setBaseApyBps(501)).to.be.revertedWith("Exceeds cap");
  });

  it("APY cooldown: cannot update within 90 days", async () => {
    await fastForward(90 * DAY + 1);
    await staking.setBaseApyBps(351);
    await expect(staking.setBaseApyBps(352)).to.be.revertedWith("Cooldown");
    await fastForward(90 * DAY + 1);
    await staking.setBaseApyBps(352);
  });

  it("APY step: update > 1% (100 bps) reverts", async () => {
    await fastForward(90 * DAY + 1);
    await expect(staking.setBaseApyBps(500)).to.be.revertedWith("Step too large"); // 350 -> 500 (+150)
    await staking.setBaseApyBps(450); // +100 bps allowed
  });

  /**
   * Dynamic runway test:
   * - If NO increase is possible (even +1), assert any increase reverts with "Runway < 7y"
   * - Else: set to the largest passing APY within +100 bps, then assert the next step reverts on runway.
   */
  it("Runway floor: raising APY that makes runway <7y reverts", async () => {
    banner("StarforgeStaking.guardrails — guardrails.v5-dynamic-no-step-ok");

    // Seed a realistic scenario: stake + reserve
    const stakeAmt = parse("100000");
    await sfg.connect(user).approve(await addrOf(staking), stakeAmt);
    await staking.connect(user).stake(stakeAmt);

    const tranche = parse("10000");
    await sfg.transfer(await addrOf(staking), tranche);
    await staking.notifyRewardReceived(tranche);

    const baseBefore = Number(await staking.baseApyBps());
    const reserve0 = await staking.rewardsReserve();
    const totalStaked0 = await (staking.totalStaked?.() ?? staking.totalStaked());
    dbg("initial baseApyBps:", baseBefore);
    dbg("initial reserve:", reserve0.toString(), "totalStaked:", totalStaked0.toString());

    // Respect cooldown before first change
    await fastForward(90 * DAY + 1);

    const current = baseBefore;
    const maxStep = Math.min(500, current + 100);
    dbg("probe bounds:", `(${current} -> ${maxStep}] by 10bps`);

    // Probe upward within the step, descending by 10 bps, to find a passing APY
    let foundOk = null;
    for (let candidate = maxStep; candidate > current; candidate -= 10) {
      try {
        await staticCall(staking, "setBaseApyBps", candidate);
        dbg("candidate passes (static):", candidate);
        foundOk = candidate;
        break;
      } catch (e) {
        dbg(
          "candidate fails (static):",
          candidate,
          "reason:",
          (e?.shortMessage || e?.reason || e?.message || "").toString()
        );
      }
    }

    // If *no* increase passes (even +1), assert any increase reverts and exit
    if (foundOk === null) {
      const tryOne = Math.min(maxStep, current + 1);
      dbg("no passing APY within step; asserting any increase (e.g.,", tryOne, ") reverts with runway");
      await expectRevertSubstring(
        staticCall(staking, "setBaseApyBps", tryOne),
        "Runway < 7y"
      );
      return;
    }

    // Safety: ensure we truly found a higher value
    if (foundOk <= current) {
      dbg("foundOk not greater than current; treating as no-pass scenario");
      const tryOne = Math.min(maxStep, current + 1);
      await expectRevertSubstring(
        staticCall(staking, "setBaseApyBps", tryOne),
        "Runway < 7y"
      );
      return;
    }

    dbg("setting baseApyBps to passing candidate:", foundOk);
    await staking.setBaseApyBps(foundOk);

    // Respect cooldown again before next attempt
    await fastForward(90 * DAY + 1);

    const nextTry = Math.min(500, foundOk + 100);
    dbg("probing next step (should revert on runway):", nextTry);
    await expectRevertSubstring(
      staticCall(staking, "setBaseApyBps", nextTry),
      "Runway < 7y"
    );
  });

  it("claimRewards reduces rewardsReserve by approximately the claim", async () => {
    const tranche = parse("5000");
    await sfg.transfer(await addrOf(staking), tranche);
    await staking.notifyRewardReceived(tranche);

    const stakeAmt = parse("100000");
    await sfg.connect(user).approve(await addrOf(staking), stakeAmt);
    await staking.connect(user).stake(stakeAmt);

    await fastForward(30 * DAY);

    const reserveBefore = await staking.rewardsReserve();
    const pendingApprox = await staking.pendingRewards(user.address);
    await staking.connect(user).claimRewards();
    const reserveAfter = await staking.rewardsReserve();

    expect(reserveAfter).to.be.lt(reserveBefore);
    const paid = reserveBefore - reserveAfter;
    expect(paid).to.be.gt(0n);
    const lower = (pendingApprox * 99n) / 100n;
    const upper = (pendingApprox * 101n) / 100n;
    expect(paid).to.be.gte(lower);
    expect(paid).to.be.lte(upper);
  });

  it("unstake burns 1% fee via token's burnExcessTreasury", async () => {
    const stakeAmt = parse("10000");
    await sfg.connect(user).approve(await addrOf(staking), stakeAmt);
    await staking.connect(user).stake(stakeAmt);

    const userBalBefore = await sfg.balanceOf(user.address);
    await staking.connect(user).unstake(stakeAmt);
    const userBalAfter = await sfg.balanceOf(user.address);

    // 1.00% fee → user receives 99.00%
    const expectedReceived = (stakeAmt * 9900n) / 10000n;
    expect(userBalAfter - userBalBefore).to.equal(expectedReceived);
  });
});
