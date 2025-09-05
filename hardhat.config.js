import * as dotenv from "dotenv";
dotenv.config();

import "@nomicfoundation/hardhat-network-helpers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers"; // v6-compatible plugin
import "hardhat-gas-reporter";
import "solidity-coverage";

export default {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 50 },
      evmVersion: "cancun",
    },
  },
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL,
      accounts: process.env.PRIVATE_KEY ? [`0x${process.env.PRIVATE_KEY}`] : [],
    },
    // (optional) add Base later if you like:
    // base: {
    //   url: process.env.BASE_RPC_URL,
    //   accounts: process.env.PRIVATE_KEY ? [`0x${process.env.PRIVATE_KEY}`] : [],
    //   chainId: 8453,
    // },
  },
  // <— This line adds the single shim so your old tests keep working under v6
  mocha: { require: ["test/v6-shim.cjs"] },
};
