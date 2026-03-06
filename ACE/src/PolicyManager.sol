// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ICCIDRegistry, IPolicyManager} from "./interfaces/IACEInterfaces.sol";

/// @title PolicyManager - Compliance Policy Engine
/// @notice Enforces KYC-based transfer limits, sanctions, and anti-smurfing rules
contract PolicyManager is IPolicyManager, AccessControl {
    bytes32 public constant POLICY_ENFORCER_ROLE = keccak256("POLICY_ENFORCER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    error Paused();
    error Sanctioned();
    error WalletFrozen();
    error CooldownActive();
    error InvalidCCID();
    error DailyLimitExceeded();

    event WalletFrozenEvent(address indexed wallet);
    event WalletUnfrozen(address indexed wallet);
    event SanctionAdded(address indexed wallet);
    event SanctionRemoved(address indexed wallet);
    event UIFReport(address indexed from, address indexed to, uint256 amount, uint256 timestamp);
    event CooldownActivated(address indexed wallet, uint256 until);
    event UifThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event PausedStateChanged(bool paused);

    ICCIDRegistry public ccidRegistry;

    /// @dev wallet => day => cumulative volume
    mapping(address => mapping(uint256 => uint256)) public dailyVolume;

    /// @dev wallet => hour => transaction count
    mapping(address => mapping(uint256 => uint256)) public txCountByHour;

    mapping(address => bool) public frozenWallets;
    mapping(address => bool) public sanctionsList;
    mapping(address => uint256) public cooldownUntil;

    bool public paused;
    uint256 public uifThreshold;

    uint256 private constant KYC1_DAILY_LIMIT = 5_000 * 1e18;
    uint256 private constant KYC2_DAILY_LIMIT = 34_000 * 1e18;
    uint256 private constant KYC3_DAILY_LIMIT = 500_000 * 1e18;
    uint256 private constant COOLDOWN_DURATION = 2 hours;
    uint256 private constant MAX_TX_PER_HOUR = 5;

    constructor(address admin, address _ccidRegistry) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        ccidRegistry = ICCIDRegistry(_ccidRegistry);
        uifThreshold = 34_500 * 1e18;
    }

    /// @inheritdoc IPolicyManager
    function checkTransfer(
        address from,
        address to,
        uint256 amount
    ) external view returns (bool, string memory) {
        if (paused) revert Paused();
        if (sanctionsList[from] || sanctionsList[to]) revert Sanctioned();
        if (frozenWallets[from]) revert WalletFrozen();
        if (cooldownUntil[from] > block.timestamp) revert CooldownActive();
        if (!ccidRegistry.isValid(from) || !ccidRegistry.isValid(to)) revert InvalidCCID();

        uint256 day = block.timestamp / 1 days;
        uint256 currentVolume = dailyVolume[from][day] + amount;
        uint256 limit = _getDailyLimit(from);
        if (currentVolume > limit) revert DailyLimitExceeded();

        return (true, "");
    }

    /// @inheritdoc IPolicyManager
    function recordTransfer(
        address from,
        address to,
        uint256 amount
    ) external onlyRole(OPERATOR_ROLE) {
        uint256 day = block.timestamp / 1 days;
        dailyVolume[from][day] += amount;

        uint256 hour = block.timestamp / 1 hours;
        txCountByHour[from][hour] += 1;

        if (txCountByHour[from][hour] >= MAX_TX_PER_HOUR) {
            cooldownUntil[from] = block.timestamp + COOLDOWN_DURATION;
            emit CooldownActivated(from, cooldownUntil[from]);
        }

        if (amount >= uifThreshold) {
            emit UIFReport(from, to, amount, block.timestamp);
        }
    }

    /// @inheritdoc IPolicyManager
    function checkMint(
        address to,
        uint256 amount
    ) external view returns (bool, string memory) {
        if (paused) revert Paused();
        if (sanctionsList[to]) revert Sanctioned();
        if (!ccidRegistry.isValid(to)) revert InvalidCCID();

        uint256 day = block.timestamp / 1 days;
        uint256 currentVolume = dailyVolume[to][day] + amount;
        uint256 limit = _getDailyLimit(to);
        if (currentVolume > limit) revert DailyLimitExceeded();

        return (true, "");
    }

    /// @inheritdoc IPolicyManager
    function recordMint(
        address to,
        uint256 amount
    ) external onlyRole(OPERATOR_ROLE) {
        uint256 day = block.timestamp / 1 days;
        dailyVolume[to][day] += amount;

        if (amount >= uifThreshold) {
            emit UIFReport(address(0), to, amount, block.timestamp);
        }
    }

    /// @inheritdoc IPolicyManager
    function checkRedeem(
        address from,
        uint256 amount
    ) external view returns (bool, string memory) {
        if (paused) revert Paused();
        if (sanctionsList[from]) revert Sanctioned();
        if (frozenWallets[from]) revert WalletFrozen();
        if (!ccidRegistry.isValid(from)) revert InvalidCCID();

        uint256 day = block.timestamp / 1 days;
        uint256 currentVolume = dailyVolume[from][day] + amount;
        uint256 limit = _getDailyLimit(from);
        if (currentVolume > limit) revert DailyLimitExceeded();

        return (true, "");
    }

    /// @notice Freezes a wallet, preventing transfers
    /// @param wallet The wallet to freeze
    function freezeWallet(address wallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        frozenWallets[wallet] = true;
        emit WalletFrozenEvent(wallet);
    }

    /// @notice Unfreezes a wallet
    /// @param wallet The wallet to unfreeze
    function unfreezeWallet(address wallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        frozenWallets[wallet] = false;
        emit WalletUnfrozen(wallet);
    }

    /// @notice Adds a wallet to the sanctions list
    /// @param wallet The wallet to sanction
    function addToSanctions(address wallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        sanctionsList[wallet] = true;
        emit SanctionAdded(wallet);
    }

    /// @notice Removes a wallet from the sanctions list
    /// @param wallet The wallet to remove
    function removeFromSanctions(address wallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        sanctionsList[wallet] = false;
        emit SanctionRemoved(wallet);
    }

    /// @notice Sets the global pause state
    /// @param _paused Whether to pause
    function setPaused(bool _paused) external onlyRole(DEFAULT_ADMIN_ROLE) {
        paused = _paused;
        emit PausedStateChanged(_paused);
    }

    /// @notice Sets the UIF reporting threshold
    /// @param _threshold The new threshold amount
    function setUifThreshold(uint256 _threshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldThreshold = uifThreshold;
        uifThreshold = _threshold;
        emit UifThresholdUpdated(oldThreshold, _threshold);
    }

    /// @dev Returns the daily limit for a wallet based on its KYC tier
    function _getDailyLimit(address wallet) internal view returns (uint256) {
        ICCIDRegistry.KYCTier tier = ccidRegistry.getTier(wallet);
        if (tier == ICCIDRegistry.KYCTier.KYC1) return KYC1_DAILY_LIMIT;
        if (tier == ICCIDRegistry.KYCTier.KYC2) return KYC2_DAILY_LIMIT;
        if (tier == ICCIDRegistry.KYCTier.KYC3) return KYC3_DAILY_LIMIT;
        return 0;
    }
}
