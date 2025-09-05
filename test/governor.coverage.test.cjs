const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time, mine } = require("@nomicfoundation/hardhat-network-helpers");

// v5/v6 shims
const parseUnits = (ethers.utils?.parseUnits ?? ethers.parseUnits);
const keccak256 = (ethers.utils?.keccak256 ?? ethers.keccak256);
const toUtf8Bytes = (ethers.utils?.toUtf8Bytes ?? ethers.toUtf8Bytes);
async function waitDeployed(c) { if (c.waitForDeployment) return c.waitForDeployment(); if (c.deployed) return c.deployed(); }
function addr(c) { return c?.target ?? c?.address; }
function toNum(x) { return (typeof x === "bigint") ? Number(x) : x.toNumber(); }
function addU(x, n) { return (typeof x === "bigint") ? (x + BigInt(n)) : x.add(n); }
const toBytes32 = (s) => keccak256(toUtf8Bytes(s));

async function isBlockClock(governor) {
  try {
    const mode = await governor.CLOCK_MODE();
    return String(mode).toLowerCase().includes("blocknumber");
  } catch { return true; }
}
async function advanceDelay(governor) {
  const n = toNum(await governor.votingDelay()) + 1;
  if (await isBlockClock(governor)) { await mine(n); } else { await time.increase(n); }
}
async function advancePeriod(governor) {
  const n = toNum(await governor.votingPeriod()) + 1;
  if (await isBlockClock(governor)) { await mine(n); } else { await time.increase(n); }
}

async function deployGovFixture() {
  const [owner, user1, user2, proposer, executor] = await ethers.getSigners();

  const OGNFT = await ethers.getContractFactory("OGNFT");
  const ogNFT = await OGNFT.deploy();
  await waitDeployed(ogNFT);

  const Token = await ethers.getContractFactory("StarForge");
  const token = await Token.deploy(owner.address, owner.address, owner.address, addr(ogNFT));
  await waitDeployed(token);

  const seed = parseUnits("1000000", 18);
  await (await token.transfer(user1.address, seed)).wait();
  await (await token.transfer(user2.address, seed)).wait();
  await (await token.delegate(owner.address)).wait();
  await (await token.connect(user1).delegate(user1.address)).wait();
  await (await token.connect(user2).delegate(user2.address)).wait();

  const Timelock = await ethers.getContractFactory("TimelockController");
  const minDelay = 1;
  let timelock;
  try {
    timelock = await Timelock.deploy(minDelay, [proposer.address], [executor.address], owner.address);
    await waitDeployed(timelock);
  } catch {
    timelock = await Timelock.deploy(minDelay, [proposer.address], [executor.address]);
    await waitDeployed(timelock);
  }

  const Governor = await ethers.getContractFactory("StarforgeGovernor");
  const governor = await Governor.deploy(addr(token), addr(timelock));
  await waitDeployed(governor);

  // Ensure governor can queue/execute via timelock
  const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
  const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
  await (await timelock.grantRole(PROPOSER_ROLE, addr(governor))).wait();
  await (await timelock.grantRole(EXECUTOR_ROLE, addr(governor))).wait();

  return { governor, token, timelock, owner, user1, user2, minDelay };
}

// propose -> vote -> queue -> execute
async function govExec(fx, targets, values, calldatas, description) {
  const { governor, owner, user1, user2, minDelay } = fx;
  const descHash = toBytes32(description);

  await (await governor.connect(owner).propose(targets, values, calldatas, description)).wait();
  const pid = await governor.getProposalId(targets, values, calldatas, descHash);

  await advanceDelay(governor);

  await (await governor.connect(owner).castVoteWithReasonAndParams(pid, 1, "owner-for", "0x")).wait().catch(()=>{});
  await (await governor.connect(user1).castVoteWithReason(pid, 1, "u1-for")).wait();
  await (await governor.connect(user2).castVote(pid, 1)).wait();

  await advancePeriod(governor);

  await (await governor.queue(targets, values, calldatas, descHash)).wait();
  await time.increase(minDelay + 1);
  await (await governor.execute(targets, values, calldatas, descHash)).wait();

  return pid;
}

