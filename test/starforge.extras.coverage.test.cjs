/* eslint-disable no-unused-expressions */
// test/starforge.extras.coverage.test.cjs
const hre = require("hardhat");
const { expect } = require("chai");
const { ethers } = hre;

const { deployGovernorFixture } = require("./test.fixtures.deployGovernor.cjs");

describe("StarForge — extras (guards & roles)", function () {
  it("reverts burnUser(0) and burnExcessTreasury(0); restricts burnExcessTreasury to treasury role", async function () {
    const { token } = await deployGovernorFixture();
    const [founder, treasury, , rando] = await ethers.getSigners();

    // founder has tokens; burnUser(0) should revert on amount check
    await expect(token.connect(founder).burnUser(0)).to.be.reverted; // "Amount must be > 0"

    // treasury can call burnExcessTreasury but not with 0
    await expect(token.connect(treasury).burnExcessTreasury(0)).to.be.reverted; // "Amount must be > 0"

    // rando lacks BURNER_ROLE -> revert on access control
    await expect(token.connect(rando).burnExcessTreasury(1)).to.be.reverted;
  });
});
