const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ParseUnits Check", function () {
  it("should parse correctly", async function () {
    const value = require("ethers").ethers.utils.parseUnits("1.23", 18);
    expect(value).to.be.a("object");
  });
});