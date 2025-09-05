// test/treasury.srv.reinit.revert.coverage.test.cjs
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

describe("TreasuryVesting — SRV re-init revert (coverage)", function () {
  const toWei = (v) => ethers.parseUnits(v, 18);

  let deployer, treasury, council;
  let ogNFT, token, vesting;

  beforeEach(async () => {
    [deployer, treasury, council] = await ethers.getSigners();

    // OGNFT
    const OGNFT = await ethers.getContractFactory("OGNFT");
    ogNFT = await OGNFT.deploy();
    await ogNFT.waitForDeployment();

    // StarForge
    const StarForge = await ethers.getContractFactory("StarForge");
    token = await StarForge.deploy(
      await deployer.getAddress(),
      await treasury.getAddress(),
      await council.getAddress(),
      await ogNFT.getAddress()
    );
    await token.waitForDeployment();

    // TreasuryVesting (constructor: (address sfgToken))
    const TreasuryVesting = await ethers.getContractFactory("TreasuryVesting");
    vesting = await TreasuryVesting.deploy(await token.getAddress());
    await vesting.waitForDeployment();

    // Ensure vesting can pull from deployer if it uses transferFrom under the hood
    await token.approve(await vesting.getAddress(), ethers.MaxUint256);
  });

  it("second initStakingRewardsVault call reverts (already initialized)", async () => {
    // First init within bounds [15%, 20%]; choose 15% = 1500 bps
    const pctBps = 1500;
    const funder = await deployer.getAddress();

    await expect(vesting.initStakingRewardsVault(pctBps, funder)).to.not.be.reverted;

    // Repeat should revert on "already initialized" branch (reason may vary; don't assert message)
    await expect(vesting.initStakingRewardsVault(pctBps, funder)).to.be.reverted;
  });
});
