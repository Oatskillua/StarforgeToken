// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./StarforgeToken.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract StarforgeStaking is Ownable {

     /// @notice Returns pending rewards for `user` (what they’d get if they claimed now)
     function earned(address user) external view returns (uint256) {
         StakeData storage s = stakes[user];
         uint256 pending = s.rewardDebt;
         uint256 duration = block.timestamp - s.lastUpdated;
         if (s.amount > 0) {
             // rewards accrue at rate per second, scaled by 1e18 from update logic
             pending += (s.amount * rewardRate * duration) / 1e18;
         }
         return pending;
     }

    StarforgeToken public immutable starforgeToken;
    uint256 public rewardRate; // tokens per second
    uint256 public totalStaked;

    struct StakeData {
        uint256 amount;
        uint256 rewardDebt;
        uint256 lastUpdated;
    }

    mapping(address => StakeData) public stakes;

    constructor(address _token, uint256 _rewardRate) Ownable(msg.sender) {
        starforgeToken = StarforgeToken(_token);
        rewardRate = _rewardRate;
    }

    function stake(uint256 amount) external {
        require(amount > 0, "Zero stake");
        _updateRewards(msg.sender);

        starforgeToken.transferFrom(msg.sender, address(this), amount);
        stakes[msg.sender].amount += amount;
        totalStaked += amount;
    }

    function withdraw(uint256 amount) external {
        require(amount > 0 && stakes[msg.sender].amount >= amount, "Invalid withdraw");
        _updateRewards(msg.sender);

        stakes[msg.sender].amount -= amount;
        totalStaked -= amount;
        starforgeToken.transfer(msg.sender, amount);
    }

    function claimRewards() external {
        _updateRewards(msg.sender);
        uint256 reward = stakes[msg.sender].rewardDebt;
        require(reward > 0, "No rewards");
        stakes[msg.sender].rewardDebt = 0;
        starforgeToken.mint(msg.sender, reward);
    }

    function _updateRewards(address user) internal {
        StakeData storage s = stakes[user];
        uint256 duration = block.timestamp - s.lastUpdated;
        if (s.amount > 0) {
            s.rewardDebt += (s.amount * rewardRate * duration) / 1e18;
        }
        s.lastUpdated = block.timestamp;
    }

    function setRewardRate(uint256 _rate) external onlyOwner {
        rewardRate = _rate;
    }
}