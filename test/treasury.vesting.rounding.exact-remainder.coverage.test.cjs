// test/treasury.vesting.rounding.exact-remainder.coverage.test.cjs
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

describe("TreasuryVesting — rounding & exact remainder (coverage)", function () {
  const toWei = (v) => ethers.parseUnits(v, 18);
  const ONE_YEAR = 365 * 24 * 60 * 60;

  let owner, alice, treasury, council, vestAdmin, beneficiary;
  let token, ogNFT, vesting;

  beforeEach(async function () {
    [owner, alice, treasury, council, vestAdmin, beneficiary] = await ethers.getSigners();

    const OGNFT = await ethers.getContractFactory("OGNFT");
    ogNFT = await OGNFT.deploy();
    await ogNFT.waitForDeployment();

    const StarForge = await ethers.getContractFactory("StarForge");
    token = await StarForge.deploy(
      await owner.getAddress(),
      await treasury.getAddress(),
      await council.getAddress(),
      await ogNFT.getAddress()
    );
    await token.waitForDeployment();

    const Vesting = await ethers.getContractFactory("TreasuryVesting");
    vesting = await Vesting.deploy(await token.getAddress());
    await vesting.waitForDeployment();

    // Grant vest admin role
    const VESTING_ADMIN_ROLE = await vesting.VESTING_ADMIN_ROLE();
    await vesting.grantRole(VESTING_ADMIN_ROLE, await vestAdmin.getAddress());
  });

  it("t0 -> 0, mid -> partial, end -> exact remainder; then no more claimable", async function () {
    const total = toWei("100000");        // 100k SFT
    const duration = ONE_YEAR;

    // Seed and approve from the same address you pass as the funder
    await token.transfer(await vestAdmin.getAddress(), total);
    await token.connect(vestAdmin).approve(await vesting.getAddress(), total);

    // Create allocation funded by vestAdmin
    await vesting
      .connect(vestAdmin)
      .setAllocation(await beneficiary.getAddress(), total, duration, await vestAdmin.getAddress());

    // At t0 nothing vested (don't claim; just check view)
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    const t0Vested = await vesting.vestedAmount(await beneficiary.getAddress(), now);
    expect(t0Vested).to.equal(0n);

    // Halfway: partial claim
    await ethers.provider.send("evm_increaseTime", [Math.floor(duration / 2)]);
    await ethers.provider.send("evm_mine");

    const balBefore1 = await token.balanceOf(await beneficiary.getAddress());
    await vesting.connect(beneficiary).claimVestedTokens(await beneficiary.getAddress());
    const balAfter1 = await token.balanceOf(await beneficiary.getAddress());
    const claimed1 = balAfter1 - balBefore1;

    expect(claimed1).to.be.greaterThan(0n);
    expect(claimed1).to.be.lessThan(total);

    // End: claim exact remainder
    await ethers.provider.send("evm_increaseTime", [duration + 1]);
    await ethers.provider.send("evm_mine");

    const balBefore2 = await token.balanceOf(await beneficiary.getAddress());
    await vesting.connect(beneficiary).claimVestedTokens(await beneficiary.getAddress());
    const balAfter2 = await token.balanceOf(await beneficiary.getAddress());
    const claimed2 = balAfter2 - balBefore2;

    expect(claimed1 + claimed2).to.equal(total);

    // Nothing left
    await expect(
      vesting.connect(beneficiary).claimVestedTokens(await beneficiary.getAddress())
    ).to.be.revertedWith("No tokens to release");
  });
});
