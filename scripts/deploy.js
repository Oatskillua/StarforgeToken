// scripts/deploy.js
require("dotenv").config();
const hre = require("hardhat");

async function main() {
  // 1) Log the deployer account to ensure Hardhat is using your MetaMask key
  const [deployer] = await hre.ethers.getSigners();
  console.log("⛏️  Deploying from account:", deployer.address);
  console.log("   Account balance:", (await deployer.getBalance()).toString(), "wei");

  // 2) Deploy the token contract
  const Token = await hre.ethers.getContractFactory("StarforgeToken");
  const token = await Token.deploy();
  await token.deployed();
  console.log("StarforgeToken deployed to:", token.address);

  // 3) Deploy TimelockController (requires 4 args: minDelay, proposers, executors, admin)
  const minDelay = 3600; // 1 hour delay
  const proposers = [deployer.address];
  const executors = [deployer.address];
  const admin = deployer.address; // grant admin role to deployer
  const Timelock = await hre.ethers.getContractFactory("TimelockController");
  const timelock = await Timelock.deploy(minDelay, proposers, executors, admin);
  await timelock.deployed();
  console.log("TimelockController deployed to:", timelock.address);

  // 4) Deploy the governance contract
  const Governor = await hre.ethers.getContractFactory("StarforgeGovernor");
  const governor = await Governor.deploy(token.address, timelock.address);
  await governor.deployed();
  console.log("StarforgeGovernor deployed to:", governor.address);

  // 5) Deploy the staking contract
  const rewardRate = hre.ethers.utils.parseUnits("0.01", 18);
  const Staking = await hre.ethers.getContractFactory("StarforgeStaking");
  const staking = await Staking.deploy(token.address, rewardRate);
  await staking.deployed();
  console.log("StarforgeStaking deployed to:", staking.address);

  // 6) Grant MINTER_ROLE to staking contract
  const MINTER_ROLE = await token.MINTER_ROLE();
  const grantTx = await token.grantRole(MINTER_ROLE, staking.address);
  await grantTx.wait();
  console.log("MINTER_ROLE granted to staking contract.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
