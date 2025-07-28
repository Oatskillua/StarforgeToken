const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const tokenAddress = "0x0409e76Bc6ec6333aC7f1A099C5D53151a88E8f1";

  const token = await hre.ethers.getContractAt(
    "StarforgeToken",
    tokenAddress
  );

  const amount = hre.ethers.utils.parseUnits("1000", 18);
  const tx = await token.mint(deployer.address, amount);
  await tx.wait();

  console.log(
    "Minted",
    hre.ethers.utils.formatUnits(amount, 18),
    "SFT to",
    deployer.address
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});