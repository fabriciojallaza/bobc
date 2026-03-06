// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFiatDepositOracle, ICCIDRegistry} from "./interfaces/IACEInterfaces.sol";
import {StablecoinBOB} from "./StablecoinBOB.sol";

/// @title MinterContract - BOB Stablecoin Minter
/// @notice Mints tokens after verifying fiat deposit confirmations from the oracle
contract MinterContract is AccessControl, ReentrancyGuard {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    error DepositAlreadyMinted();
    error DepositExpired();
    error InsufficientReserves();
    error ReservesStale();
    error MintLimitExceeded();
    error InvalidDeposit();
    error InvalidCCID();
    error BankLicenseIsRevoked();
    error NoUpdateQueued();
    error TimelockNotElapsed();

    event Minted(bytes32 indexed txId, address indexed user, uint256 amount);
    event BankLicenseRevoked(uint256 timestamp);
    event BankLicenseRestored(uint256 timestamp);
    event OracleUpdateQueued(address newOracle, uint256 executeAfter);
    event OracleUpdated(address oldOracle, address newOracle);
    event CCIDRegistryUpdateQueued(address newCCIDRegistry, uint256 executeAfter);
    event CCIDRegistryUpdated(address oldCCIDRegistry, address newCCIDRegistry);

    IFiatDepositOracle public oracle;
    StablecoinBOB public token;
    ICCIDRegistry public ccidRegistry;

    uint256 public constant MAX_SINGLE_MINT = 500_000 * 1e18;
    uint256 private constant DEPOSIT_VALIDITY = 24 hours;

    bool public bankLicenseRevoked;

    address public pendingOracle;
    uint256 public pendingOracleTime;
    address public pendingCCIDRegistry;
    uint256 public pendingCCIDRegistryTime;

    uint256 private constant TIMELOCK_DELAY = 48 hours;

    constructor(
        address admin,
        address _oracle,
        address _token,
        address _ccidRegistry
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        oracle = IFiatDepositOracle(_oracle);
        token = StablecoinBOB(_token);
        ccidRegistry = ICCIDRegistry(_ccidRegistry);
    }

    /// @notice Mints tokens based on a confirmed fiat deposit
    /// @param txId The unique transaction ID of the confirmed deposit
    function mint(bytes32 txId) external onlyRole(ORACLE_ROLE) nonReentrant {
        if (bankLicenseRevoked) revert BankLicenseIsRevoked();

        IFiatDepositOracle.DepositConfirmation memory deposit = oracle.getDeposit(txId);

        if (deposit.confirmedAt == 0) revert InvalidDeposit();
        if (deposit.used) revert DepositAlreadyMinted();
        if (deposit.confirmedAt + DEPOSIT_VALIDITY < block.timestamp) revert DepositExpired();
        if (!ccidRegistry.isValid(deposit.user)) revert InvalidCCID();
        if (deposit.amount > MAX_SINGLE_MINT) revert MintLimitExceeded();
        if (oracle.isReservesStale()) revert ReservesStale();
        if (oracle.getTotalReserves() < token.totalSupply() + deposit.amount) revert InsufficientReserves();

        oracle.markUsed(txId);
        token.mint(deposit.user, deposit.amount);

        emit Minted(txId, deposit.user, deposit.amount);
    }

    /// @notice Revokes the bank license, blocking all minting
    function revokeBankLicense() external onlyRole(DEFAULT_ADMIN_ROLE) {
        bankLicenseRevoked = true;
        emit BankLicenseRevoked(block.timestamp);
    }

    /// @notice Restores the bank license, re-enabling minting
    function restoreBankLicense() external onlyRole(DEFAULT_ADMIN_ROLE) {
        bankLicenseRevoked = false;
        emit BankLicenseRestored(block.timestamp);
    }

    /// @notice Queues an oracle update with timelock
    /// @param _oracle The new oracle address
    function updateOracle(address _oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        pendingOracle = _oracle;
        pendingOracleTime = block.timestamp + TIMELOCK_DELAY;
        emit OracleUpdateQueued(_oracle, pendingOracleTime);
    }

    /// @notice Executes a queued oracle update after timelock
    function executeOracleUpdate() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (pendingOracle == address(0)) revert NoUpdateQueued();
        if (block.timestamp < pendingOracleTime) revert TimelockNotElapsed();

        address oldOracle = address(oracle);
        oracle = IFiatDepositOracle(pendingOracle);
        emit OracleUpdated(oldOracle, pendingOracle);

        pendingOracle = address(0);
        pendingOracleTime = 0;
    }

    /// @notice Queues a CCID registry update with timelock
    /// @param _ccidRegistry The new CCID registry address
    function updateCCIDRegistry(address _ccidRegistry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        pendingCCIDRegistry = _ccidRegistry;
        pendingCCIDRegistryTime = block.timestamp + TIMELOCK_DELAY;
        emit CCIDRegistryUpdateQueued(_ccidRegistry, pendingCCIDRegistryTime);
    }

    /// @notice Executes a queued CCID registry update after timelock
    function executeCCIDRegistryUpdate() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (pendingCCIDRegistry == address(0)) revert NoUpdateQueued();
        if (block.timestamp < pendingCCIDRegistryTime) revert TimelockNotElapsed();

        address oldCCIDRegistry = address(ccidRegistry);
        ccidRegistry = ICCIDRegistry(pendingCCIDRegistry);
        emit CCIDRegistryUpdated(oldCCIDRegistry, pendingCCIDRegistry);

        pendingCCIDRegistry = address(0);
        pendingCCIDRegistryTime = 0;
    }
}
