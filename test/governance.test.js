// test/governance.test.js
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("Governance & Timelock Integration", function () {
  let Token, token;
  let Timelock, timelock;
  let Governor, governor;
  let Staking, staking;
  let deployer, proposer, voter1, voter2;
  let minDelay;
  const initialSupply = ethers.utils.parseUnits("1000000", 18);
  const proposalDescription = "Increase reward rate";

  beforeEach(async function () {
    [deployer, proposer, voter1, voter2] = await ethers.getSigners();

    // Deploy Token and initial mint to proposer
    Token = await ethers.getContractFactory("StarforgeToken");
    token = await Token.deploy();
    await token.deployed();
    await token.mint(proposer.address, initialSupply);

    // Pre-fund voters before delegation
    await token.mint(voter1.address, ethers.utils.parseUnits("100",18));
    await token.mint(voter2.address, ethers.utils.parseUnits("100",18));

    // Delegate voting power after minting
    await token.connect(proposer).delegate(proposer.address);
    await token.connect(voter1).delegate(voter1.address);
    await token.connect(voter2).delegate(voter2.address);

    // Deploy TimelockController
    minDelay = 3600;
    Timelock = await ethers.getContractFactory("TimelockController");
    timelock = await Timelock.deploy(
      minDelay,
      [deployer.address],
      [deployer.address],
      deployer.address
    );
    await timelock.deployed();

    // Deploy Governor
    Governor = await ethers.getContractFactory("StarforgeGovernor");
    governor = await Governor.deploy(token.address, timelock.address);
    await governor.deployed();

    // Deploy Staking so we can call setRewardRate
    const rewardRate = ethers.utils.parseUnits("0.01", 18);
    Staking = await ethers.getContractFactory("StarforgeStaking");
    staking = await Staking.deploy(token.address, rewardRate);
    await staking.deployed();

    // Grant roles to governor in timelock
    await token.grantRole(await token.MINTER_ROLE(), timelock.address);
    // Make timelock the owner of the staking contract so it can execute setRewardRate
    await staking.transferOwnership(timelock.address);
    const proposerRole = await timelock.PROPOSER_ROLE();
    const executorRole = await timelock.EXECUTOR_ROLE();
    await timelock.grantRole(proposerRole, governor.address);
    await timelock.grantRole(executorRole, governor.address);
  });

  it("should create, vote, queue, and execute a proposal", async function () {
    // Encode setRewardRate on the staking contract
    const newRate = ethers.utils.parseUnits("0.02",18);
    const encoded = staking.interface.encodeFunctionData("setRewardRate", [newRate]);

    // 1) Propose
    const proposeTx = await governor.connect(proposer).propose(
      [staking.address],
      [0],
      [encoded],
      proposalDescription
    );
    const receipt = await proposeTx.wait();
    const event = receipt.events.find(x => x.event === 'ProposalCreated');
    const proposalId = event.args.proposalId;

    // 2) Fast-forward voting delay
    const delay = (await governor.votingDelay()).toNumber();
    await network.provider.send("evm_increaseTime", [delay]);
    await network.provider.send("evm_mine");

    // 3) Cast votes (proposer and voters)
    await governor.connect(proposer).castVote(proposalId, 1);
    await governor.connect(voter1).castVote(proposalId, 1);
    await governor.connect(voter2).castVote(proposalId, 1);

    // 4) Fast-forward voting period (mine blocks)
    const period = (await governor.votingPeriod()).toNumber();
    // Hardhat: advance blocks, not time
    await network.provider.send("hardhat_mine", [ethers.utils.hexlify(period + 1)]);

    // 5) Queue the proposal
    const descriptionHash = ethers.utils.id(proposalDescription);
    await governor.connect(proposer).queue(
      [staking.address],
      [0],
      [encoded],
      descriptionHash
    );

    // 6) Fast-forward timelock delay
    await network.provider.send("evm_increaseTime", [minDelay]);
    await network.provider.send("evm_mine");

    // 7) Execute the proposal
    await governor.connect(proposer).execute(
      [staking.address],
      [0],
      [encoded],
      descriptionHash
    );

    // 8) Validate on-chain: staking.rewardRate updated
    expect(await staking.rewardRate()).to.equal(newRate);
  });
});
