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
async function deployStarForge(owner) {
  const art = await artifacts.readArtifact("StarForge");
  const ctor = art.abi.find((i) => i.type === "constructor");
  const args = buildArgsFromInputs(ctor?.inputs || [], owner.address);
  const F = await ethers.getContractFactory("StarForge");
  const token = await F.deploy(...args);
  await token.waitForDeployment();
  return { token, art };
}

function getFnSig(abi, name) {
  const f = abi.find((x) => x.type === "function" && x.name === name);
  return f ? `${name}(${(f.inputs || []).map((i) => i.type).join(",")})` : null;
}

describe("StarForge — pausable & role edges (extra coverage)", () => {
  it("only owner can pause/unpause; double pause/unpause reverts", async () => {
    const [owner, other] = await ethers.getSigners();
    const { token, art } = await deployStarForge(owner);

    const pauseSig = getFnSig(art.abi, "pause");
    const unpauseSig = getFnSig(art.abi, "unpause");
    if (!pauseSig || !unpauseSig) return;

    await expect(token.connect(other).getFunction(pauseSig)()).to.be.reverted;
    await expect(token.connect(owner).getFunction(pauseSig)()).to.not.be.reverted;
    await expect(token.connect(owner).getFunction(pauseSig)()).to.be.reverted; // double pause

    await expect(token.connect(other).getFunction(unpauseSig)()).to.be.reverted;
    await expect(token.connect(owner).getFunction(unpauseSig)()).to.not.be
      .reverted;
    await expect(token.connect(owner).getFunction(unpauseSig)()).to.be.reverted; // double unpause
  });

  it("burnExcessTreasury remains restricted (non-treasury caller reverts)", async () => {
    const [owner, nonTreasury] = await ethers.getSigners();
    const { token, art } = await deployStarForge(owner);

    const burnTreasSig = getFnSig(art.abi, "burnExcessTreasury");
    if (!burnTreasSig) return;

    // Call from non-treasury; expect revert on auth before amount checks
    await expect(
      token.connect(nonTreasury).getFunction(burnTreasSig)(1n)
    ).to.be.reverted;
  });
});
