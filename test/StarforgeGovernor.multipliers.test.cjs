const { expect } = require("chai");
const { ethers } = require("hardhat");

// -------- robust fixture import (with local fallback) --------
let deployGovernorFixture;
try {
  const mod = require("./test.fixtures.deployGovernor.cjs");
  deployGovernorFixture =
    (typeof mod === "function" && mod) ||
    (typeof mod?.deployGovernorFixture === "function" && mod.deployGovernorFixture) ||
    (typeof mod?.default === "function" && mod.default) ||
    (typeof mod?.default?.deployGovernorFixture === "function" && mod.default.deployGovernorFixture);
} catch (_) {
  // ignore; we'll use local fallback below if needed
}

// Local fallback fixture: minimal deploy to run these tests
async function localDeployGovernorFixture({ grantTierRoleTo } = {}) {
  const [owner] = await ethers.getSigners();

  const OGNFT = await ethers.getContractFactory("OGNFT");
  const og = await OGNFT.deploy();
  await og.waitForDeployment();

  const StarForge = await ethers.getContractFactory("StarForge");
  // Use owner for founder/treasury/council in fallback; ensures owner has balance
  const token = await StarForge.deploy(
    owner.address,
    owner.address,
    owner.address,
    await og.getAddress()
  );
  await token.waitForDeployment();

  // basic delegation to enable past-vote lookups later if needed
  await (await token.connect(owner).delegate(owner.address)).wait();

  const Timelock = await ethers.getContractFactory("TimelockController");
  const timelock = await Timelock.deploy(1n, [owner.address], [owner.address], owner.address);
  await timelock.waitForDeployment();

  const Governor = await ethers.getContractFactory("StarforgeGovernor");
  const governor = await Governor.deploy(await token.getAddress(), await timelock.getAddress());
  await governor.waitForDeployment();

  // Best-effort grant of tier-setter/admin role so tests can call setVoteTier
  try {
    const role = await governor.VOTE_TIER_SETTER_ROLE?.();
    if (role && grantTierRoleTo) {
      await (await governor.connect(owner).grantRole(role, grantTierRoleTo)).wait();
    }
  } catch (_) {
    try {
      const admin = await governor.DEFAULT_ADMIN_ROLE?.();
      if (admin && grantTierRoleTo) {
        await (await governor.connect(owner).grantRole(admin, grantTierRoleTo)).wait();
      }
    } catch (_) {
      // no AccessControl or already granted — ignore
    }
  }

  return { token, governor };
}

async function ensureGovernorFixture(opts) {
  if (typeof deployGovernorFixture === "function") {
    return await deployGovernorFixture(opts);
  }
  console.log("[TEST] Using local fallback Governor fixture (import not a function).");
  return await localDeployGovernorFixture(opts);
}

// -------- block/time helpers --------
async function mine() {
  await ethers.provider.send("evm_mine", []);
}
async function pastBlockNumber(offset = 1) {
  const b = await ethers.provider.getBlock("latest");
  return BigInt(b.number - offset);
}

// =============================================================
//                        TESTS
// =============================================================
describe("StarforgeGovernor — rank multipliers", function () {
  let owner, alice, token, governor;

  beforeEach(async () => {
    [owner, alice] = await ethers.getSigners();

    const dep = await ensureGovernorFixture({ grantTierRoleTo: owner.address });
    ({ token, governor } = dep);

    // give alice balance & voting power
    await (await token.transfer(alice.address, ethers.parseEther("1000"))).wait();
    await (await token.connect(alice).delegate(alice.address)).wait();

    // ensure checkpoints sit strictly before any getPastVotes calls
    await mine();
  });

  it("defaults to 1.00x weight when no tiers set", async () => {
    const t = await pastBlockNumber(1);
    const wOwner = await governor.getVotes(owner.address, t);
    const wAlice = await governor.getVotes(alice.address, t);
    const baseOwner = await token.getPastVotes(owner.address, t);
    const baseAlice = await token.getPastVotes(alice.address, t);
    expect(wOwner).to.equal(baseOwner);
    expect(wAlice).to.equal(baseAlice);
  });

  it("applies tier multipliers based on burnRanks()", async () => {
    // ensure authorisation to set tiers (best effort, harmless if already granted)
    try {
      const role = await governor.VOTE_TIER_SETTER_ROLE?.();
      if (role) {
        await (await governor.grantRole(role, owner.address)).wait();
      }
    } catch (_) {
      // ignore if not AccessControl / already granted
    }

    await (await governor["setVoteTier(uint256,uint256)"](1n, 11000n)).wait(); // 1.10x
    await (await governor["setVoteTier(uint256,uint256)"](2n, 12000n)).wait(); // 1.20x

    // Rank 1
    await (await token.connect(alice).burnUser(ethers.parseEther("10"))).wait();
    await (await token.connect(alice).delegate(alice.address)).wait();
    await mine(); // move past the checkpoint block
    const t1 = await pastBlockNumber(1);
    const base1 = await token.getPastVotes(alice.address, t1);
    const w1 = await governor.getVotes(alice.address, t1);
    expect(w1).to.equal((base1 * 11000n) / 10000n);

    // Rank 2
    await (await token.connect(alice).burnUser(ethers.parseEther("5"))).wait();
    await (await token.connect(alice).delegate(alice.address)).wait();
    await mine();
    const t2 = await pastBlockNumber(1);
    const base2 = await token.getPastVotes(alice.address, t2);
    const w2 = await governor.getVotes(alice.address, t2);
    expect(w2).to.equal((base2 * 12000n) / 10000n);
  });

  it("read-back compatibility: voteTier() mirrors voteTierBps()", async () => {
    // ensure role if required
    try {
      const role = await governor.VOTE_TIER_SETTER_ROLE?.();
      if (role) {
        await (await governor.grantRole(role, owner.address)).wait();
      }
    } catch (_) {}

    await (await governor["setVoteTier(uint256,uint256)"](3n, 13000n)).wait();
    expect(await governor.voteTierBps(3n)).to.equal(13000n);
    expect(await governor.voteTier(3n)).to.equal(13000n);
  });
});
