// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPolicyManager} from "./interfaces/IACEInterfaces.sol";

/// @title StablecoinBOB - BOB Stablecoin
/// @notice ERC-20 stablecoin pegged to the Bolivian Peso (BOB) with compliance hooks
contract StablecoinBOB is ERC20, AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    error ComplianceViolation(string reason);
    error NotMinter();
    error NoUpdateQueued();
    error TimelockNotElapsed();

    event PolicyManagerUpdateQueued(address newPolicyManager, uint256 executeAfter);
    event PolicyManagerUpdated(address oldPolicyManager, address newPolicyManager);

    IPolicyManager public policyManager;

    address public pendingPolicyManager;
    uint256 public pendingPolicyManagerTime;

    uint256 private constant TIMELOCK_DELAY = 48 hours;

    constructor(
        address admin,
        address _policyManager
    ) ERC20("BOB Stablecoin", "BOBs") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        policyManager = IPolicyManager(_policyManager);
    }

    /// @notice Mints tokens to a recipient
    /// @param to The recipient address
    /// @param amount The amount to mint
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) nonReentrant {
        _mint(to, amount);
    }

    /// @notice Burns tokens from caller
    /// @param amount The amount to burn
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /// @notice Burns tokens from an account using allowance
    /// @param account The account to burn from
    /// @param amount The amount to burn
    function burnFrom(address account, uint256 amount) external nonReentrant {
        _spendAllowance(account, msg.sender, amount);
        _burn(account, amount);
    }

    /// @notice Burns tokens from an account, callable only by MINTER_ROLE
    /// @param from The account to burn from
    /// @param amount The amount to burn
    function burnByMinter(address from, uint256 amount) external onlyRole(MINTER_ROLE) nonReentrant {
        _burn(from, amount);
    }

    /// @notice Pauses all token transfers
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /// @notice Unpauses token transfers
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Sets the minter address (grants MINTER_ROLE). Convenience wrapper for external tooling.
    function setMinter(address m) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(MINTER_ROLE, m);
    }

    /// @notice Queues a policy manager update with timelock
    /// @param _policyManager The new policy manager address
    function updateCompliance(address _policyManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
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

    /// @dev Hook that is called during any transfer of tokens (OZ v5 _update pattern)
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override whenNotPaused {
        // For regular transfers (not mint/burn), check compliance
        if (from != address(0) && to != address(0)) {
            (bool allowed, string memory reason) = policyManager.checkTransfer(from, to, value);
            if (!allowed) revert ComplianceViolation(reason);
            policyManager.recordTransfer(from, to, value);
        }
        // For mints, check mint compliance and record volume
        else if (from == address(0) && to != address(0)) {
            (bool allowed, string memory reason) = policyManager.checkMint(to, value);
            if (!allowed) revert ComplianceViolation(reason);
            policyManager.recordMint(to, value);
        }
        // For burns, check redeem compliance and record transfer for daily limits
        else if (from != address(0) && to == address(0)) {
            (bool allowed, string memory reason) = policyManager.checkRedeem(from, value);
            if (!allowed) revert ComplianceViolation(reason);
            policyManager.recordTransfer(from, address(0), value);
        }

        super._update(from, to, value);
    }
}
