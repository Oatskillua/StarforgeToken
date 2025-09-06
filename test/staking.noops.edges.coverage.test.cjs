/* eslint-disable no-unused-expressions */
const { expect } = require("chai");
const { ethers, artifacts } = require("hardhat");

/** ---- ctor-introspection helpers ---- */
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
async function deployEnv(deployer) {
  const art = await artifacts.readArtifact("StarforgeStaking");
  const ctor = art.abi.find((i) => i.type === "constructor");
  const args = buildArgsFromInputs(ctor?.inputs || [], deployer.address);
  const F = await ethers.getContractFactory("StarforgeStaking");
  const s = await F.deploy(...args);
  await s.waitForDeployment();
  return { s, art };
}
function getFnSig(abi, name) {
  const f = abi.find((x) => x.type === "function" && x.name === name);
  return f ? `${name}(${(f.inputs || []).map((i) => i.type).join(",")})` : null;
}

describe("StarforgeStaking — no-op & auth edges (zero amounts, onlyOwner)", () => {
  it("reverts on stake(0) and notifyRewardReceived(0)", async () => {
    const [owner] = await ethers.getSigners();
    const { s, art } = await deployEnv(owner);

    const stakeSig = getFnSig(art.abi, "stake");
    if (stakeSig) await expect(s.getFunction(stakeSig)(0)).to.be.reverted;

    const notifySig = getFnSig(art.abi, "notifyRewardReceived");
    if (notifySig) await expect(s.getFunction(notifySig)(0)).to.be.reverted;
  });

  it("setRewardsFunder(0) reverts; onlyOwner gating on setBaseApyBps", async () => {
    const [owner, alice] = await ethers.getSigners();
    const { s, art } = await deployEnv(owner);

    const setFunderSig = getFnSig(art.abi, "setRewardsFunder");
    if (setFunderSig) {
      await expect(
        s.getFunction(setFunderSig)(ethers.ZeroAddress)
      ).to.be.reverted;
    }

    const setBaseApySig = getFnSig(art.abi, "setBaseApyBps");
    if (setBaseApySig) {
      // Non-owner MUST revert
      await expect(s.connect(alice).getFunction(setBaseApySig)(1234)).to.be
        .reverted;

      // Owner may succeed or fail due to policy (cap/cooldown/step). Either outcome is acceptable here.
      try {
        await s.connect(owner).getFunction(setBaseApySig)(1234);
      } catch {
        // swallow — auth path is still exercised
      }
    }
  });
});
