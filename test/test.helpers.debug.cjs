// test.helpers.debug.cjs
const hre = require("hardhat");
const { ethers } = hre;

/** Print a clear banner at the top of a test run */
function banner(label) {
  const ts = new Date().toISOString();
  console.log(`[TEST BANNER] ${label} — ${ts}`);
}

/** Debug log with consistent prefix */
function dbg(...args) {
  console.log("[dbg]", ...args);
}

/** ethers v6+v5 safe static-call for a method name on a contract */
async function staticCall(contract, method, ...args) {
  const f = contract?.[method];
  if (!f) throw new Error(`Method ${method} not found on contract`);
  // ethers v6
  if (typeof f.staticCall === "function") {
    return await f.staticCall(...args);
  }
  // ethers v5
  if (contract.callStatic && typeof contract.callStatic[method] === "function") {
    return await contract.callStatic[method](...args);
  }
  throw new Error(`No staticCall available for ${method} (ethers v5/v6 mismatch)`);
}

/** Expect a revert containing a substring (v6 & v5 friendly) */
async function expectRevertSubstring(promise, substr) {
  try {
    await promise;
    throw new Error(`Expected revert with "${substr}", but tx did not revert`);
  } catch (err) {
    const msg =
      err?.shortMessage ||
      err?.reason ||
      err?.error?.message ||
      err?.message ||
      String(err);
    if (!msg.includes(substr)) {
      throw new Error(
        `Revert message mismatch.\nExpected substring: ${substr}\nActual: ${msg}`
      );
    }
  }
}

/** Ethers v6/v5 helpers */
const parse = (v) => (ethers.parseEther ? ethers.parseEther(v) : ethers.utils.parseEther(v));
const waitDeployed = async (c) => (c.waitForDeployment ? c.waitForDeployment() : c.deployed());
const addrOf = async (c) => (c.getAddress ? c.getAddress() : c.address);

/** mine time */
async function fastForward(seconds) {
  await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
  await ethers.provider.send("evm_mine", []);
}

module.exports = {
  banner,
  dbg,
  staticCall,
  expectRevertSubstring,
  parse,
  waitDeployed,
  addrOf,
  fastForward,
};
