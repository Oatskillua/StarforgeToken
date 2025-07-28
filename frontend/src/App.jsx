import { useState } from 'react';
import { ethers } from 'ethers';
import senateABI from './artifacts/CosmiSenate.sol/CosmiSenate.json';
import tokenABI from './artifacts/StarforgeToken.sol/StarforgeToken.json';
import { submitProposal } from './submitProposal';

const SENATE_ADDRESS = '0xF720aa96dC992EaDa30Cb831005cC700CbAFb6E2';
const TOKEN_ADDRESS = '0xF67331EcfB2e173FA331d95634cb8FfaE8331C98';

function App() {
  const [connected, setConnected] = useState(false);
  const [proposals, setProposals] = useState([]);
  const [newProposal, setNewProposal] = useState('');

  async function connectWallet() {
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const senate = new ethers.Contract(SENATE_ADDRESS, senateABI.abi, signer);

    const count = await senate.proposalCount();
    const list = [];

    for (let i = 0; i < count; i++) {
      const p = await senate.proposals(i);
      list.push(p.description);
    }

    setProposals(list);
    setConnected(true);
  }

  async function handleSubmit() {
    await submitProposal(newProposal);
    setNewProposal('');
    connectWallet(); // reload proposals
  }

  return (
    <div>
      <h1>Starforge Governance</h1>
      {!connected && <button onClick={connectWallet}>Connect Wallet</button>}
      {connected && (
        <div>
          <h2>Proposals</h2>
          <ul>
            {proposals.map((desc, i) => (
              <li key={i}>{desc}</li>
            ))}
          </ul>
          <input
            type="text"
            placeholder="New Proposal Description"
            value={newProposal}
            onChange={(e) => setNewProposal(e.target.value)}
          />
          <button onClick={handleSubmit}>Submit Proposal</button>
        </div>
      )}
    </div>
  );
}

export default App;