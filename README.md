# StarforgeToken Protocol

This repository contains the smart contracts and front-end dApp for the StarforgeToken ecosystem, including token, staking, and governance.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Variables](#environment-variables)
3. [Local Development](#local-development)
4. [Running Tests](#running-tests)
5. [Deploying](#deploying)
6. [Front-end Usage](#front-end-usage)
7. [Folder Structure](#folder-structure)

---

## Prerequisites

* Node.js v16+ & npm
* MetaMask (for front-end testing)
* Infura or Alchemy API key for Sepolia

---

## Environment Variables

Copy `.env.example` to `.env` in the project root and fill in:

```bash
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
PRIVATE_KEY=YOUR_PRIVATE_KEY_NO_0x
```

---

## Local Development

1. **Start Hardhat node** (local network):

   ```bash
   npm install
   npx hardhat node
   ```
2. **Deploy to local** (in a new terminal):

   ```bash
   npx hardhat run scripts/deploy.js --network localhost
   ```
3. **Start front-end**:

   ```bash
   cd starforge-frontend
   npm install
   npm start
   ```
4. **Connect MetaMask** to `http://localhost:8545` and import one of the local accounts (provided by Hardhat). Import the token at the printed address.

---

## Running Tests

```bash
npx hardhat test
```

Covers:

* Staking (mint, stake, earn, withdraw, claim)
* Governance (propose, vote, queue, execute)

---

## Deploying to Sepolia

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

After deployment, copy the `StarforgeToken` address and **import** it in MetaMask (Sepolia). Then update `starforge-frontend/src/config.js` with the new addresses.

---

## Front-end Usage

1. In `starforge-frontend`:

   ```bash
   npm start
   ```
2. Connect your wallet.
3. **Staking**: approve, stake, withdraw, claim.
4. **Governance**: view current rate, create proposals, vote, queue, execute.

---

## Folder Structure

```
StarforgeToken/
├─ contracts/        Solidity contracts
├─ scripts/          Deployment & helper scripts
├─ test/             Automated tests
├─ starforge-frontend/ React front-end
├─ hardhat.config.js
├─ .env.example      Env var template
└─ README.md         This file
```
