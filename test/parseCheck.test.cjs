const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ParseUnits Check", function () {
  it("should parse correctly", async function () {
    const value = ethers.parseUnits("1.23", 18); // returns a BigInt in v6
    expect(value).to.equal(1230000000000000000n);
    expect(typeof value).to.equal("bigint");
  });
});
