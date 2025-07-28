import { ethers } from 'ethers';
import senateABI from './artifacts/CosmiSenate.sol/CosmiSenate.json';
import { SENATE_ADDRESS } from './constants';

export async function submitProposal(description) {
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const senate = new ethers.Contract(SENATE_ADDRESS, senateABI.abi, signer);
  const tx = await senate.submitProposal(description);
  await tx.wait();
}