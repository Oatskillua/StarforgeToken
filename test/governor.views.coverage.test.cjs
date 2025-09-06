/* eslint-disable node/no-unpublished-require */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployGovernorFixture } = require("./test.fixtures.deployGovernor.cjs");

// Named fixture for reuse in loadFixture
async function deployGovFixtureViews() {
  return deployGovernorFixture({ timelockDelay: 0n });
}

async function mineToActive(governor, proposalId, max = 25) {
  for (let i = 0; i < max; i++) {
    const st = await governor.state(proposalId); // 0=Pending, 1=Active
    if (st === 1) return;
    await ethers.provider.send("evm_mine", []);
  }
}

describe("StarforgeGovernor — view & receiver coverage bump", function () {
  it("smokes EIP712, counting/clock/name/version & quorum/nonce", async function () {
    const { governor, token, timelock } = await loadFixture(deployGovFixtureViews);
    const [owner] = await ethers.getSigners();

    const name = await governor.name();
    const version = await governor.version();
    expect(name).to.be.a("string").and.to.have.length.greaterThan(0);
    expect(version).to.be.a("string").and.to.have.length.greaterThan(0);

    const domain = await governor.eip712Domain();
    expect(domain.name).to.equal(name);
    expect(domain.version).to.equal(version);
    expect(domain.verifyingContract).to.equal(governor.target);

    // Touch constants / strings
    await governor.BALLOT_TYPEHASH();
    await governor.EXTENDED_BALLOT_TYPEHASH();
    await governor.COUNTING_MODE();
    await governor.CLOCK_MODE();

    // Move one block forward and query a *past* timepoint to avoid ERC5805FutureLookup
    await ethers.provider.send("evm_mine", []);
    const latest = await ethers.provider.getBlock("latest");
    const pastTimepoint = BigInt(latest.number - 1);

    // Voting/quorum views
    await governor.getVotes(owner.address, pastTimepoint);
    await governor.getVotesWithParams(owner.address, pastTimepoint, "0x");
    await governor.nonces(owner.address);

    const qDen = await governor.quorumDenominator();
    const qNum = await governor.quorumNumerator();
    expect(qDen).to.be.gt(0);
    expect(qNum).to.be.gte(0);
    await governor.quorum(latest.number - 1);

    // Address sanity
    expect(await governor.timelock()).to.equal(timelock.target);
    expect(await governor.token()).to.equal(token.target);
    if (typeof governor.sfgToken === "function") {
      expect(await governor.sfgToken()).to.equal(token.target);
    }
  });

  it("supportsInterface negative id & ERC721/1155 receiver hooks", async function () {
    const { governor } = await loadFixture(deployGovFixtureViews);
    const [owner] = await ethers.getSigners();

    expect(await governor.supportsInterface("0xffffffff")).to.equal(false);

    // Receiver hooks revert by design; assert the custom error to cover paths safely
    await expect(
      governor.onERC721Received(owner.address, owner.address, 1n, "0x")
    ).to.be.revertedWithCustomError(governor, "GovernorDisabledDeposit");

    await expect(
      governor.onERC1155Received(owner.address, owner.address, 1n, 1n, "0x")
    ).to.be.revertedWithCustomError(governor, "GovernorDisabledDeposit");

    await expect(
      governor.onERC1155BatchReceived(
        owner.address,
        owner.address,
        [1n, 2n],
        [1n, 1n],
        "0x"
      )
    ).to.be.revertedWithCustomError(governor, "GovernorDisabledDeposit");
  });

  it("hasVoted false→true path (no queuing/execution)", async function () {
    const { governor, token } = await loadFixture(deployGovFixtureViews);
    const [owner] = await ethers.getSigners();

    // Minimal no-op proposal
    const targets = [token.target];
    const values = [0];
    const calldatas = [
      token.interface.encodeFunctionData("transfer", [owner.address, 0n]),
    ];
    const description = "views-coverage-proposal";
    const proposalId = await governor.getProposalId(
      targets,
      values,
      calldatas,
      ethers.id(description)
    );

    await (await governor.propose(targets, values, calldatas, description)).wait();
    await mineToActive(governor, proposalId);

    expect(await governor.hasVoted(proposalId, owner.address)).to.equal(false);
    await (await governor.castVote(proposalId, 1)).wait(); // For
    expect(await governor.hasVoted(proposalId, owner.address)).to.equal(true);
  });
});
