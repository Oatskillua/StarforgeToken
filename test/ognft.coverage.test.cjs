const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

async function waitDeployed(c) { if (c.waitForDeployment) return c.waitForDeployment(); if (c.deployed) return c.deployed(); }

async function deployOGFixture() {
  const [owner, user1] = await ethers.getSigners();
  const OGNFT = await ethers.getContractFactory("OGNFT");
  const ogNFT = await OGNFT.deploy();
  await waitDeployed(ogNFT);
  return { ogNFT, owner, user1 };
}

async function lastTransferTokenId(ogNFT, receipt) {
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = ogNFT.interface.parseLog(log);
      if (parsed?.name === "Transfer") return parsed.args.tokenId;
    } catch {}
  }
  return 1;
}

describe("OGNFT — coverage boosters (v5/v6-safe)", function () {
  it("enforces MINTER_ROLE on mint; admin can mint; tokenURI non-empty", async function () {
    const { ogNFT, owner, user1 } = await loadFixture(deployOGFixture);

    await expect(ogNFT.connect(user1).mint(user1.address, 1)).to.be.reverted;

    const MINTER_ROLE = await ogNFT.MINTER_ROLE();
    if (!(await ogNFT.hasRole(MINTER_ROLE, owner.address))) {
      await (await ogNFT.connect(owner).grantRole(MINTER_ROLE, owner.address)).wait();
    }

    const tx = await ogNFT.connect(owner).mint(owner.address, 1);
    const rc = await tx.wait();
    const tokenId = await lastTransferTokenId(ogNFT, rc);

    const uri = await ogNFT.tokenURI(tokenId);
    expect(uri).to.be.a("string").and.not.to.equal("");
  });

  it("supportsInterface ids", async function () {
    const { ogNFT } = await loadFixture(deployOGFixture);
    expect(await ogNFT.supportsInterface("0x01ffc9a7")).to.equal(true);  // ERC165
    expect(await ogNFT.supportsInterface("0x80ac58cd")).to.equal(true);  // ERC721
    expect(await ogNFT.supportsInterface("0x5b5e139f")).to.equal(true);  // ERC721Metadata
    expect(await ogNFT.supportsInterface("0xffffffff")).to.equal(false);
  });

  it("transfer is blocked (soulbound)", async function () {
    const { ogNFT, owner, user1 } = await loadFixture(deployOGFixture);

    const MINTER_ROLE = await ogNFT.MINTER_ROLE();
    if (!(await ogNFT.hasRole(MINTER_ROLE, owner.address))) {
      await (await ogNFT.connect(owner).grantRole(MINTER_ROLE, owner.address)).wait();
    }

    const mint = await ogNFT.connect(owner).mint(owner.address, 2);
    const rc = await mint.wait();
    const tokenId = await lastTransferTokenId(ogNFT, rc);

    await expect(
      ogNFT.connect(owner)["safeTransferFrom(address,address,uint256)"](owner.address, user1.address, tokenId)
    ).to.be.revertedWith("Soulbound");
  });

  it("mint invalid rank reverts", async function () {
    const { ogNFT, owner } = await loadFixture(deployOGFixture);

    const MINTER_ROLE = await ogNFT.MINTER_ROLE();
    if (!(await ogNFT.hasRole(MINTER_ROLE, owner.address))) {
      await (await ogNFT.connect(owner).grantRole(MINTER_ROLE, owner.address)).wait();
    }

    await expect(ogNFT.connect(owner).mint(owner.address, 99999)).to.be.reverted;
  });
});
