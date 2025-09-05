/* eslint-disable no-undef */
const { expect } = require("chai");
const { ethers } = require("hardhat");

// v5/v6 helpers
const parse = (v) => (ethers.parseEther ? ethers.parseEther(v) : ethers.utils.parseEther(v));
const waitDeployed = async (c) => (c.waitForDeployment ? c.waitForDeployment() : c.deployed());
const addrOf = async (c) => (c.getAddress ? c.getAddress() : c.address);

describe("TreasuryVesting — bounds & edges", function () {
  let owner, funder, other, og, sfg, staking, vesting;

  beforeEach(async () => {
    [owner, funder, other] = await ethers.getSigners();

    // OGNFT
    const OGNFT = await ethers.getContractFactory("OGNFT");
    og = await OGNFT.deploy();
    await waitDeployed(og);

    // SFG token — make funder the initial holder to simulate SRV funding
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

    // Vesting
    const TreasuryVesting = await ethers.getContractFactory("TreasuryVesting");
    vesting = await TreasuryVesting.deploy(await addrOf(sfg));
    await waitDeployed(vesting);

    // grant admin role for tests
    await vesting.grantRole(await vesting.VESTING_ADMIN_ROLE(), owner.address);
  });

  it("initStakingRewardsVault: rejects percentBps < 15% and > 20%", async () => {
    const tooLow = 1499; // < 15%
    const tooHigh = 2001; // > 20%

    await expect(
      vesting.connect(funder).initStakingRewardsVault(tooLow, funder.address)
    ).to.be.reverted;

    await expect(
      vesting.connect(funder).initStakingRewardsVault(tooHigh, funder.address)
    ).to.be.reverted;
  });

  it("initStakingRewardsVault: only the declared funder (msg.sender) can call", async () => {
    const percentBps = 1500;
    const total = await sfg.totalSupply();
    const cap = (total * BigInt(percentBps)) / 10000n;

    // funder must approve
    await sfg.connect(funder).approve(await addrOf(vesting), cap);

    // even if admin grants role, msg.sender must equal the declared funder arg
    await vesting.connect(owner).grantRole(await vesting.VESTING_ADMIN_ROLE(), funder.address);

    // wrong caller (owner) tries with funder set to "funder.addr" -> revert
    await expect(
      vesting.connect(owner).initStakingRewardsVault(percentBps, funder.address)
    ).to.be.reverted;

    // correct caller (funder) succeeds
    await vesting.connect(funder).initStakingRewardsVault(percentBps, funder.address);
    const [inited, capOut, balOut] = await vesting.stakingVaultInfo();
    expect(inited).to.equal(true);
    expect(capOut).to.equal(cap);
    expect(balOut).to.equal(cap);
  });

  it("fundStaking: rejects zero address and amount > SRV balance", async () => {
    // set up SRV at 15%
    const percentBps = 1500;
    const cap = (await sfg.totalSupply() * BigInt(percentBps)) / 10000n;
    await sfg.connect(funder).approve(await addrOf(vesting), cap);
    await vesting.connect(owner).grantRole(await vesting.VESTING_ADMIN_ROLE(), funder.address);
    await vesting.connect(funder).initStakingRewardsVault(percentBps, funder.address);

    await expect(vesting.fundStaking(ethers.ZeroAddress, 1n)).to.be.reverted;

    const [, , srvBalBefore] = await vesting.stakingVaultInfo();
    await expect(
      vesting.fundStaking(await addrOf(staking), srvBalBefore + 1n)
    ).to.be.reverted;
  });

  it("recoverExcessSFT: onlyOwner & zero amount checks; never drains SRV/escrow", async () => {
    // initialize SRV at 20% so there's a balance to protect
    const percentBps = 2000;
    const cap = (await sfg.totalSupply() * BigInt(percentBps)) / 10000n;
    await sfg.connect(funder).approve(await addrOf(vesting), cap);
    await vesting.connect(owner).grantRole(await vesting.VESTING_ADMIN_ROLE(), funder.address);
    await vesting.connect(funder).initStakingRewardsVault(percentBps, funder.address);
    const [, , srvBalBefore] = await vesting.stakingVaultInfo();

    // Create an escrow schedule to protect as well
    const scheduleAmt = parse("1000");
    const duration = 30 * 24 * 60 * 60;
    await sfg.connect(funder).transfer(owner.address, scheduleAmt);
    await sfg.connect(owner).approve(await addrOf(vesting), scheduleAmt);
    await vesting.connect(owner).setAllocation(owner.address, scheduleAmt, duration, owner.address);
    const escBefore = await vesting.totalEscrowed();

    // Add "extra" tokens to vesting contract so there is excess to recover
    const extra = parse("777");
    await sfg.connect(funder).transfer(await addrOf(vesting), extra);

    const vestBalBefore = await sfg.balanceOf(await addrOf(vesting));

    // Non-owner cannot call
    await expect(vesting.connect(funder).recoverExcessSFT(1n, owner.address)).to.be.reverted;

    // Zero amount is a NO-OP — must not revert and must not change balances
    const ownerBefore = await sfg.balanceOf(owner.address);
    await vesting.recoverExcessSFT(0n, owner.address);
    const ownerAfterNoop = await sfg.balanceOf(owner.address);
    expect(ownerAfterNoop).to.equal(ownerBefore);

    // Compute theoretical excess (vest bal - escrow - SRV)
    const [, , srvBalNow] = await vesting.stakingVaultInfo();
    const escNow = await vesting.totalEscrowed();
    const vestBalNow = await sfg.balanceOf(await addrOf(vesting));
    const excess = vestBalNow - escNow - srvBalNow;

    // Can't recover above excess
    await expect(vesting.recoverExcessSFT(excess + 1n, owner.address)).to.be.reverted;

    // Recover exactly the excess
    await vesting.recoverExcessSFT(excess, owner.address);

    // Invariants: SRV and escrow unchanged; vest contract balance reduced by "excess"
    const [, , srvBalAfter] = await vesting.stakingVaultInfo();
    const escAfter = await vesting.totalEscrowed();
    const vestBalAfter = await sfg.balanceOf(await addrOf(vesting));

    expect(srvBalAfter).to.equal(srvBalBefore);
    expect(escAfter).to.equal(escBefore);
    expect(vestBalBefore - vestBalAfter).to.equal(excess);
  });

  it("setAllocation: rejects bad inputs (zero addr/amount/duration)", async () => {
    await expect(
      vesting.setAllocation(ethers.ZeroAddress, 1n, 1, owner.address)
    ).to.be.reverted;

    await expect(
      vesting.setAllocation(owner.address, 0n, 1, owner.address)
    ).to.be.reverted;

    await expect(
      vesting.setAllocation(owner.address, 1n, 0, owner.address)
    ).to.be.reverted;
  });
});
