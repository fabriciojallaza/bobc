// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICCIDRegistry, IPolicyManager} from "./interfaces/IACEInterfaces.sol";
import {StablecoinBOB} from "./StablecoinBOB.sol";

/// @title RedeemContract - BOB Stablecoin Redemption
/// @notice Burns tokens and emits events for fiat bank transfers
contract RedeemContract is AccessControl, ReentrancyGuard {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    error BelowMinimum();
    error NoBankAccount();
    error RedeemAlreadyProcessed();
    error InvalidCCID();
    error ComplianceViolation(string reason);
    error NoUpdateQueued();
    error TimelockNotElapsed();
    error InsufficientBalance();

    event RedeemRequested(
        bytes32 indexed redeemId,
        address indexed user,
        uint256 amount,
        string bankAccount
    );
    event UIFRedeemReport(bytes32 indexed redeemId, address indexed user, uint256 amount);
    event RedeemExecuted(bytes32 indexed redeemId);
    event BankAccountLinked(address indexed wallet, string accountId);
    event ForceRedeemExecuted(bytes32 indexed redeemId, address indexed wallet, uint256 amount, string bankAccount, address admin);
    event PolicyManagerUpdateQueued(address newPolicyManager, uint256 executeAfter);
    event PolicyManagerUpdated(address oldPolicyManager, address newPolicyManager);
    event CCIDRegistryUpdateQueued(address newCCIDRegistry, uint256 executeAfter);
    event CCIDRegistryUpdated(address oldCCIDRegistry, address newCCIDRegistry);

    StablecoinBOB public token;
    ICCIDRegistry public ccidRegistry;
    IPolicyManager public policyManager;

    mapping(address => string) public bankAccountByWallet;
    mapping(bytes32 => bool) public processedRedeems;

    uint256 public constant MIN_REDEEM = 100 * 1e18;
    uint256 public constant UIF_THRESHOLD = 34_500 * 1e18;

    uint256 private _nonce;

    address public pendingPolicyManager;
    uint256 public pendingPolicyManagerTime;
    address public pendingCCIDRegistry;
    uint256 public pendingCCIDRegistryTime;

    uint256 private constant TIMELOCK_DELAY = 48 hours;

    constructor(
        address admin,
        address _token,
        address _ccidRegistry,
        address _policyManager
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        token = StablecoinBOB(_token);
        ccidRegistry = ICCIDRegistry(_ccidRegistry);
        policyManager = IPolicyManager(_policyManager);
    }

    /// @notice Links a bank account to a wallet
    /// @param wallet The wallet address
    /// @param accountId The bank account identifier
    function linkBankAccount(
        address wallet,
        string calldata accountId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bankAccountByWallet[wallet] = accountId;
        emit BankAccountLinked(wallet, accountId);
    }

    /// @notice Redeems tokens by burning them and requesting a bank transfer
    /// @param amount The amount to redeem
    function redeem(uint256 amount) external nonReentrant {
        if (amount < MIN_REDEEM) revert BelowMinimum();
        if (!ccidRegistry.isValid(msg.sender)) revert InvalidCCID();
        if (bytes(bankAccountByWallet[msg.sender]).length == 0) revert NoBankAccount();

        (bool allowed, string memory reason) = policyManager.checkRedeem(msg.sender, amount);
        if (!allowed) revert ComplianceViolation(reason);

        bytes32 redeemId = keccak256(
            abi.encodePacked(msg.sender, amount, block.timestamp, _nonce++)
        );

        token.burnFrom(msg.sender, amount);

        emit RedeemRequested(redeemId, msg.sender, amount, bankAccountByWallet[msg.sender]);

        if (amount >= UIF_THRESHOLD) {
            emit UIFRedeemReport(redeemId, msg.sender, amount);
        }
    }

    /// @notice Confirms that a redemption has been executed by the bank
    /// @param redeemId The redemption ID to confirm
    function confirmRedeemExecuted(bytes32 redeemId) external onlyRole(ORACLE_ROLE) {
        if (processedRedeems[redeemId]) revert RedeemAlreadyProcessed();
        processedRedeems[redeemId] = true;
        emit RedeemExecuted(redeemId);
    }

    /// @notice Force redeems tokens from a blocked wallet (court order)
    /// @param wallet The wallet to force redeem from
    /// @param amount The amount to force redeem
    function forceRedeem(address wallet, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (token.balanceOf(wallet) < amount) revert InsufficientBalance();
        string memory bankAccount = bankAccountByWallet[wallet];
        if (bytes(bankAccount).length == 0) revert NoBankAccount();

        bytes32 redeemId = keccak256(abi.encodePacked("FORCE", wallet, amount, block.timestamp));
        token.burnByMinter(wallet, amount);

        emit ForceRedeemExecuted(redeemId, wallet, amount, bankAccount, msg.sender);
    }

    /// @notice Queues a policy manager update with timelock
    /// @param _policyManager The new policy manager address
    function updatePolicyManager(address _policyManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        pendingPolicyManager = _policyManager;
        pendingPolicyManagerTime = block.timestamp + TIMELOCK_DELAY;
        emit PolicyManagerUpdateQueued(_policyManager, pendingPolicyManagerTime);
    }

    /// @notice Executes a queued policy manager update after timelock
    function executePolicyManagerUpdate() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (pendingPolicyManager == address(0)) revert NoUpdateQueued();
        if (block.timestamp < pendingPolicyManagerTime) revert TimelockNotElapsed();

        address oldPolicyManager = address(policyManager);
        policyManager = IPolicyManager(pendingPolicyManager);
        emit PolicyManagerUpdated(oldPolicyManager, pendingPolicyManager);

        pendingPolicyManager = address(0);
        pendingPolicyManagerTime = 0;
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
