const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

// Try to load the shared fixture in a robust way.
// If not found / not a function, we’ll fall back to a local deploy below.
let deployGovernorFixture;
try {
  const mod = require("./test.fixtures.deployGovernor.cjs");
  deployGovernorFixture =
    (typeof mod === "function" && mod) ||
    (typeof mod?.deployGovernorFixture === "function" && mod.deployGovernorFixture) ||
    (typeof mod?.default === "function" && mod.default) ||
    (typeof mod?.default?.deployGovernorFixture === "function" && mod.default.deployGovernorFixture);
} catch (_) {
  // ignore; we'll use the fallback
}

// ---------- Debug helpers ----------
function logHeader(title) {
  console.log(`\n==================== ${title} ====================`);
}
function listAbiFunctions(iface) {
  const fns = (iface.fragments || []).filter((f) => f.type === "function");
  console.log(`Functions (${fns.length}):`);
  fns.forEach((f) => console.log(`  - ${f.format("full")}`));
}
function listAbiEvents(iface) {
  const evs = (iface.fragments || []).filter((f) => f.type === "event");
  console.log(`Events (${evs.length}):`);
  evs.forEach((f) => console.log(`  - ${f.format()}`));
}
async function callWithDebug(callPromise, label) {
  try {
    const tx = await callPromise;
    const rc = await tx.wait();
    console.log(`[OK] ${label}`);
    console.log(`  tx: ${rc.hash}`);
    console.log(`  gasUsed: ${rc.gasUsed?.toString?.()}`);
    const logs = rc.logs || [];
    console.log(`  logs: ${logs.length}`);
    return rc;
  } catch (err) {
    console.error(`[ERR] ${label}`);
    console.error(`  message: ${err?.message || err}`);
    if (err?.reason) console.error(`  reason: ${err.reason}`);
    if (err?.error && err.error.message) console.error(`  inner: ${err.error.message}`);
    if (err?.data) console.error(`  data: ${JSON.stringify(err.data)}`);
    throw err;
  }
}

// ---------- Local fallback fixture (used only if import isn’t a function) ----------
async function localDeployGovernorFixture(opts = {}) {
  const { founder, treasury, council, admin, timelockDelay = 1n } = opts;

  const OGNFT = await ethers.getContractFactory("OGNFT");
  const og = await OGNFT.deploy();
  await og.waitForDeployment();

  const StarForge = await ethers.getContractFactory("StarForge");
  const token = await StarForge.deploy(
    founder.address,
    treasury.address,
    council.address,
    await og.getAddress()
  );
  await token.waitForDeployment();

  // Delegate to founder for any vote-weight reads
  await callWithDebug(token.connect(founder).delegate(founder.address), "token.delegate(founder)");

  const Timelock = await ethers.getContractFactory("TimelockController");
  const timelock = await Timelock.deploy(
    timelockDelay,
    [admin.address],
    [admin.address],
    admin.address
  );
  await timelock.waitForDeployment();

  const Governor = await ethers.getContractFactory("StarforgeGovernor");
  const governor = await Governor.deploy(
    await token.getAddress(),
    await timelock.getAddress()
  );
  await governor.waitForDeployment();

  return { token, timelock, governor, og };
}

async function ensureGovernorFixture(opts) {
  if (typeof deployGovernorFixture === "function") {
    return await deployGovernorFixture(opts);
  }
  console.log("[TEST] Using local fallback deploy for Governor fixture.");
  return await localDeployGovernorFixture(opts);
}

// ---------- Test suite ----------
describe("StarforgeGovernor", function () {
  let owner, other, treasury, council;
  let token, timelock, governor, og;

  beforeEach(async function () {
    [owner, other, treasury, council] = await ethers.getSigners();

    logHeader("Deploying contracts (fixture)");
    const dep = await ensureGovernorFixture({
      founder: owner,
      treasury,
      council,
      admin: owner,
      timelockDelay: 1n,
      grantTierRoleTo: owner.address, // used by external fixture if it supports it
    });

    ({ token, timelock, governor, og } = dep);

    logHeader("Deployment Info");
    console.log("OGNFT:             ", await og.getAddress());
    console.log("StarForge Token:   ", await token.getAddress());
    console.log("Timelock:          ", await timelock.getAddress());
    console.log("Governor:          ", await governor.getAddress());

    logHeader("Governor ABI");
    listAbiFunctions(governor.interface);
    listAbiEvents(governor.interface);

    // Optional AccessControl grant to ensure owner can set tiers
    logHeader("Role Setup");
    let tierRole = null;
    let defaultAdminRole = null;
    try {
      tierRole = await governor.VOTE_TIER_SETTER_ROLE();
      console.log("VOTE_TIER_SETTER_ROLE:", tierRole);
    } catch (_) {
      console.log("No VOTE_TIER_SETTER_ROLE present.");
    }
    try {
      defaultAdminRole = await governor.DEFAULT_ADMIN_ROLE();
      console.log("DEFAULT_ADMIN_ROLE:   ", defaultAdminRole);
    } catch (_) {
      console.log("No DEFAULT_ADMIN_ROLE present.");
    }

    const roleToGrant = tierRole || defaultAdminRole;
    if (roleToGrant) {
      try {
        await callWithDebug(
          governor.connect(owner).grantRole(roleToGrant, owner.address),
          "governor.grantRole(roleToGrant, owner)"
        );
      } catch (e) {
        console.log("grantRole skipped or not required:", e?.reason || e?.message || e);
      }
    } else {
      console.log("No AccessControl role fields found; proceeding without grantRole.");
    }
  });

  it("sets vote tiers correctly", async function () {
    logHeader("Test: sets vote tiers correctly");

    // Prefer explicit signatures to avoid overload ambiguity
    let hasTwo = false;
    try {
      governor.interface.getFunction("setVoteTier(uint256,uint256)");
      hasTwo = true;
    } catch (_) {}

    if (hasTwo) {
      await callWithDebug(
        governor.connect(owner)["setVoteTier(uint256,uint256)"](1n, 1000n),
        "function setVoteTier(uint256,uint256) -> (tier=1, weight=1000)"
      );
      await callWithDebug(
        governor.connect(owner)["setVoteTier(uint256,uint256)"](2n, 5000n),
        "function setVoteTier(uint256,uint256) -> (tier=2, weight=5000)"
      );
    } else {
      await callWithDebug(
        governor.connect(owner)["setVoteTier(uint256)"](1000n),
        "function setVoteTier(uint256) -> weight=1000 (auto-tier)"
      );
      await callWithDebug(
        governor.connect(owner)["setVoteTier(uint256)"](5000n),
        "function setVoteTier(uint256) -> weight=5000 (auto-tier)"
      );
    }

    logHeader("Read-back checks (voteTier)");
    const w1 = await governor.voteTier(1n);
    const w2 = await governor.voteTier(2n);
    console.log(`voteTier(1) -> ${w1.toString()}`);
    console.log(`voteTier(2) -> ${w2.toString()}`);
    expect(w1).to.equal(1000n);
    expect(w2).to.equal(5000n);
  });

  it("reverts when non-author tries to set a tier", async function () {
    logHeader("Test: non-author cannot set tier");

    let hasTwo = false;
    try {
      governor.interface.getFunction("setVoteTier(uint256,uint256)");
      hasTwo = true;
    } catch (_) {}

    if (hasTwo) {
      await expect(
        governor.connect(other)["setVoteTier(uint256,uint256)"](9n, 9999n)
      ).to.be.reverted;
    } else {
      await expect(
        governor.connect(other)["setVoteTier(uint256)"](9999n)
      ).to.be.reverted;
    }
  });
});
