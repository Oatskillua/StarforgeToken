// TreasuryVesting — recoverERC20 / clearAllocation / views (extra coverage)
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

const toWei = (v) => ethers.parseUnits(String(v), 18);
const YEAR = 365 * 24 * 60 * 60;

describe("TreasuryVesting — recover & clear & views (coverage)", function () {
  let owner, beneficiary, recipient, funder, treasury, council;
  let ogNFT, sft, vesting;

  beforeEach(async () => {
    [owner, beneficiary, recipient, funder, treasury, council] = await ethers.getSigners();

    // OGNFT
    const OGNFT = await ethers.getContractFactory("OGNFT");
    ogNFT = await OGNFT.deploy();
    await ogNFT.waitForDeployment();

    // Core token (SFT)
    const StarForge = await ethers.getContractFactory("StarForge");
    sft = await StarForge.deploy(
      await owner.getAddress(),
      await treasury.getAddress(),
      await council.getAddress(),
      await ogNFT.getAddress()
    );
    await sft.waitForDeployment();

    // TreasuryVesting
    const TreasuryVesting = await ethers.getContractFactory("TreasuryVesting");
    vesting = await TreasuryVesting.deploy(await sft.getAddress());
    await vesting.waitForDeployment();

    // Unlimited approval so vesting can pull SFT when needed (init SRV / setAllocation)
    await sft.connect(owner).approve(await vesting.getAddress(), ethers.MaxUint256);
  });

  it("recoverERC20 for non-SFT succeeds; recovering SFT reverts", async () => {
    // Use a second ERC20 (deploy another StarForge) as the "other token"
    const StarForge = await ethers.getContractFactory("StarForge");
    const other = await StarForge.deploy(
      await owner.getAddress(),
      await treasury.getAddress(),
      await council.getAddress(),
      await ogNFT.getAddress()
    );
    await other.waitForDeployment();

    // Send some OTHER tokens to the vesting contract
    const amt = toWei("123");
    await other.connect(owner).transfer(await vesting.getAddress(), amt);

    const beforeCtrOther = await other.balanceOf(await vesting.getAddress());
    const beforeRecOther = await other.balanceOf(await recipient.getAddress());
    expect(beforeCtrOther).to.equal(amt);

    // Happy path: recover OTHER
    await vesting.connect(owner).recoverERC20(await other.getAddress(), amt, await recipient.getAddress());

    const afterCtrOther = await other.balanceOf(await vesting.getAddress());
    const afterRecOther = await other.balanceOf(await recipient.getAddress());
    expect(afterCtrOther).to.equal(0n);
    expect(afterRecOther - beforeRecOther).to.equal(amt);

    // Deny recovering core SFT (if contract forbids it)
    await expect(
      vesting.connect(owner).recoverERC20(await sft.getAddress(), 1n, await recipient.getAddress())
    ).to.be.reverted;
  });

  it("clearAllocation zeros schedule and disallows further claims", async () => {
    // Create an allocation funded by owner
    const allocAmt = toWei("100000");
    const duration = BigInt(YEAR);

    // setAllocation(address,uint256,uint256,address)
    await vesting
      .connect(owner)
      .setAllocation(await beneficiary.getAddress(), allocAmt, duration, await owner.getAddress());

    // Move to mid-vesting so something is vested
    await ethers.provider.send("evm_increaseTime", [Math.floor(Number(duration / 2n))]);
    await ethers.provider.send("evm_mine", []);

    const latest = await ethers.provider.getBlock("latest");
    const tp = BigInt(latest.timestamp);

    // There should be a positive vested amount before clear
    const vestedBefore = await vesting.vestedAmount(await beneficiary.getAddress(), tp);
    expect(vestedBefore).to.be.gt(0n);

    // Clear allocation to some recipient (should wipe schedule)
    await vesting
      .connect(owner)
      .clearAllocation(await beneficiary.getAddress(), await recipient.getAddress());

    // After clear: nothing more vests
    const vestedAfter = await vesting.vestedAmount(await beneficiary.getAddress(), tp + 1n);
    expect(vestedAfter).to.equal(0n);

    // And claiming should not release anything anymore
    await expect(
      vesting.connect(owner).claimVestedTokens(await beneficiary.getAddress())
    ).to.be.reverted;
  });

  it("view props after initStakingRewardsVault", async () => {
    // Initialize SRV (pull percent from owner); we approved Max already
    const percentBps = 1500; // 15%
    await vesting
      .connect(owner)
      .initStakingRewardsVault(percentBps, await owner.getAddress());

    // Call views to tick lines & assert basics
    const initted = await vesting.stakingVaultInitialized();
    expect(initted).to.equal(true);

    const cap = await vesting.stakingVaultCap();
    const bal = await vesting.stakingVaultBalance();
    expect(cap).to.be.gt(0n);
    expect(bal).to.be.gt(0n);
    expect(cap).to.be.gte(bal);

    // Also touch the struct-ish getter if present
    await vesting.stakingVaultInfo(); // no assertion needed; exercises view
  });
});
