// test/ognft.safe-mint.receiver.coverage.test.cjs
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

describe("OGNFT — safe-mint to contract (ERC721Receiver) coverage", function () {
  let deployer, treasury, council;
  let ogNFT, token, timelock;

  beforeEach(async () => {
    [deployer, treasury, council] = await ethers.getSigners();

    // OGNFT
    const OGNFT = await ethers.getContractFactory("OGNFT");
    ogNFT = await OGNFT.deploy();
    await ogNFT.waitForDeployment();

    // StarForge (not strictly needed for this test, but cheap + consistent with project deps)
    const StarForge = await ethers.getContractFactory("StarForge");
    token = await StarForge.deploy(
      await deployer.getAddress(),
      await treasury.getAddress(),
      await council.getAddress(),
      await ogNFT.getAddress()
    );
    await token.waitForDeployment();

    // TimelockController (OZ v5+): (minDelay, proposers, executors, admin)
    const Timelock = await ethers.getContractFactory("TimelockController");
    timelock = await Timelock.deploy(
      1, // minDelay
      [], // proposers
      [], // executors
      await deployer.getAddress() // admin
    );
    await timelock.waitForDeployment();
  });

  it("safe-mints to a contract (Timelock) that implements onERC721Received", async () => {
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    await ogNFT.grantRole(MINTER_ROLE, await deployer.getAddress());

    const to = await timelock.getAddress(); // Timelock accepts ERC721s
    await ogNFT.mint(to, 1);

    expect(await ogNFT.ownerOf(1)).to.equal(to);
  });
});
