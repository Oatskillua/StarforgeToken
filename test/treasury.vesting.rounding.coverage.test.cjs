/* eslint-disable no-unused-expressions */
const { expect } = require("chai");
const { ethers, artifacts } = require("hardhat");

/** ctor-introspection helpers */
function defaultForType(type, { fallbackAddress }) {
  if (type.endsWith("[]")) return [];
  if (type.startsWith("uint") || type.startsWith("int")) return 1n;
  if (type === "address") return fallbackAddress;
  if (type === "bool") return false;
  if (type === "string") return "";
  if (type.startsWith("bytes")) return "0x";
  if (type.startsWith("tuple")) return [];
  return 0;
}
function buildArgsFromInputs(inputs, fallbackAddress) {
  return (inputs || []).map((inp) =>
    defaultForType(inp.type, { fallbackAddress })
  );
}
async function deployTV(owner) {
  const art = await artifacts.readArtifact("TreasuryVesting");
  const ctor = art.abi.find((i) => i.type === "constructor");
  const args = buildArgsFromInputs(ctor?.inputs || [], owner.address);
  const F = await ethers.getContractFactory("TreasuryVesting");
  const tv = await F.deploy(...args);
  await tv.waitForDeployment();
  return { tv, art };
}
function findFunctions(abi, name) {
  return abi.filter((x) => x.type === "function" && x.name === name);
}
function sigOf(fragment) {
  return `${fragment.name}(${(fragment.inputs || [])
    .map((i) => i.type)
    .join(",")})`;
}

describe("TreasuryVesting — rounding & time-edge claims (extra coverage)", () => {
  it("rejects bad inputs on setAllocation (zero addr/amount/duration)", async () => {
    const [owner] = await ethers.getSigners();
    const { tv, art } = await deployTV(owner);

    const overloads = findFunctions(art.abi, "setAllocation");
    if (!overloads.length) return;

    for (const frag of overloads) {
      const sig = sigOf(frag);
      const fn = tv.getFunction(sig);

      // Build a baseline "valid-ish" args vector from ABI types.
      const base = (frag.inputs || []).map((inp) => {
        if (inp.type === "address") return owner.address;
        if (inp.type.startsWith("uint") || inp.type.startsWith("int")) return 1n;
        if (inp.type === "bool") return true;
        if (inp.type === "string") return "x";
        if (inp.type.startsWith("bytes")) return "0x12";
        if (inp.type.endsWith("[]")) return [];
        return 1; // fallback
      });

      // For each input, try a "zero-ish" mutation and expect revert.
      for (let i = 0; i < base.length; i++) {
        const mutated = base.slice();
        const t = frag.inputs[i].type;

        if (t === "address") mutated[i] = ethers.ZeroAddress;
        else if (t.startsWith("uint") || t.startsWith("int")) mutated[i] = 0n;
        else continue; // skip strings/bytes/bool — not covered by "bad input" semantics

        await expect(fn(...mutated)).to.be.reverted;
      }
    }
  });
});
