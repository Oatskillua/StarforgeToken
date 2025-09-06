// test/StarforgeStaking.test.cjs
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

describe("StarforgeStaking", function () {
  let token, staking, ogNFT, deployer, user1, treasury, council, snapshotId;

  const toWei = (v) => ethers.parseUnits(v, 18);

  beforeEach(async function () {
    [deployer, user1, treasury, council] = await ethers.getSigners();

    const OGNFT = await ethers.getContractFactory("OGNFT");
    ogNFT = await OGNFT.deploy();
    await ogNFT.waitForDeployment();

    const StarForge = await ethers.getContractFactory("StarForge");
    token = await StarForge.deploy(
      await deployer.getAddress(),
      await treasury.getAddress(),
      await council.getAddress(),
      await ogNFT.getAddress()
    );
    await token.waitForDeployment();

    const StarforgeStaking = await ethers.getContractFactory("StarforgeStaking");
    staking = await StarforgeStaking.deploy(
      await token.getAddress(),
      await ogNFT.getAddress()
    );
    await staking.waitForDeployment();

    // Grant MINTER_ROLE to StarForge so burning can mint the OGNFT
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    await ogNFT.grantRole(MINTER_ROLE, await token.getAddress());

    // Fund user1 with 2,000,000 SFG and approve staking
    const twoMillion = toWei("2000000");
    await token.connect(deployer).transfer(await user1.getAddress(), twoMillion);
    await token.connect(user1).approve(await staking.getAddress(), twoMillion);

    // Snapshot after setup
    snapshotId = await ethers.provider.send("evm_snapshot");
  });

  afterEach(async function () {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  it("stakes and calculates rewards with OGNFT boost", async function () {
    // Stake 1,100,000 SFG for a year (no NFT boost)
    await staking.connect(user1).stake(toWei("1100000"));
    await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    // 1.1M * 3.5% = 38,500 SFG
    const r1 = await staking.getRewards(await user1.getAddress());
    expect(r1).to.be.closeTo(toWei("38500"), 1000n);

    // Reset state
    await ethers.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot");

    // Burn 100,000 SFG to earn OGNFT, then stake 1,200,000 SFG for a year (with boost)
    await token.connect(user1).burnUser(toWei("100000")); // should mint the soulbound OGNFT
    await staking.connect(user1).stake(toWei("1200000"));
    await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    // Expected example with boost: 1.2M * 5.5% = 66,000 SFG
    const r2 = await staking.getRewards(await user1.getAddress());
    expect(r2).to.be.closeTo(toWei("66000"), 1000n);
  });

  it("unstakes with fee", async function () {
    // Stake 1,000,000 SFG for a year
    await staking.connect(user1).stake(toWei("1000000"));
    await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    // Grant BURNER_ROLE to staking so it can burn fee (if your implementation needs it)
    const BURNER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));
    await token.grantRole(BURNER_ROLE, await staking.getAddress());

    // Unstake 1,000,000 SFG (expect 1% fee = 10,000 burned, so net +990,000)
    await staking.connect(user1).unstake(toWei("1000000"));

    // user1 started with 2,000,000 SFG, staked 1,000,000, then got 990,000 back => 1,990,000
    const bal = await token.balanceOf(await user1.getAddress());
    expect(bal).to.be.closeTo(toWei("1990000"), 1000n);
  });
});
