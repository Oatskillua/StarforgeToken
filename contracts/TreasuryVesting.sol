// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IStarForge.sol";

/// @notice Treasury vesting with strict accounting and governance-friendly controls.
/// @dev Assign VESTING_ADMIN_ROLE and DEFAULT_ADMIN_ROLE to the TimelockController in production.
contract TreasuryVesting is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ----------------------------- Roles / Token ------------------------------
    bytes32 public constant VESTING_ADMIN_ROLE = keccak256("VESTING_ADMIN_ROLE");
    IStarForge public immutable sft;

    // ----------------------------- Vesting Model ------------------------------
    struct VestingSchedule {
        uint256 totalAmount;
        uint256 releasedAmount;
        uint256 startTime;
        uint256 duration;
        address funder;
    }

    /// @notice Total SFT reserved for all active vesting schedules.
    uint256 public totalEscrowed;

    /// @notice beneficiary => schedule
    mapping(address => VestingSchedule) public vestingSchedules;

    // ----------------------- Staking Rewards Vault (SRV) ----------------------
    /// @dev One-time, immutable dedication of supply to staking rewards (push-funded).
    uint16 public constant MIN_STAKING_VAULT_BPS = 1500; // 15.00%
    uint16 public constant MAX_STAKING_VAULT_BPS = 2000; // 20.00%

    bool    public stakingVaultInitialized;
    uint256 public stakingVaultCap;       // Immutable cap once initialized
    uint256 public stakingVaultBalance;   // Remaining SRV funds held here

    // ------------------------------- Events -----------------------------------
    /// Vesting
    event AllocationSet(address indexed beneficiary, uint256 amount, uint256 duration, address indexed funder);
    event AllocationCleared(address indexed beneficiary, address indexed receiver, uint256 refundedAmount);
    event TokensClaimed(address indexed beneficiary, uint256 amount);

    /// SRV
    event StakingVaultInitialized(uint256 capAmount, uint16 percentBps, address indexed funder);
    event StakingVaultFunded(address indexed staking, uint256 amount, address indexed caller);

    // ------------------------------ Constructor -------------------------------
    constructor(IStarForge _sft) {
        require(address(_sft) != address(0), "SFT=0");
        sft = _sft;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VESTING_ADMIN_ROLE, msg.sender);
    }

    // ============================== Vesting API ===============================

    /// @notice Create a vesting allocation and fund it in a single tx.
    /// @dev Eliminates arbitrary-send by requiring the funder to be the caller.
    ///      Cannot overwrite an existing schedule; use clearAllocation first if needed.
    function setAllocation(address beneficiary, uint256 amount, uint256 duration, address funder)
        external
        onlyRole(VESTING_ADMIN_ROLE)
    {
        require(beneficiary != address(0) && funder != address(0), "Zero address");
        require(funder == msg.sender, "Funder must be caller");
        require(amount > 0, "Invalid amount");
        require(duration > 0, "Invalid duration");
        require(vestingSchedules[beneficiary].totalAmount == 0, "Schedule exists"); // sentinel for no-schedule

        // Effects
        vestingSchedules[beneficiary] = VestingSchedule({
            totalAmount: amount,
            releasedAmount: 0,
            startTime: block.timestamp,
            duration: duration,
            funder: funder
        });
        totalEscrowed += amount;

        // Interactions
        IERC20(address(sft)).safeTransferFrom(msg.sender, address(this), amount);

        emit AllocationSet(beneficiary, amount, duration, funder);
    }

    /// @notice Linearly vested amount as of `timestamp`.
    /// @dev Uses timestamps intentionally; linear vesting is time-based.
    function vestedAmount(address beneficiary, uint256 timestamp) public view returns (uint256) {
        VestingSchedule memory schedule = vestingSchedules[beneficiary];
        uint256 total = schedule.totalAmount;
        if (total > 0) {
            uint256 start = schedule.startTime;
            if (timestamp > start) {
                uint256 end = start + schedule.duration;
                if (timestamp >= end) return total;
                uint256 elapsed = timestamp - start;
                return (total * elapsed) / schedule.duration;
            }
        }
        return 0;
    }

    /// @notice Claim vested tokens for a beneficiary.
    function claimVestedTokens(address beneficiary) external nonReentrant {
        VestingSchedule storage schedule = vestingSchedules[beneficiary];
        require(schedule.totalAmount > 0, "No vesting schedule");

        uint256 vested = vestedAmount(beneficiary, block.timestamp);
        uint256 unreleased = vested > schedule.releasedAmount ? (vested - schedule.releasedAmount) : 0;
        require(unreleased > 0, "No tokens to release");

        // Effects
        schedule.releasedAmount += unreleased;
        totalEscrowed -= unreleased;

        // Interactions
        IERC20(address(sft)).safeTransfer(beneficiary, unreleased);

        emit TokensClaimed(beneficiary, unreleased);
    }

    /// @notice Admin can clear an existing schedule and refund all *unreleased* tokens.
    /// @dev Route this via governance timelock by giving the role to the timelock.
    /// @param beneficiary The schedule owner to clear.
    /// @param receiver Receiver of the refund. If zero, defaults to the original funder.
    function clearAllocation(address beneficiary, address receiver)
        external
        onlyRole(VESTING_ADMIN_ROLE)
        nonReentrant
    {
        VestingSchedule memory schedule = vestingSchedules[beneficiary];
        require(schedule.totalAmount > 0, "No schedule");

        uint256 unreleased = schedule.totalAmount - schedule.releasedAmount;
        delete vestingSchedules[beneficiary];

        if (unreleased > 0) {
            totalEscrowed -= unreleased;
            address to = receiver == address(0) ? schedule.funder : receiver;
            require(to != address(0), "Zero receiver");
            IERC20(address(sft)).safeTransfer(to, unreleased);
            emit AllocationCleared(beneficiary, to, unreleased);
        } else {
            emit AllocationCleared(beneficiary, address(0), 0);
        }
    }

    // ====================== Staking Rewards Vault (SRV) =======================

    /**
     * @notice One-time initialization of the dedicated Staking Rewards Vault.
     * @param percentBps basis points in [1500 .. 2000] of total supply to dedicate.
     * @param funder     address supplying the tokens (must approve this contract, OR be the caller per rule below).
     *
     * Effect:
     * - Pulls the computed amount from `funder` into this contract.
     * - Sets immutable `stakingVaultCap` and `stakingVaultBalance` to that amount.
     *
     * Security policy:
     * - To avoid arbitrary-pull risk, require `funder == msg.sender`.
     *   This implies the caller actually holds the tokens or a hot treasury and is intentionally moving them.
     */
    function initStakingRewardsVault(uint16 percentBps, address funder)
        external
        onlyRole(VESTING_ADMIN_ROLE)
        nonReentrant
    {
        require(!stakingVaultInitialized, "SRV already initialized");
        require(percentBps >= MIN_STAKING_VAULT_BPS && percentBps <= MAX_STAKING_VAULT_BPS, "BPS out of range");
        require(funder != address(0), "Funder=0");
        require(funder == msg.sender, "Funder must be caller");

        uint256 cap = (sft.totalSupply() * percentBps) / 10_000;
        require(cap > 0, "Cap=0");

        // Pull tokens into this contract to lock them for staking rewards only
        IERC20(address(sft)).safeTransferFrom(msg.sender, address(this), cap);

        stakingVaultInitialized = true;
        stakingVaultCap = cap;
        stakingVaultBalance = cap;

        emit StakingVaultInitialized(cap, percentBps, funder);
    }

    /**
     * @notice Push funds from SRV to the staking contract's balance.
     * @dev Use with staking's `notifyRewardReceived(amount)` in the same governance proposal.
     */
    function fundStaking(address staking, uint256 amount)
        external
        onlyRole(VESTING_ADMIN_ROLE)
        nonReentrant
    {
        require(stakingVaultInitialized, "SRV not initialized");
        require(staking != address(0), "Staking=0");
        require(amount > 0, "Amount=0");
        require(amount <= stakingVaultBalance, "Exceeds SRV");

        stakingVaultBalance -= amount;
        IERC20(address(sft)).safeTransfer(staking, amount);

        emit StakingVaultFunded(staking, amount, msg.sender);
    }

    /// @notice View current SRV status.
    function stakingVaultInfo() external view returns (bool inited, uint256 cap, uint256 balance) {
        return (stakingVaultInitialized, stakingVaultCap, stakingVaultBalance);
    }

    // =========================== Recovery & Admin =============================

    /// @notice Recover unrelated ERC20 tokens (not SFT) sent to this contract by mistake.
    /// @dev Restricted to DEFAULT_ADMIN_ROLE (timelock in production).
    function recoverERC20(address token, uint256 amount, address to)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        require(token != address(sft), "Use recoverExcessSFT");
        require(to != address(0), "Zero receiver");
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Recover SFT that is *not* reserved by vesting or SRV.
    /// @dev `excess = balanceOf(this) - totalEscrowed - stakingVaultBalance`. Only excess may be recovered.
    function recoverExcessSFT(uint256 amount, address to)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        require(to != address(0), "Zero receiver");
        uint256 bal = IERC20(address(sft)).balanceOf(address(this));
        uint256 excess = bal - totalEscrowed - stakingVaultBalance;
        require(amount <= excess, "Amount exceeds excess");
        IERC20(address(sft)).safeTransfer(to, amount);
    }
}
