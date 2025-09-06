// test/v6-shim.cjs
// Makes v5-style tests run unchanged on ethers v6.
//
// You do NOT need to edit your tests. Keep using:
//   ethers.utils.*, ethers.constants.*, BigNumber.from, .deployed(), .address, etc.
// This shim maps them onto v6 equivalents at runtime.

const { ethers } = require("hardhat");

// ----- utils -> top-level mappings -----
if (!ethers.utils) ethers.utils = {};
ethers.utils.parseEther = ethers.parseEther;
ethers.utils.formatEther = ethers.formatEther;
ethers.utils.parseUnits = ethers.parseUnits;
ethers.utils.formatUnits = ethers.formatUnits;
ethers.utils.keccak256 = ethers.keccak256;
ethers.utils.toUtf8Bytes = ethers.toUtf8Bytes;
ethers.utils.solidityKeccak256 = (...args) => ethers.solidityPackedKeccak256(...args);
ethers.utils.getAddress = ethers.getAddress;
ethers.utils.Interface = ethers.Interface;
ethers.utils.defaultAbiCoder = ethers.AbiCoder.defaultAbiCoder();

// ----- constants mapping -----
ethers.constants = {
  AddressZero: ethers.ZeroAddress,
  HashZero: ethers.ZeroHash,
  MaxUint256: ethers.MaxUint256,
};

// ----- BigNumber shim (minimal, enough for typical tests) -----
function BNlike(x) {
  const v = typeof x === "bigint" ? x : BigInt(x);
  const wrap = (y) => BNlike(y);
  return {
    _isBigNumber: true,
    add: (y) => wrap(v + BNlike(y).valueOf()),
    sub: (y) => wrap(v - BNlike(y).valueOf()),
    mul: (y) => wrap(v * BNlike(y).valueOf()),
    div: (y) => wrap(v / BNlike(y).valueOf()),
    mod: (y) => wrap(v % BNlike(y).valueOf()),
    pow: (y) => wrap(v ** BNlike(y).valueOf()),
    lt: (y) => v < BNlike(y).valueOf(),
    lte: (y) => v <= BNlike(y).valueOf(),
    gt: (y) => v > BNlike(y).valueOf(),
    gte: (y) => v >= BNlike(y).valueOf(),
    eq: (y) => v === BNlike(y).valueOf(),
    toString: (radix = 10) => v.toString(radix),
    toHexString: () => "0x" + v.toString(16),
    valueOf: () => v,
  };
}
ethers.BigNumber = { from: BNlike };

// ----- contract conveniences (deployed() & .address) -----
const { Contract } = require("ethers");

// Make .deployed() a harmless alias in v6
if (!Contract.prototype.deployed) {
  Contract.prototype.deployed = async function () {
    return this.waitForDeployment ? this.waitForDeployment() : this;
  };
}

// Provide a read-only .address like v5 (prefer .target in v6)
if (!Object.getOwnPropertyDescriptor(Contract.prototype, "address")) {
  Object.defineProperty(Contract.prototype, "address", {
    get: function () {
      // Prefer synchronous .target to avoid returning a Promise
      if (this.target) return this.target;
      return undefined;
    },
    configurable: true,
  });
}

module.exports = {};
