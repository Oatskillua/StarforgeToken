// OGNFT — tokenURI edge coverage (EOA mint ranks 1 & 3)
// This test aims to touch distinct tokenURI branches for the lowest & highest common ranks.

const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

describe("OGNFT — tokenURI edges (coverage)", function () {
  let og, deployer, user1, user2;

  beforeEach(async function () {
    [deployer, user1, user2] = await ethers.getSigners();

    const OGNFT = await ethers.getContractFactory("OGNFT");
    og = await OGNFT.deploy();
    await og.waitForDeployment();

    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    await og.grantRole(MINTER_ROLE, await deployer.getAddress());
  });

  it("mints rank 1 & rank 3; tokenURI returns distinct non-empty strings", async function () {
    // Safe-mint to EOAs to hit the plain (non-receiver) path
    await og.mint(await user1.getAddress(), 1);
    await og.mint(await user2.getAddress(), 3);

    // Assuming sequential ids start at 1 (common pattern in this project)
    const uri1 = await og.tokenURI(1);
    const uri2 = await og.tokenURI(2);

    expect(uri1).to.be.a("string").and.to.have.length.greaterThan(0);
    expect(uri2).to.be.a("string").and.to.have.length.greaterThan(0);
    expect(uri1).to.not.equal(uri2); // distinct rank → distinct URI branch
  });

  it("supports basic interfaces (sanity branch hits)", async function () {
    // ERC721
    expect(await og.supportsInterface("0x80ac58cd")).to.equal(true);
    // AccessControl
    expect(await og.supportsInterface("0x7965db0b")).to.equal(true);
  });
});
