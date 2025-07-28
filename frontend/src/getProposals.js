import { ethers } from 'ethers';
import SenateABI from '../../artifacts/contracts/CosmiSenate.sol/CosmiSenate.json';

const SENATE_ADDRESS = '0x260F04665dE153E551DF09140dE57338dBf6bA3f';

export async function getProposals() {
  if (!window.ethereum) return [];

  const provider = new ethers.BrowserProvider(window.ethereum);
  const contract = new ethers.Contract(SENATE_ADDRESS, SenateABI.abi, provider);

  const count = await contract.proposalCount();
  const proposals = [];

  for (let i = 0; i < count; i++) {
    const p = await contract.proposals(i);
    proposals.push(p.description);
  }

  return proposals;
}