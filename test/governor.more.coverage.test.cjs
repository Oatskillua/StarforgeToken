// test/governor.more.coverage.test.cjs
const { expect } = require("chai");
const { loadFixture, mine, time } = require("@nomicfoundation/hardhat-network-helpers");
const hre = require("hardhat");
const { ethers } = hre;

const { deployGovernorFixture } = require("./test.fixtures.deployGovernor.cjs");

// ---------- Helpers ----------
const asNum = (x) => Number(x);

async function advanceToActive(governor, proposalId) {
  const snap = asNum(await governor.proposalSnapshot(proposalId));
  const now = asNum(await time.latestBlock());
  if (now <= snap) await mine(snap - now + 1); // strict >
  expect(asNum(await governor.state(proposalId))).to.equal(1); // Active
}

async function advancePastDeadline(governor, proposalId) {
  const deadline = asNum(await governor.proposalDeadline(proposalId));
  const now = asNum(await time.latestBlock());
  if (now <= deadline) await mine(deadline - now + 1); // strict >
}

function hashDesc(description) {
  return ethers.id(description); // keccak256(utf8Bytes(description)) in ethers v6
}

// ---------- Tests ----------
describe("StarforgeGovernor — extra coverage (cancel + updateTimelock)", function () {
  it("proposer can cancel a pending proposal (state -> Canceled)", async function () {
    const { governor } = await loadFixture(deployGovernorFixture);

    // Build a harmless proposal (won't be executed; just to test cancel)
    const targets = [await governor.getAddress()];
    const values = [0];
    const calldatas = [governor.interface.encodeFunctionData("setVotingDelay", [1])];
    const description = "CANCEL_ME";
    const descHash = hashDesc(description);

    // Propose
    await governor.propose(targets, values, calldatas, description);
    const proposalId = await governor.hashProposal(targets, values, calldatas, descHash);

    // Pending -> Cancel by proposer
    expect(asNum(await governor.state(proposalId))).to.equal(0); // Pending
    await governor.cancel(targets, values, calldatas, descHash);
    expect(asNum(await governor.state(proposalId))).to.equal(2); // Canceled
  });

  it("updates timelock via governance (covers TimelockChange path & eta/viewers)", async function () {
    const { governor, timelock, token } = await loadFixture(deployGovernorFixture);
    const [owner] = await ethers.getSigners();

    // Give Governor the required timelock roles to queue/execute its proposals
    const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
    const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
    await timelock.grantRole(PROPOSER_ROLE, await governor.getAddress());
    await timelock.grantRole(EXECUTOR_ROLE, await governor.getAddress());

    // Deploy a *new* Timelock to switch into
    const Timelock = await ethers.getContractFactory("TimelockController");
    // Use "open roles" (empty arrays) so the new timelock isn't restrictive post-switch
    const newTl = await Timelock.deploy(1, [], [], owner.address);
    await newTl.waitForDeployment();

    // Sanity: ensure we have past-vote power (use a *past* block to avoid ERC5805FutureLookup)
    let lb = await time.latestBlock();
    if (lb === 0) { await mine(1); lb = await time.latestBlock(); }
    const votingPower = await token.getPastVotes(owner.address, lb - 1);
    expect(votingPower).to.be.gt(0);

    // Propose governor.updateTimelock(newTimelock)
    const targets = [await governor.getAddress()];
    const values = [0];
    const calldatas = [governor.interface.encodeFunctionData("updateTimelock", [await newTl.getAddress()])];
    const description = "UPDATE_TIMELOCK";
    const descHash = hashDesc(description);

    await governor.propose(targets, values, calldatas, description);
    const proposalId = await governor.hashProposal(targets, values, calldatas, descHash);

    // Move to Active and vote "For"
    await advanceToActive(governor, proposalId);
    await governor.castVote(proposalId, 1); // For

    // Move past deadline, ensure it Succeeds
    await advancePastDeadline(governor, proposalId);
    expect(asNum(await governor.state(proposalId))).to.equal(4); // Succeeded

    // Queue -> check eta -> then execute
    await governor.queue(targets, values, calldatas, descHash);
    const eta = await governor.proposalEta(proposalId);
    expect(eta).to.be.gt(0);

    // Respect min delay (1s) and execute
    await time.increase(2);
    await mine(1);
    await governor.execute(targets, values, calldatas, descHash);

    // Verify timelock swapped
    expect(await governor.timelock()).to.equal(await newTl.getAddress());
  });
});