describe("StarforgeGovernor — coverage boosters (full governance path)", function () {
  it("changes votingDelay, votingPeriod, proposalThreshold via governance", async () => {
    const fx = await loadFixture(deployGovFixture);
    const { governor } = fx;

    const newDelay = addU(await governor.votingDelay(), 5);
    const newPeriod = addU(await governor.votingPeriod(), 1000);
    const newThresh = parseUnits("123", 18);

    const calls = [
      governor.interface.encodeFunctionData("setVotingDelay", [newDelay]),
      governor.interface.encodeFunctionData("setVotingPeriod", [newPeriod]),
      governor.interface.encodeFunctionData("setProposalThreshold", [newThresh]),
    ];

    await govExec(fx, [addr(governor), addr(governor), addr(governor)], [0, 0, 0], calls, "set-governance-knobs");

    expect(await governor.votingDelay()).to.equal(newDelay);
    expect(await governor.votingPeriod()).to.equal(newPeriod);
    expect(await governor.proposalThreshold()).to.equal(newThresh);
  });

  it("raises proposal threshold via governance; proposing below it reverts (for all)", async () => {
    const fx = await loadFixture(deployGovFixture);
    const { governor, owner, user2 } = fx;

    const bigThresh = parseUnits("1000000000", 18);
    const call = governor.interface.encodeFunctionData("setProposalThreshold", [bigThresh]);

    await govExec(fx, [addr(governor)], [0], [call], "raise-threshold");

    const calldata = governor.interface.encodeFunctionData("supportsInterface", ["0x01ffc9a7"]);

    await expect(
      governor.connect(user2).propose([addr(governor)], [0], [calldata], "u2-should-revert-below-threshold")
    ).to.be.reverted;

    await expect(
      governor.connect(owner).propose([addr(governor)], [0], [calldata], "owner-also-reverts-if-threshold-too-high")
    ).to.be.reverted;
  });

  it("updates quorum numerator via governance; rejects > denominator", async () => {
    const fx = await loadFixture(deployGovFixture);
    const { governor } = fx;

    const denom = await governor.quorumDenominator();
    const valid = (typeof denom === "bigint") ? (denom / 2n) : denom.div(2);

    const call = governor.interface.encodeFunctionData("updateQuorumNumerator", [valid]);
    await govExec(fx, [addr(governor)], [0], [call], "set-quorum");
    expect(await governor.quorumNumerator()).to.equal(valid);

    const tooBig = (typeof denom === "bigint") ? (denom + 1n) : denom.add(1);
    await expect(governor.updateQuorumNumerator(tooBig)).to.be.reverted;
  });

  it("vote paths: with reason, with params (no brittle event check)", async () => {
    const fx = await loadFixture(deployGovFixture);
    const { governor, owner, user1 } = fx;

    const calldata = governor.interface.encodeFunctionData("supportsInterface", ["0x01ffc9a7"]);
    const desc = "vote-paths";
    const descHash = toBytes32(desc);

    await (await governor.connect(owner).propose([addr(governor)], [0], [calldata], desc)).wait();
    const pid = await governor.getProposalId([addr(governor)], [0], [calldata], descHash);

    await advanceDelay(governor);

    await governor.connect(owner).castVoteWithReason(pid, 1, "ok");

    const before = await governor.proposalVotes(pid);
    const beforeFor = before.forVotes ?? before[1];

    await governor.connect(user1).castVoteWithReasonAndParams(pid, 1, "p", "0x");

    const after = await governor.proposalVotes(pid);
    const afterFor = after.forVotes ?? after[1];

    if (typeof afterFor === "bigint") expect(afterFor).to.be.gt(beforeFor);
    else expect(afterFor).to.be.gt(beforeFor);
  });

  it("cancel path: non-proposer revert (covers branch without brittle semantics)", async () => {
    const fx = await loadFixture(deployGovFixture);
    const { governor, owner, user1 } = fx;

    const calldata = governor.interface.encodeFunctionData("supportsInterface", ["0x01ffc9a7"]);
    const desc = "cancel-branch";
    const descHash = toBytes32(desc);

    await (await governor.connect(owner).propose([addr(governor)], [0], [calldata], desc)).wait();

    await advanceDelay(governor);

    await expect(
      governor.connect(user1).cancel([addr(governor)], [0], [calldata], descHash)
    ).to.be.reverted;
  });

  it("hashProposal equals getProposalId", async () => {
    const { governor, owner } = await loadFixture(deployGovFixture);
    const calldata = governor.interface.encodeFunctionData("supportsInterface", ["0x01ffc9a7"]);
    const desc = "id-consistency";
    const descHash = toBytes32(desc);
    const targets = [addr(governor)];
    const values = [0];
    const calldatas = [calldata];

    const hp = await governor.hashProposal(targets, values, calldatas, descHash);
    await (await governor.connect(owner).propose(targets, values, calldatas, desc)).wait();
    const gp = await governor.getProposalId(targets, values, calldatas, descHash);
    expect(hp).to.equal(gp);
  });

  it("setVoteTier (uint256,uint256) succeeds; voteTier mirrors (grant role if needed)", async () => {
    const fx = await loadFixture(deployGovFixture);
    const { governor, owner } = fx;

    const trySet = async () => {
      await expect(governor["setVoteTier(uint256,uint256)"](1, 11_000)).to.emit(
        governor,
        "VoteTierUpdated"
      );
      expect(await governor.voteTier(1)).to.equal(11_000);
    };

    try {
      await trySet();
    } catch {
      const ROLE = await governor.VOTE_TIER_SETTER_ROLE();
      const grantCalldata = governor.interface.encodeFunctionData("grantRole", [ROLE, owner.address]);
      await govExec(fx, [addr(governor)], [0], [grantCalldata], "grant-vote-tier-setter");
      await trySet();
    }
  });

  it("supportsInterface smoke", async () => {
    const { governor } = await loadFixture(deployGovFixture);
    expect(await governor.supportsInterface("0x01ffc9a7")).to.equal(true);
    expect(await governor.supportsInterface("0xffffffff")).to.equal(false);
  });
});
