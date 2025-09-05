const { expect } = require("chai");
const { ethers } = require("hardhat");

const parse = (v) => (ethers.parseEther ? ethers.parseEther(v) : ethers.utils.parseEther(v));
const waitDeployed = async (c) => (c.waitForDeployment ? c.waitForDeployment() : c.deployed());
const addrOf = async (c) => (c.getAddress ? c.getAddress() : c.address);

describe("TreasuryVesting — SRV init, tranches, recovery", function () {
  let owner, funder, staking, sfg, vesting, og;

  beforeEach(async () => {
    [owner, funder] = await ethers.getSigners();

    // OGNFT
    const OGNFT = await ethers.getContractFactory("OGNFT");
    og = await OGNFT.deploy();
    await waitDeployed(og);

    // SFG token (funder holds supply for SRV init)
    const StarForge = await ethers.getContractFactory("StarForge");
    sfg = await StarForge.deploy(
      funder.address,
      owner.address,   // treasury
      owner.address,   // council
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

    await vesting.grantRole(await vesting.VESTING_ADMIN_ROLE(), owner.address);
  });

  it("SRV init within [15%,20%] pulls tokens, sets cap/balance once", async () => {
    const percentBps = 2000; // 20%
    const total = await sfg.totalSupply();
    const cap = (total * BigInt(percentBps)) / 10000n;

    // funder must approve and call with funder==msg.sender
    await sfg.connect(funder).approve(await addrOf(vesting), cap);
    await vesting.connect(owner).grantRole(await vesting.VESTING_ADMIN_ROLE(), funder.address);
    await vesting.connect(funder).initStakingRewardsVault(percentBps, funder.address);

    const [inited, capOut, balOut] = await vesting.stakingVaultInfo();
    expect(inited).to.equal(true);
    expect(capOut).to.equal(cap);
    expect(balOut).to.equal(cap);

    await expect(
      vesting.connect(funder).initStakingRewardsVault(percentBps, funder.address)
    ).to.be.revertedWith("SRV already initialized");
  });

  it("fundStaking() transfers tranche and reduces SRV balance", async () => {
    const percentBps = 1500;
    const cap = (await sfg.totalSupply() * BigInt(percentBps)) / 10000n;

    await sfg.connect(funder).approve(await addrOf(vesting), cap);
    await vesting.connect(owner).grantRole(await vesting.VESTING_ADMIN_ROLE(), funder.address);
    await vesting.connect(funder).initStakingRewardsVault(percentBps, funder.address);

    const tranche = cap / 3n;
    await vesting.fundStaking(await addrOf(staking), tranche);

    const [, , balanceAfter] = await vesting.stakingVaultInfo();
    expect(balanceAfter).to.equal(cap - tranche);
    expect(await sfg.balanceOf(await addrOf(staking))).to.equal(tranche);
  });

  it("recoverExcessSFT excludes SRV and vesting escrow", async () => {
    const percentBps = 1500;
    const cap = (await sfg.totalSupply() * BigInt(percentBps)) / 10000n;

    await sfg.connect(funder).approve(await addrOf(vesting), cap);
    await vesting.connect(owner).grantRole(await vesting.VESTING_ADMIN_ROLE(), funder.address);
    await vesting.connect(funder).initStakingRewardsVault(percentBps, funder.address);

    // Create a vesting schedule: funder tokens → owner, owner approves, owner calls setAllocation with funder=owner
    const scheduleAmt = parse("1000");
    const duration = 60 * 60 * 24 * 30;
    await sfg.connect(funder).transfer(owner.address, scheduleAmt);
    await sfg.connect(owner).approve(await addrOf(vesting), scheduleAmt);
    await vesting.connect(owner).setAllocation(owner.address, scheduleAmt, duration, owner.address);

    // Add extra to create "excess"
    const extra = parse("777");
    await sfg.connect(funder).transfer(await addrOf(vesting), extra);

    const bal = await sfg.balanceOf(await addrOf(vesting));
    const [, , srvBal] = await vesting.stakingVaultInfo();
    const esc = await vesting.totalEscrowed();
    const theoreticalExcess = bal - esc - srvBal;

    await expect(
      vesting.recoverExcessSFT(theoreticalExcess + 1n, owner.address)
    ).to.be.revertedWith("Amount exceeds excess");

    await vesting.recoverExcessSFT(theoreticalExcess, owner.address);
    expect(await sfg.balanceOf(owner.address)).to.be.gte(theoreticalExcess);
  });
});
