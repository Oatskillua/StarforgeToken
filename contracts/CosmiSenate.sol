// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./IStarforgeToken.sol";

contract CosmiSenate is Ownable {
    IStarforgeToken public token;
    uint256 public proposalCount;
    uint256 public constant QUORUM = 500;
    uint256 public constant DURATION = 7 days;

    struct Proposal {
        uint256 id;
        address proposer;
        string description;
        bytes32 descriptionHash;
        uint256 yesVotes;
        uint256 noVotes;
        uint256 startTime;
        bool executed;
    }

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(address => uint8) public foundingBonus;

    event ProposalCreated(uint256 id, address proposer, string description);
    event Voted(uint256 proposalId, address voter, bool support, uint256 weight);
    event ProposalExecuted(uint256 proposalId);
    event ProposalVetoed(uint256 proposalId);

    constructor(address _token) Ownable(msg.sender) {
        token = IStarforgeToken(_token);
    }


    function getVoteWeight(address voter) public view returns (uint256) {
        uint256 base = 1;
        uint256 bonus = foundingBonus[voter];
        uint256 balance = token.balanceOf(voter);
        if (balance >= 100_000_000 * 1e18) bonus += 3; // Black Hole
        else if (balance >= 50_000_000 * 1e18) bonus += 2; // Supernova
        else if (balance >= 10_000_000 * 1e18) bonus += 1; // Galaxy Light
        uint256 total = base + bonus;
        return total > 5 ? 5 : total;
    }

    function propose(string calldata description) external {
        proposalCount++;
        Proposal storage p = proposals[proposalCount];
        p.id = proposalCount;
        p.proposer = msg.sender;
        p.description = description;
        p.descriptionHash = keccak256(bytes(description));
        p.startTime = block.timestamp;
        emit ProposalCreated(p.id, msg.sender, description);
    }

    function vote(uint256 proposalId, bool support) external {
        require(!hasVoted[proposalId][msg.sender], "Already voted");
        Proposal storage p = proposals[proposalId];
        require(block.timestamp <= p.startTime + DURATION, "Voting period expired");
        uint256 weight = getVoteWeight(msg.sender);
        if (support) p.yesVotes += weight;
        else p.noVotes += weight;
        hasVoted[proposalId][msg.sender] = true;
        emit Voted(proposalId, msg.sender, support, weight);
    }

    function execute(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(!p.executed, "Already executed");
        require(block.timestamp >= p.startTime + 3 days, "Voting still active");
        require(p.yesVotes + p.noVotes >= QUORUM, "Not enough voters");

        // Veto check
        if (p.noVotes * 100 / (p.yesVotes + p.noVotes) >= 66) {
            p.executed = true;
            emit ProposalVetoed(proposalId);
            return;
        }

        p.executed = true;
        emit ProposalExecuted(proposalId);
    }

    function assignFoundingBonus(address user, uint8 bonus) external onlyOwner {
        require(bonus <= 1);
        foundingBonus[user] = bonus;
    }
}