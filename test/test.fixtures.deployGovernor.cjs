// test/test.fixtures.deployGovernor.cjs
const hre = require("hardhat");
const { ethers } = hre;

async function addrOf(contract) {
  return typeof contract.getAddress === "function" ? await contract.getAddress() : contract.address;
}

async function waitDeployed(contract) {
  if (typeof contract.waitForDeployment === "function") {
    await contract.waitForDeployment();
  }
  return contract;
}

/**
 * Deploys OGNFT, StarForge token, TimelockController, and StarforgeGovernor.
 *
 * Options:
 *  - founder: Signer (default: accounts[0])
 *  - treasury: Signer (default: accounts[1])
 *  - council: Signer (default: accounts[2])
 *  - admin: Signer (default: accounts[0])
 *  - timelockDelay: number|bigint (default: 1)
 *  - grantTierRoleTo: address (optional)
 *
 * Returns: { og, token, timelock, governor }
 */
async function deployGovernorFixture(opts = {}) {
  const signers = await ethers.getSigners();
  const founder = opts.founder || signers[0];
  const treasury = opts.treasury || signers[1] || signers[0];
  const council = opts.council || signers[2] || signers[0];
  const admin = opts.admin || signers[0];
  const timelockDelay = opts.timelockDelay ?? 1n;
  const grantTierRoleTo = opts.grantTierRoleTo || null;

  // 1) OGNFT
  const OGNFT = await ethers.getContractFactory("OGNFT");
  const og = await waitDeployed(await OGNFT.deploy());

  // 2) StarForge token
  const StarForge = await ethers.getContractFactory("StarForge");
  const token = await waitDeployed(
    await StarForge.deploy(
      founder.address,            // founder
      treasury.address,           // treasury (BURNER_ROLE)
      council.address,            // council (PAUSER_ROLE)
      await addrOf(og)            // OGNFT
    )
  );

  // IMPORTANT: allow StarForge to mint OG NFTs when users burn (burnUser -> OGNFT.mint)
  const MINTER_ROLE = await og.MINTER_ROLE();
  await og.grantRole(MINTER_ROLE, await addrOf(token));

  // Optional but useful: give founder voting power now
  await token.connect(founder).delegate(founder.address);

  // 3) Timelock
  const TimelockController = await ethers.getContractFactory("TimelockController");
  const proposers = [founder.address];
  const executors = [founder.address];
  const timelock = await waitDeployed(
    await TimelockController.deploy(
      BigInt(timelockDelay),
      proposers,
      executors,
      admin.address
    )
  );

  // 4) Governor
  const Governor = await ethers.getContractFactory("StarforgeGovernor");
  const governor = await waitDeployed(
    await Governor.deploy(await addrOf(token), await addrOf(timelock))
  );

  // 5) Grant VOTE_TIER_SETTER_ROLE if requested and role exists
  if (grantTierRoleTo) {
    try {
      const TIER_ROLE = await governor.VOTE_TIER_SETTER_ROLE();
      await governor.grantRole(TIER_ROLE, grantTierRoleTo);
    } catch {
      // Some builds might not include the role; that's fine.
    }
  }

  return { og, token, timelock, governor };
}

module.exports = { deployGovernorFixture };
