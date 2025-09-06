/* test/treasury.more.coverage.test.cjs */
const { expect } = require("chai");
const { ethers } = require("hardhat");

const parse = (v) => (ethers.parseEther ? ethers.parseEther(v) : ethers.utils.parseEther(v));
const waitDeployed = async (c) => (c.waitForDeployment ? c.waitForDeployment() : c.deployed());
const addrOf = async (c) => (c.getAddress ? c.getAddress() : c.address);

describe("TreasuryVesting — more negative paths", function () {
  let owner, funder, og, sfg, staking, vesting;

  beforeEach(async () => {
    [owner, funder] = await ethers.getSigners();

    // OGNFT
    const OGNFT = await ethers.getContractFactory("OGNFT");
    og = await OGNFT.deploy();
    await waitDeployed(og);

    // StarForge token
    const StarForge = await ethers.getContractFactory("StarForge");
    sfg = await StarForge.deploy(
      funder.address,         // initial holder / funder
      owner.address,          // treasury
      owner.address,          // council
      await addrOf(og)
    );
    await waitDeployed(sfg);

    // Staking
    const Staking = await ethers.getContractFactory("StarforgeStaking");
    staking = await Staking.deploy(await addrOf(sfg), await addrOf(og));
    await waitDeployed(staking);

    // TreasuryVesting (✅ one constructor arg: token)
    const TreasuryVesting = await ethers.getContractFactory("TreasuryVesting");
    vesting = await TreasuryVesting.deploy(await addrOf(sfg));
    await waitDeployed(vesting);
  });

  it("reverts recoverExcessSFT when there is nothing to recover; non-owner fundStaking reverts", async () => {
    // No SRV initialized and no escrow/excess in contract → recover should revert
    await expect(vesting.recoverExcessSFT(1n, owner.address))
      .to.be.revertedWith("Amount exceeds excess");

    // Non-owner tries to fundStaking → should revert due to access control / ownership
    await expect(
      vesting.connect(funder).fundStaking(await addrOf(staking), 1n)
    ).to.be.reverted;
    // If you want a stricter assertion and your contract uses OZ Ownable v5:
    // await expect(
    //   vesting.connect(funder).fundStaking(await addrOf(staking), 1n)
    // ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount");
  });
});
