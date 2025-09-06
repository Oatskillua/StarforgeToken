// test/TreasuryVesting.test.cjs
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

describe("TreasuryVesting", function () {
  let token, vesting, deployer, beneficiary, treasury, council, ogNFT;

  const toWei = (v) => ethers.parseUnits(v, 18);
  const ONE_YEAR = 365n * 24n * 60n * 60n;

  // simple bigint approx check
  async function expectApprox(actualPromiseOrValue, expected, tolerance) {
    const actual = typeof actualPromiseOrValue === "bigint"
      ? actualPromiseOrValue
      : await actualPromiseOrValue;
    const diff = actual > expected ? actual - expected : expected - actual;
    expect(diff).to.be.lte(tolerance);
  }

  beforeEach(async function () {
    [deployer, beneficiary, treasury, council] = await ethers.getSigners();

    const OGNFT = await ethers.getContractFactory("OGNFT");
    ogNFT = await OGNFT.deploy();
    await ogNFT.waitForDeployment();

    const StarForge = await ethers.getContractFactory("StarForge");
    token = await StarForge.deploy(
      await deployer.getAddress(),
      await treasury.getAddress(),
      await council.getAddress(),
      await ogNFT.getAddress()
    );
    await token.waitForDeployment();

    const TreasuryVesting = await ethers.getContractFactory("TreasuryVesting");
    vesting = await TreasuryVesting.deploy(await token.getAddress());
    await vesting.waitForDeployment();

    // Approve vesting to pull tokens when needed
    const maxApprove = toWei("1000000000"); // plenty for tests
    await token.connect(deployer).approve(await vesting.getAddress(), maxApprove);

    // Grant VESTING_ADMIN_ROLE to deployer
    const VESTING_ADMIN_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("VESTING_ADMIN_ROLE")
    );
    await vesting.grantRole(VESTING_ADMIN_ROLE, await deployer.getAddress());
  });

  it("sets and releases allocations", async function () {
    const amount = toWei("1000000"); // 1,000,000 SFG
    const duration = 2n * ONE_YEAR;

    // Set allocation for beneficiary (linear over 2 years)
    await vesting
      .connect(deployer)
      .setAllocation(
        await beneficiary.getAddress(),
        amount,
        duration,
        await deployer.getAddress()
      );

    // Halfway through: ~50% vested
    await ethers.provider.send("evm_increaseTime", [Number(ONE_YEAR)]);
    await ethers.provider.send("evm_mine");

    await vesting.connect(beneficiary).claimVestedTokens(await beneficiary.getAddress());

    // Expect ~500,000 SFG (±0.1 SFG tolerance)
    await expectApprox(
      token.balanceOf(await beneficiary.getAddress()),
      toWei("500000"),
      toWei("0.1")
    );

    // End of vest: claim remaining
    await ethers.provider.send("evm_increaseTime", [Number(ONE_YEAR)]);
    await ethers.provider.send("evm_mine");

    await vesting.connect(beneficiary).claimVestedTokens(await beneficiary.getAddress());

    // Expect ~1,000,000 SFG total (±0.1 SFG tolerance)
    await expectApprox(
      token.balanceOf(await beneficiary.getAddress()),
      toWei("1000000"),
      toWei("0.1")
    );
  });
});
