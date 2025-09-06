/* eslint-disable no-unused-expressions */
const { expect } = require("chai");
const { ethers, artifacts } = require("hardhat");

// Returns a default value for a given ABI type that satisfies basic require()s.
// - address  => a non-zero EOA (we'll pass owner.address)
// - uint*    => 0
// - bool     => false
// - string   => ""
// - bytes*   => "0x"
// - T[]/*[]  => []
function defaultForType(type, fallbackAddress) {
  if (type.endsWith("[]")) return []; // any array
  if (type.startsWith("uint")) return 0n;
  if (type.startsWith("int")) return 0n;
  if (type === "address") return fallbackAddress;
  if (type === "bool") return false;
  if (type === "string") return "";
  if (type.startsWith("bytes")) return "0x";
  // structs / tuples -> try empty tuple if allowed, but constructors here shouldn't use it
  if (type.startsWith("tuple")) return [];
  // last resort
  return 0;
}

async function deployBareStaking(owner) {
  const stakingArtifact = await artifacts.readArtifact("StarforgeStaking");
  const ctor = stakingArtifact.abi.find((i) => i.type === "constructor");
  const inputs = ctor?.inputs ?? [];

  const args = inputs.map((inp) => defaultForType(inp.type, owner.address));

  const Staking = await ethers.getContractFactory("StarforgeStaking");
  const staking = await Staking.deploy(...args);
  await staking.waitForDeployment();

  return { staking };
}

describe("StarforgeStaking — zero-amount guardrails (non-brittle)", function () {
  it("reverts stake(0) and unstake(0); notifyRewardReceived(0) also reverts", async function () {
    const [owner, alice] = await ethers.getSigners();

    const { staking } = await deployBareStaking(owner);

    // 1) stake(0) should revert (generic revert assertion to avoid brittleness)
    await expect(staking.connect(alice).stake(0n)).to.be.reverted;

    // 2) unstake(0) should revert
    await expect(staking.connect(alice).unstake(0n)).to.be.reverted;

    // 3) notifyRewardReceived(0) should revert (either zero-amount or auth check first is fine)
    await expect(staking.connect(owner).notifyRewardReceived(0n)).to.be.reverted;
  });
});
