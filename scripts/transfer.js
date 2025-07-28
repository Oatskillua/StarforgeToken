// scripts/transfer.js
require("dotenv").config();
const hre = require("hardhat");

async function main() {
  // 1) Connect your deployer wallet (the one that got the constructor‐mint)
  const provider = new hre.ethers.providers.JsonRpcProvider(
    process.env.SEPOLIA_RPC_URL
  );
  const deployer = new hre.ethers.Wallet(
    process.env.PRIVATE_KEY, // no “0x” prefix here
    provider
  );
  console.log("Using deployer:", deployer.address);

  // 2) Attach to your latest token contract
  const token = new hre.ethers.Contract(
    "0x0E4Ef2B44Bb18b595AdD2Ff98fA20B32538ed115", // replace with your real TOKEN_ADDRESS
    require("../artifacts/contracts/StarforgeToken.sol/StarforgeToken.json").abi,
    deployer
  );

  // 3) Check deployer balance
  const bal = await token.balanceOf(deployer.address);
  console.log("Deployer SFT balance:", hre.ethers.utils.formatUnits(bal, 18));

  // 4) Choose your recipient & amount
  const recipient = "0xF720aa96dC992EaDa30Cb831005cC700CbAFb6E2"; // your daily-driver wallet
  const amount    = hre.ethers.utils.parseUnits("1000", 18);

  // 5) Send the tokens
  const tx = await token.transfer(recipient, amount);
  console.log("Transfer tx hash:", tx.hash);
  await tx.wait();
  console.log(`✅ 1,000 SFT sent to ${recipient}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});