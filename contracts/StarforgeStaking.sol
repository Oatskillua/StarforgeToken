// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IStarForge.sol";
import "./IOGNFT.sol";

/// @notice Non-inflationary staking: rewards are paid only from a pre-funded reserve tracked on-chain.
/// @dev Assign DEFAULT_ADMIN_ROLE and STAKING_ADMIN_ROLE to the Timelock in production.
contract StarforgeStaking is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ------------------------------- Roles -----------------------------------
    bytes32 public constant STAKING_ADMIN_ROLE = keccak256("STAKING_ADMIN_ROLE");

    // ------------------------------- Tokens ----------------------------------
    IStarForge public immutable sft;
    IOGNFT   public immutable ogNFT; // optional; pass address(0) if OG boost is disabled

    // ------------------------- Economic Parameters ---------------------------
    // All APY numbers are in basis points (bps): 10000 = 100%
    uint256 public constant MAX_APY_BPS          = 700;   // 7.00% hard cap (base + OG boost)
    uint256 public constant OGNFT_BOOST_BPS      = 200;   // +2.00% if user holds OG NFT
    uint256 public constant WITHDRAWAL_FEE_BPS   = 100;   // 1.00% fee burned on unstake
    uint256 public constant MAX_APY_STEP_BPS     = 100;   // max per-change step = 1.00%
    uint256 public constant APY_CHANGE_COOLDOWN  = 90 days;
    uint256 public constant SECONDS_PER_YEAR     = 365 days;

    // --------------------------- Governed State ------------------------------
    uint256 public baseApyBps = 350;            // default 3.50% base APY
    uint256 public lastApyUpdate;               // last timestamp APY was updated

    // Rewards funding (push-based)
    address public rewardsFunder;               // TreasuryVesting (or timelock) allowed to notify funding
    uint256 public rewardsReserve;              // Rewards-only balance available to pay claims

    // --------------------------- User Accounting -----------------------------
    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public lastUpdateTime;
    mapping(address => uint256) public rewardAccrued; // accrued but not yet claimed
    uint256 public totalStaked;

    // ------------------------------- Events ----------------------------------
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount, uint256 fee);
    event RewardsClaimed(address indexed user, uint256 amount);

    event BaseApyUpdated(uint256 oldBps, uint256 newBps);
    event RewardsFunderSet(address indexed who);
    event RewardsFunded(address indexed from, uint256 amount);

    // -------------------------------- Init -----------------------------------
    constructor(IStarForge _sft, IOGNFT _ogNFT) {
        require(address(_sft) != address(0), "SFT=0"); // SFT must be set
        // ogNFT may be zero (feature toggle). If zero, no boost is applied.
        sft   = _sft;
        ogNFT = _ogNFT;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(STAKING_ADMIN_ROLE, msg.sender);
        lastApyUpdate = block.timestamp;
    }

    // ------------------------------- Views -----------------------------------

    function _currentRateBps(address user) internal view returns (uint256) {
        uint256 rate = baseApyBps;
        if (address(ogNFT) != address(0)) {
            // Presence check (>=1 OG NFT gives boost); tolerate external call failure.
            try ogNFT.balanceOf(user) returns (uint256 bal) {
                if (bal > 0) rate += OGNFT_BOOST_BPS;
            } catch {}
        }
        // Cap aggregate rate defensively
        if (rate > MAX_APY_BPS) return MAX_APY_BPS;
        return rate;
    }

    // Accrual since the last checkpoint for `user`
    function _pendingSinceLast(address user) internal view returns (uint256) {
        uint256 principal = stakedBalance[user];
        if (principal > 0) {
            uint256 last = lastUpdateTime[user];
            if (last == 0) return 0;
            if (block.timestamp > last) {
                uint256 delta = block.timestamp - last; // strictly positive
                uint256 rateBps = _currentRateBps(user);
                // linear accrual: principal * (rateBps/10000) * (delta/secondsPerYear)
                return (principal * rateBps * delta) / (SECONDS_PER_YEAR * 10000);
            }
        }
        return 0;
    }

    /// @notice Total pending rewards at current block
    function pendingRewards(address user) public view returns (uint256) {
        return rewardAccrued[user] + _pendingSinceLast(user);
    }

    /// @notice Compatibility helper expected by tests/UIs
    function getRewards(address user) external view returns (uint256) {
        return pendingRewards(user);
    }

    // --------------------------- Internal Helpers ----------------------------

    /// @dev Pulls forward pending rewards into rewardAccrued and updates timestamp
    function updateRewards(address user) public {
        uint256 addl = _pendingSinceLast(user);
        if (addl > 0) {
            rewardAccrued[user] += addl;
        }
        lastUpdateTime[user] = block.timestamp;
    }

    // ------------------------------- Actions ---------------------------------

    function stake(uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "Cannot stake zero");

        // Initialize timestamp if this is the first interaction
        if (lastUpdateTime[msg.sender] == 0) {
            lastUpdateTime[msg.sender] = block.timestamp;
        }

        updateRewards(msg.sender);
        stakedBalance[msg.sender] += amount; // effects
        totalStaked += amount;

        IERC20(address(sft)).safeTransferFrom(msg.sender, address(this), amount); // interaction
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "Cannot unstake zero");
        require(amount <= stakedBalance[msg.sender], "Insufficient staked balance");

        updateRewards(msg.sender);

        uint256 fee = (amount * WITHDRAWAL_FEE_BPS) / 10000;
        stakedBalance[msg.sender] -= amount; // effects
        totalStaked -= amount;

        // Burn fee from contract/treasury per token's burn hook
        if (fee > 0) {
            sft.burnExcessTreasury(fee);
        }

        // Pay user principal minus fee
        IERC20(address(sft)).safeTransfer(msg.sender, amount - fee); // interaction
        emit Unstaked(msg.sender, amount, fee);
    }

    function claimRewards() external whenNotPaused nonReentrant {
        updateRewards(msg.sender);
        uint256 reward = rewardAccrued[msg.sender];
        require(reward > 0, "No rewards");
        require(rewardsReserve >= reward, "Insufficient rewards reserve");

        rewardAccrued[msg.sender] = 0;           // effects
        rewardsReserve -= reward;                 // effects (CEI)
        IERC20(address(sft)).safeTransfer(msg.sender, reward); // interaction

        emit RewardsClaimed(msg.sender, reward);
    }

    // ---------------------------- Funding (Push) -----------------------------

    /// @notice Set the only address allowed to notify reward funding (e.g., TreasuryVesting).
    function setRewardsFunder(address who) external onlyRole(STAKING_ADMIN_ROLE) {
        require(who != address(0), "Zero funder");
        rewardsFunder = who;
        emit RewardsFunderSet(who);
    }

    /// @notice Treasury/vesting pushes tokens to this contract, then calls notify to register them as rewards.
    /// @dev Caller MUST be `rewardsFunder`. Assumes tokens were already transferred here.
    function notifyRewardReceived(uint256 amount) external nonReentrant {
        require(msg.sender == rewardsFunder, "Not funder");
        require(amount > 0, "Amount=0");
        // We do not enforce balance checks here; governance should ensure funding is real.
        rewardsReserve += amount;
        emit RewardsFunded(msg.sender, amount);
    }

    // ------------------------- Governance Controls ---------------------------

    /// @notice Returns (numerator, denominator) for runway years with a proposed base APY.
    /// @dev Worst-case assumption: everyone gets OG boost; annualEmissions = totalStaked * (base+boost)/10000
    function _runwayFracWith(uint256 newBaseBps) internal view returns (uint256 numer, uint256 denom) {
        uint256 totalBps = newBaseBps + OGNFT_BOOST_BPS;
        if (totalStaked == 0 || totalBps == 0) {
            // Infinite runway sentinel (1/0)
            return (1, 0);
        }
        uint256 annualEmissions = (totalStaked * totalBps) / 10_000;
        return (rewardsReserve, annualEmissions);
    }

    /// @notice Update the base APY (bps), subject to hard cap, cooldown, step limit, and 7-year runway floor.
    function setBaseApyBps(uint256 newBps) external onlyRole(STAKING_ADMIN_ROLE) {
        // Hard cap applies to aggregate (base + OG boost)
        require(newBps + OGNFT_BOOST_BPS <= MAX_APY_BPS, "Exceeds cap");

        // Cooldown
        require(block.timestamp >= lastApyUpdate + APY_CHANGE_COOLDOWN, "Cooldown");

        // Step size
        uint256 old = baseApyBps;
        uint256 diff = old > newBps ? (old - newBps) : (newBps - old);
        require(diff <= MAX_APY_STEP_BPS, "Step too large");

        // Runway floor: require runway >= 7 years (conservative)
        (uint256 numer, uint256 denom) = _runwayFracWith(newBps);
        if (denom > 0) {
            // Require numer/denom >= 7  => numer >= 7 * denom
            require(numer >= 7 * denom, "Runway < 7y");
        }
        // else denom == 0 => no stake or APY 0 => infinite runway, safe to proceed.

        baseApyBps = newBps;
        lastApyUpdate = block.timestamp;
        emit BaseApyUpdated(old, newBps);
    }

    // ------------------------------- Pausing ---------------------------------

    function pause() external onlyRole(STAKING_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(STAKING_ADMIN_ROLE) { _unpause(); }
}
