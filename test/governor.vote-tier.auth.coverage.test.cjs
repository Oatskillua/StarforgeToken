/* eslint-disable no-unused-expressions */
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StarforgeGovernor — vote-tier auth", function () {
  it("reverts when non-author tries to set a tier", async function () {
    const [owner, attacker] = await ethers.getSigners();

    // Minimal IVotes token (no args)
    const MockVotes = await ethers.getContractFactory("MockVotes");
    const votes = await MockVotes.deploy();
    await votes.waitForDeployment();

    // Timelock: (minDelay, proposers, executors, admin)
    const Timelock = await ethers.getContractFactory("TimelockController");
    const timelock = await Timelock.deploy(
      0,
      [owner.address],
      [owner.address],
      owner.address
    );
    await timelock.waitForDeployment();

    // Governor under test: (IVotes token, TimelockController timelock)
    const Governor = await ethers.getContractFactory("StarforgeGovernor");
    const governor = await Governor.deploy(
      await votes.getAddress(),
      await timelock.getAddress()
    );
    await governor.waitForDeployment();

    // Non-author (no role) attempts explicit 2-arg overload; must revert
    await expect(
      governor.connect(attacker)["setVoteTier(uint256,uint256)"](1, 11000)
    ).to.be.reverted;
  });
});
