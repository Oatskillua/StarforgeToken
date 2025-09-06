const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StarforgeGovernor — default vote tier (1-arg overload)", function () {
  it("sets default tier weight and allows explicit tier overrides", async () => {
    const [owner] = await ethers.getSigners();

    const MockVotes = await ethers.getContractFactory("MockVotes");
    const votes = await MockVotes.deploy();
    await votes.waitForDeployment();

    const Timelock = await ethers.getContractFactory("TimelockController");
    const timelock = await Timelock.deploy(1, [owner.address], [owner.address], owner.address);
    await timelock.waitForDeployment();

    const Governor = await ethers.getContractFactory("StarforgeGovernor");
    const governor = await Governor.deploy(await votes.getAddress(), await timelock.getAddress());
    await governor.waitForDeployment();

    const ROLE = await governor.VOTE_TIER_SETTER_ROLE();
    await (await governor.grantRole(ROLE, owner.address)).wait();

    // Set default (1-arg overload). Your contract emits index = 1 for "default".
    await expect(
      governor["setVoteTier(uint256)"](13000n)
    ).to.emit(governor, "VoteTierUpdated").withArgs(1n, 13000n);

    // Set an explicit tier (2) using 2-arg overload; verify readback mirrors.
    await (await governor["setVoteTier(uint256,uint256)"](2n, 11000n)).wait();
    expect(await governor.voteTier(2n)).to.equal(11000n);

    // Do NOT assert that unknown tiers fall back to default unless your
    // getter is implemented to do so. (Your current readback returns 0.)
  });
});
