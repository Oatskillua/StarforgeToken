const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OGNFT", function () {
  let ogNFT, deployer, user1, minter;
  let deployerAddress, user1Address, minterAddress;

  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

  beforeEach(async function () {
    [deployer, user1, minter] = await ethers.getSigners();
    deployerAddress = await deployer.getAddress();
    user1Address = await user1.getAddress();
    minterAddress = await minter.getAddress();

    const OGNFT = await ethers.getContractFactory("OGNFT");
    ogNFT = await OGNFT.deploy();
    await ogNFT.waitForDeployment();

    await ogNFT.grantRole(MINTER_ROLE, minterAddress);
  });

  it("mints NFTs with correct rank URIs", async function () {
    await ogNFT.connect(minter).mint(user1Address, 1);
    expect(await ogNFT.tokenURI(1)).to.equal("ipfs://spark_carrier");

    await ogNFT.connect(minter).mint(user1Address, 2);
    expect(await ogNFT.tokenURI(2)).to.equal("ipfs://flame_guardian");

    await ogNFT.connect(minter).mint(user1Address, 3);
    expect(await ogNFT.tokenURI(3)).to.equal("ipfs://starforger");

    await ogNFT.connect(minter).mint(user1Address, 4);
    expect(await ogNFT.tokenURI(4)).to.equal("ipfs://cosmic_flame");
  });

  it("restricts minting to MINTER_ROLE", async function () {
    await expect(ogNFT.connect(user1).mint(user1Address, 1))
      .to.be.revertedWithCustomError(ogNFT, "AccessControlUnauthorizedAccount")
      .withArgs(user1Address, MINTER_ROLE);
  });

  it("reverts on invalid rank", async function () {
    await expect(ogNFT.connect(minter).mint(user1Address, 0)).to.be.revertedWith("Invalid rank");
    await expect(ogNFT.connect(minter).mint(user1Address, 5)).to.be.revertedWith("Invalid rank");
  });

  it("increments tokenIdCounter correctly", async function () {
    await ogNFT.connect(minter).mint(user1Address, 1);
    expect(await ogNFT.tokenIdCounter()).to.equal(2n);

    await ogNFT.connect(minter).mint(user1Address, 2);
    expect(await ogNFT.tokenIdCounter()).to.equal(3n);
  });
});
