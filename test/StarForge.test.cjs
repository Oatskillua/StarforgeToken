const { expect } = require("chai");
const hre = require("hardhat");
const { ethers, network } = hre;
const { keccak256, toUtf8Bytes, parseUnits } = ethers;

describe("StarForge", function () {
  let token, ogNFT, deployer, founder, treasury, council;

  beforeEach(async function () {
    [deployer, founder, treasury, council] = await ethers.getSigners();

    const OGNFT = await ethers.getContractFactory("OGNFT");
    ogNFT = await OGNFT.deploy();
    await ogNFT.waitForDeployment();

    const StarForge = await ethers.getContractFactory("StarForge");
    token = await StarForge.deploy(
      founder.address,
      treasury.address,
      council.address,
      await ogNFT.getAddress()
    );
    await token.waitForDeployment();

    await ogNFT.grantRole(
      keccak256(toUtf8Bytes("MINTER_ROLE")),
      await token.getAddress()
    );
  });

  it("initializes correctly", async function () {
    const TOTAL_SUPPLY = parseUnits("1000000000", 18);
    expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY);
    expect(await token.balanceOf(founder.address)).to.equal(TOTAL_SUPPLY);
    expect(await token.ogNFT()).to.equal(await ogNFT.getAddress());
  });

  it("allows user burns and assigns ranks", async function () {
    const amt = parseUnits("100000", 18);
    await token.connect(founder).transfer(deployer.address, amt);
    await token.connect(deployer).burnUser(amt);
    expect(await token.burnRanks(deployer.address)).to.equal(1n); // SparkCarrier
    expect(await ogNFT.tokenURI(1)).to.equal("ipfs://spark_carrier");
  });

  it("burns treasury tokens monthly", async function () {
    const amt = parseUnits("1000000", 18);
    await token.connect(founder).transfer(treasury.address, amt);
    await token.connect(treasury).burnExcessTreasury(amt);
    expect(await token.balanceOf(treasury.address)).to.equal(0n);
  });

  it("burns milestone tokens quarterly", async function () {
    const amt = parseUnits("1000000", 18);
    await token.connect(founder).transfer(treasury.address, amt);
    await token.connect(treasury).burnMilestone(amt);
    expect(await token.balanceOf(treasury.address)).to.equal(0n);
  });

  it("vests team tokens over 2 years", async function () {
    const TreasuryVesting = await ethers.getContractFactory("TreasuryVesting");
    const vesting = await TreasuryVesting.deploy(await token.getAddress());
    await vesting.waitForDeployment();

    await vesting.grantRole(
      keccak256(toUtf8Bytes("VESTING_ADMIN_ROLE")),
      founder.address
    );

    const amount = parseUnits("1000000", 18);
    await token.connect(founder).approve(await vesting.getAddress(), amount);

    await vesting
      .connect(founder)
      .setAllocation(
        founder.address,
        amount,
        2 * 365 * 24 * 60 * 60,
        founder.address
      );

    await network.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
    await network.provider.send("evm_mine");

    await vesting.connect(founder).claimVestedTokens(founder.address);

    const expected = parseUnits("999500000", 18); // initial 1B - 1M + 0.5M
    const tolerance = parseUnits("0.1", 18);      // 0.1 SFG tolerance
    const bal = await token.balanceOf(founder.address);
    expect(bal).to.be.closeTo(expected, tolerance);
  });

  it("pauses and unpauses", async function () {
    await token.connect(council).pause();
    await expect(
      token.connect(founder).transfer(deployer.address, 1000n)
    ).to.be.revertedWithCustomError(token, "EnforcedPause");
    await token.connect(council).unpause();
    await token.connect(founder).transfer(deployer.address, 1000n);
    expect(await token.balanceOf(deployer.address)).to.equal(1000n);
  });
});
