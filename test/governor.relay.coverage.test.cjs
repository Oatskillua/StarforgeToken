const { expect } = require("chai");
const { ethers } = require("hardhat");

async function mineBlocks(n) {
  const x = BigInt(n);
  if (x > 0n) {
    await ethers.provider.send("hardhat_mine", ["0x" + x.toString(16)]);
  }
}

describe("StarforgeGovernor — relay path & onlyGovernance", function () {
  it("executes relay(target,data) via governance and rejects direct EOA calls", async function () {
    const [owner, voter1, voter2] = await ethers.getSigners();

    // -------- Deploy IVotes token & set voting power --------
    const Votes = await ethers.getContractFactory("MockVotes");
    const votes = await Votes.deploy();
    await votes.waitForDeployment();

    const million = ethers.parseUnits("1000000", 18);
    await (await votes.mint(voter1.address, million)).wait();
    await (await votes.mint(voter2.address, million)).wait();
    await (await votes.connect(voter1).delegate(voter1.address)).wait();
    await (await votes.connect(voter2).delegate(voter2.address)).wait();

    // Ensure a checkpoint before proposal snapshot
    await mineBlocks(1n);

    // -------- Timelock + Governor --------
    const Timelock = await ethers.getContractFactory("TimelockController");
    const minDelay = 1n;
    const timelock = await Timelock.deploy(minDelay, [], [], owner.address);
    await timelock.waitForDeployment();

    const Governor = await ethers.getContractFactory("StarforgeGovernor");
    const governor = await Governor.deploy(await votes.getAddress(), await timelock.getAddress());
    await governor.waitForDeployment();

    // Grant roles: governor can propose; anyone can execute
    const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
    const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
    await (await timelock.grantRole(PROPOSER_ROLE, await governor.getAddress())).wait();
    await (await timelock.grantRole(EXECUTOR_ROLE, ethers.ZeroAddress)).wait();

    // -------- Relay target to be called by governor.relay(...) --------
    const RelayTarget = await ethers.getContractFactory("MockRelayTarget");
    const target = await RelayTarget.deploy();
    await target.waitForDeployment();

    const payload = ethers.hexlify(ethers.toUtf8Bytes("hi"));
    const targetCall = target.interface.encodeFunctionData("ping", [payload]);

    // Direct EOA call to relay() must revert (onlyGovernance)
    await expect(
      governor.relay(await target.getAddress(), 0, targetCall)
    ).to.be.reverted;

    // -------- Propose governor.relay(...) --------
    const targets = [await governor.getAddress()];
    const values = [0];
    const calldatas = [
      governor.interface.encodeFunctionData("relay", [
        await target.getAddress(),
        0,
        targetCall,
      ]),
    ];
    const description = "Relay ping(bytes) to target";
    const descriptionHash = ethers.id(description);

    const proposalId = await governor.getProposalId(targets, values, calldatas, descriptionHash);
    await (await governor.connect(voter1).propose(targets, values, calldatas, description)).wait();

    // Enter Active (if votingDelay > 0)
    await mineBlocks(2n);

    // Both voters vote FOR (1)
    await (await governor.connect(voter1).castVote(proposalId, 1)).wait();
    await (await governor.connect(voter2).castVote(proposalId, 1)).wait();

    // Mine past deadline to reach Succeeded
    const deadline = BigInt(await governor.proposalDeadline(proposalId));
    const current = BigInt(await ethers.provider.getBlockNumber());
    const toMine = deadline - current + 1n;
    if (toMine > 0n) await mineBlocks(toMine);

    expect(await governor.state(proposalId)).to.equal(4); // Succeeded

    // Queue
    await (await governor.queue(targets, values, calldatas, descriptionHash)).wait();

    // Execute (respecting minDelay)
    await ethers.provider.send("evm_increaseTime", [Number(minDelay) + 1]);
    await ethers.provider.send("evm_mine", []);
    await (await governor.execute(targets, values, calldatas, descriptionHash)).wait();

    // Relay target effects
    expect(await target.counter()).to.equal(1n);
    expect(await target.lastData()).to.equal(payload);
  });
});
