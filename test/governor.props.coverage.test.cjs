/* eslint-disable no-unused-expressions */
// test/governor.props.coverage.test.cjs
const hre = require("hardhat");
const { expect } = require("chai");
const { ethers, network } = hre;

const { deployGovernorFixture } = require("./test.fixtures.deployGovernor.cjs");

// Advance the Governor clock to a target timepoint (blocknumber or timestamp)
async function advanceClockTo(governor, target) {
  const mode = await governor.CLOCK_MODE(); // "mode=blocknumber" or "mode=timestamp"
  const now = BigInt(await governor.clock());
  const delta = BigInt(target) > now ? BigInt(target) - now : 0n;

  if (delta === 0n) {
    await network.provider.send("evm_mine");
    return;
  }

  if (mode.includes("blocknumber")) {
    // Mine `delta` blocks (in chunks to avoid stressing RPC)
    let remaining = Number(delta);
    const chunk = 2000;
    while (remaining > 0) {
      const n = Math.min(remaining, chunk);
      for (let i = 0; i < n; i++) {
        await network.provider.send("evm_mine");
      }
      remaining -= n;
    }
  } else {
    // Timestamp mode
    await network.provider.send("evm_increaseTime", [Number(delta)]);
    await network.provider.send("evm_mine");
  }
}

describe("StarforgeGovernor — view props & queuing semantics", function () {
  it("exposes proposer / needsQueuing / eta around queue+execute flow", async function () {
    const { governor, timelock, token } = await deployGovernorFixture();
    const [founder, treasury, council] = await ethers.getSigners();

    // Make sure multiple voters have voting power (fixture already delegates founder)
    await token.connect(treasury).delegate(treasury.address);
    await token.connect(council).delegate(council.address);

    // Grant Timelock roles to the Governor so it can queue/execute
    const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
    const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
    await timelock.grantRole(PROPOSER_ROLE, await governor.getAddress());
    await timelock.grantRole(EXECUTOR_ROLE, await governor.getAddress());

    // Prepare a simple self-call: setVotingDelay(+1)
    const currentDelay = await governor.votingDelay();
    const newDelay = BigInt(currentDelay) + 1n;

    const govAddr = await governor.getAddress();
    const targets = [govAddr];
    const values = [0];
    const calldatas = [
      governor.interface.encodeFunctionData("setVotingDelay", [newDelay]),
    ];
    const description = "bump votingDelay by 1";
    const descriptionHash = ethers.id(description);

    // Propose
    await (await governor.propose(targets, values, calldatas, description)).wait();

    // proposalId via viewer
    const proposalId = await governor.getProposalId(
      targets, values, calldatas, descriptionHash
    );

    // Move to Active
    const snapshot = await governor.proposalSnapshot(proposalId);
    await advanceClockTo(governor, BigInt(snapshot) + 1n);

    // Cast FOR votes (comfortably pass quorum)
    await governor.castVote(proposalId, 1); // founder
    await governor.connect(treasury).castVote(proposalId, 1);
    await governor.connect(council).castVote(proposalId, 1);

    // Go past deadline -> Succeeded(4)
    const deadline = await governor.proposalDeadline(proposalId);
    await advanceClockTo(governor, BigInt(deadline) + 1n);
    expect(await governor.state(proposalId)).to.equal(4);

    // Pre-queue viewers
    const proposer = await governor.proposalProposer(proposalId);
    expect(proposer).to.equal(founder.address);

    // Your Governor logs show proposalNeedsQueuing=true even after queue
    // so we assert that behavior explicitly:
    expect(await governor.proposalNeedsQueuing(proposalId)).to.equal(true);

    // Queue the proposal
    await (await governor.queue(targets, values, calldatas, descriptionHash)).wait();

    // eta becomes > 0 once queued
    const eta = await governor.proposalEta(proposalId);
    expect(eta).to.be.gt(0);

    // In this implementation proposalNeedsQueuing() remains true post-queue
    // (matching on-chain debug prints). Assert the actual behavior:
    expect(await governor.proposalNeedsQueuing(proposalId)).to.equal(true);

    // Execute after timelock delay
    const minDelay = await timelock.getMinDelay();
    await network.provider.send("evm_increaseTime", [Number(minDelay) + 1]);
    await network.provider.send("evm_mine");
    await (await governor.execute(targets, values, calldatas, descriptionHash)).wait();

    // Side-effect: votingDelay increased
    expect(await governor.votingDelay()).to.equal(newDelay);

    // Optional: final state is Executed (7)
    expect(await governor.state(proposalId)).to.equal(7);

    // Extra-lights: cheap view smokes
    expect(await governor.timelock()).to.equal(await timelock.getAddress());
    expect(await governor.token()).to.equal(await token.getAddress());
    expect(await governor.name()).to.be.a("string");
    expect(await governor.version()).to.be.a("string");
  });
});
