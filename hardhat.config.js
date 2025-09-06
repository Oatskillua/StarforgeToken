import * as dotenv from "dotenv";
dotenv.config();

import "@nomicfoundation/hardhat-network-helpers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers"; // v6-compatible plugin
import "hardhat-gas-reporter";
import "solidity-coverage";

// Env helpers (supports either PRIVATE_KEY or 0x-prefixed)
const {
  SEPOLIA_RPC_URL,
  BASE_RPC_URL,
  PRIVATE_KEY: RAW_PK,
} = process.env;

function pkToAccounts(pk) {
  if (!pk) return [];
  return [pk.startsWith("0x") ? pk : `0x${pk}`];
}

// Build networks conditionally so Hardhat doesn’t error in CI
const networks = {
  // hardhat: {} // (implicit; add overrides here if needed)
};

if (SEPOLIA_RPC_URL && RAW_PK) {
  networks.sepolia = {
    url: SEPOLIA_RPC_URL,
    chainId: 11155111,
    accounts: pkToAccounts(RAW_PK),
  };
}

// Optional Base mainnet (only if you set BASE_RPC_URL + PRIVATE_KEY)
if (BASE_RPC_URL && RAW_PK) {
  networks.base = {
    url: BASE_RPC_URL,
    chainId: 8453,
    accounts: pkToAccounts(RAW_PK),
  };
}

export default {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 50 },
      evmVersion: "cancun",
    },
  },
  networks,
  // Keep old test helpers working under ethers v6
  mocha: { require: ["test/v6-shim.cjs"] },
};
