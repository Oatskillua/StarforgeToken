// test/StarforgeStaking.test.js
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("Staking Contract", function () {
  let Token, token;
  let Timelock, timelock;
  let Governor, governor;
  let Staking, staking;
  let deployer, user1, user2;
  const initialSupply = ethers.utils.parseUnits("1000000", 18);
  const rewardRate = ethers.utils.parseUnits("0.01", 18); // from constructor

  beforeEach(async function () {
    [deployer, user1, user2] = await ethers.getSigners();

    // Deploy Token
    Token = await ethers.getContractFactory("StarforgeToken");
    token = await Token.deploy();
    await token.deployed();

    // Deploy TimelockController
    const minDelay = 3600;
    Timelock = await ethers.getContractFactory("TimelockController");
    timelock = await Timelock.deploy(minDelay, [deployer.address], [deployer.address], deployer.address);
    await timelock.deployed();

    // Deploy Governor
    Governor = await ethers.getContractFactory("StarforgeGovernor");
    governor = await Governor.deploy(token.address, timelock.address);
    await governor.deployed();

    // Deploy Staking
    Staking = await ethers.getContractFactory("StarforgeStaking");
    staking = await Staking.deploy(token.address, rewardRate);
    await staking.deployed();

    // Grant minter role to staking contract
    const MINTER_ROLE = await token.MINTER_ROLE();
    await token.grantRole(MINTER_ROLE, staking.address);

    // Distribute tokens to user1
    await token.transfer(user1.address, ethers.utils.parseUnits("1000", 18));
  });

  it("should mint initial supply to deployer", async function () {
    const deployerBalance = await token.balanceOf(deployer.address);
    expect(deployerBalance).to.equal(initialSupply.sub(ethers.utils.parseUnits("1000", 18)));
  });

  it("user1 can stake and accrue rewards over time", async function () {
    const stakeAmount = ethers.utils.parseUnits("100", 18);
    await token.connect(user1).approve(staking.address, stakeAmount);
    await staking.connect(user1).stake(stakeAmount);

    // Advance time by 1 day
    const seconds = 24 * 3600;
    await network.provider.send("evm_increaseTime", [seconds]);
    await network.provider.send("evm_mine");

    // Now read the pending rewards via the earned() view
    const earnedWei = await staking.earned(user1.address);
    // expectedWei = stakeAmount * rewardRate * seconds / 1e18
    const expectedWei = stakeAmount
      .mul(rewardRate)
      .mul(seconds)
      .div(ethers.constants.WeiPerEther);
    // allow ~1% variance due to integer rounding
    const toleranceWei = expectedWei.div(100);
    expect(earnedWei).to.be.closeTo(expectedWei, toleranceWei);
  });

  it("cannot stake zero tokens", async function () {
    await token.connect(user1).approve(staking.address, 0);
    await expect(
      staking.connect(user1).stake(0)
    ).to.be.revertedWith("Zero stake");
  });

  it("user1 can withdraw stake and claim rewards", async function () {
    const stakeAmount = ethers.utils.parseUnits("50", 18);
    await token.connect(user1).approve(staking.address, stakeAmount);
    await staking.connect(user1).stake(stakeAmount);

    // Advance time slightly
    await network.provider.send("evm_increaseTime", [10]);
    await network.provider.send("evm_mine");

    // Withdraw full stake
    await staking.connect(user1).withdraw(stakeAmount);
    const postStake = await staking.stakes(user1.address);
    expect(postStake[0]).to.equal(0);

    // Claim rewards
    await staking.connect(user1).claimRewards();
    const finalBal = await token.balanceOf(user1.address);
    expect(finalBal).to.be.gt(stakeAmount);
  });
});
