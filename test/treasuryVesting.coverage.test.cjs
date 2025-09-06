// test/treasuryVesting.coverage.test.cjs
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

// v5/v6 shims
const parseUnits = (ethers.utils?.parseUnits ?? ethers.parseUnits);
async function waitDeployed(c) { if (c.waitForDeployment) return c.waitForDeployment(); if (c.deployed) return c.deployed(); }
function addr(c) { return c?.target ?? c?.address; }

async function deployVestFixture() {
  const [owner, user1, beneficiary] = await ethers.getSigners();

  const OGNFT = await ethers.getContractFactory("OGNFT");
  const og = await OGNFT.deploy();
  await waitDeployed(og);

  const Token = await ethers.getContractFactory("StarForge");
  const sft = await Token.deploy(owner.address, owner.address, owner.address, addr(og));
  await waitDeployed(sft);

  const Vest = await ethers.getContractFactory("TreasuryVesting");
  const vest = await Vest.deploy(addr(sft));
  await waitDeployed(vest);

  return { owner, user1, beneficiary, sft, vest };
}

describe("TreasuryVesting — coverage boosters (v5/v6-safe)", function () {
  it("only admin can setAllocation", async () => {
    const { owner, user1, beneficiary, sft, vest } = await loadFixture(deployVestFixture);

    const amount = parseUnits("200", 18);
    const duration = 60 * 60;

    await (await sft.approve(addr(vest), amount)).wait();

    await expect(
      vest.connect(user1).setAllocation(beneficiary.address, amount, duration, owner.address)
    ).to.be.reverted;

    await expect(
      vest.connect(owner).setAllocation(beneficiary.address, amount, duration, owner.address)
    ).to.not.be.reverted;
  });

  it("claim immediately after allocation: 'No tokens to release'", async () => {
    const { owner, beneficiary, sft, vest } = await loadFixture(deployVestFixture);

    const amount = parseUnits("200", 18);
    // Force integer truncation: 1s elapsed / huge duration -> 0 vested
    const duration = 10n ** 25n;

    await (await sft.approve(addr(vest), amount)).wait();
    await (await vest.setAllocation(beneficiary.address, amount, duration, owner.address)).wait();

    await expect(vest.connect(beneficiary).claimVestedTokens(beneficiary.address))
      .to.be.revertedWith("No tokens to release");
  });

  it("partial then full claim over time; third claim reverts", async () => {
    const { owner, beneficiary, sft, vest } = await loadFixture(deployVestFixture);

    const amount = parseUnits("300", 18);
    const duration = 900;

    await (await sft.approve(addr(vest), amount)).wait();
    await (await vest.setAllocation(beneficiary.address, amount, duration, owner.address)).wait();

    await time.increase(Math.floor(duration / 2));
    const bal0 = await sft.balanceOf(beneficiary.address);
    await (await vest.connect(beneficiary).claimVestedTokens(beneficiary.address)).wait();
    const bal1 = await sft.balanceOf(beneficiary.address);

    const delta1 = (typeof bal1 === "bigint") ? (bal1 - bal0) : bal1.sub(bal0);
    const amt = amount;
    if (typeof delta1 === "bigint") {
      expect(delta1).to.be.gt(0n);
      expect(delta1).to.be.lt(amt);
    } else {
      expect(delta1).to.be.gt(0);
      expect(delta1).to.be.lt(amt);
    }

    await time.increase(duration + 1);
    await (await vest.connect(beneficiary).claimVestedTokens(beneficiary.address)).wait();
    const bal2 = await sft.balanceOf(beneficiary.address);

    if (typeof bal2 === "bigint") expect(bal2).to.equal(amt);
    else expect(bal2).to.equal(amt);

    await expect(vest.connect(beneficiary).claimVestedTokens(beneficiary.address))
      .to.be.revertedWith("No tokens to release");
  });

  it("setAllocation overwrite semantics: second call for same beneficiary reverts", async () => {
    const { owner, beneficiary, sft, vest } = await loadFixture(deployVestFixture);

    const amount1 = parseUnits("100", 18);
    const dur1 = 3600;
    const amount2 = parseUnits("50", 18);
    const dur2 = 60;

    const approveTotal = (typeof amount1 === "bigint") ? (amount1 + amount2) : amount1.add(amount2);
    await (await sft.approve(addr(vest), approveTotal)).wait();

    await (await vest.setAllocation(beneficiary.address, amount1, dur1, owner.address)).wait();

    await expect(
      vest.setAllocation(beneficiary.address, amount2, dur2, owner.address)
    ).to.be.revertedWith("Schedule exists");
  });
});
