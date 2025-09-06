const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OGNFT — approvals & ERC721 edges (coverage)", function () {
  it("blocks approvals/transfers (soulbound) and keeps readbacks sane", async () => {
    const [admin, user] = await ethers.getSigners();

    const OGNFT = await ethers.getContractFactory("OGNFT");
    const og = await OGNFT.deploy();
    await og.waitForDeployment();

    const MINTER_ROLE = await og.MINTER_ROLE();
    await (await og.grantRole(MINTER_ROLE, admin.address)).wait();

    // Use a VALID rank (e.g., 1) to avoid 'Invalid rank' revert
    await (await og.mint(admin.address, 1)).wait();

    // Approvals may revert in soulbound implementations; either way, approval must not be set.
    try { await og.approve(user.address, 1n); } catch (_) {}
    try { await og.setApprovalForAll(user.address, true); } catch (_) {}

    // Readbacks should show no approvals
    expect(await og.getApproved(1n)).to.equal(ethers.ZeroAddress);
    expect(await og.isApprovedForAll(admin.address, user.address)).to.equal(false);

    // Both safeTransferFrom overloads must revert
    await expect(
      og["safeTransferFrom(address,address,uint256)"](admin.address, user.address, 1n)
    ).to.be.reverted;
    await expect(
      og["safeTransferFrom(address,address,uint256,bytes)"](admin.address, user.address, 1n, "0x")
    ).to.be.reverted;
  });
});
