// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IFiatDepositOracle} from "./interfaces/IACEInterfaces.sol";

/// @title FiatDepositOracle - Fiat Deposit Confirmation Oracle
/// @notice Manages fiat deposit confirmations from the CRE and tracks reserves
contract FiatDepositOracle is IFiatDepositOracle, AccessControl {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant MINTER_CONTRACT_ROLE = keccak256("MINTER_CONTRACT_ROLE");

    error TxAlreadyUsed();
    error DepositExpired();
    error InvalidAmount();
    error DepositNotFound();

    event DepositConfirmed(bytes32 indexed txId, address indexed user, uint256 amount);
    event ReservesUpdated(uint256 totalReserves, uint256 timestamp);

    mapping(bytes32 => DepositConfirmation) private _deposits;
    mapping(bytes32 => bool) public usedTxIds;

    uint256 public totalReserves;
    uint256 public lastReservesUpdate;

    uint256 private constant DEPOSIT_VALIDITY = 24 hours;
    uint256 private constant RESERVES_STALENESS = 24 hours;

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @inheritdoc IFiatDepositOracle
    function getDeposit(bytes32 txId) external view returns (DepositConfirmation memory) {
        return _deposits[txId];
    }

    /// @inheritdoc IFiatDepositOracle
    function confirmDeposit(
        bytes32 txId,
        address user,
        uint256 amount
    ) external onlyRole(ORACLE_ROLE) {
        if (amount == 0) revert InvalidAmount();
        if (usedTxIds[txId]) revert TxAlreadyUsed();

        _deposits[txId] = DepositConfirmation({
            txId: txId,
            user: user,
            amount: amount,
            confirmedAt: block.timestamp,
            used: false
        });

        emit DepositConfirmed(txId, user, amount);
    }

    /// @inheritdoc IFiatDepositOracle
    function getTotalReserves() external view returns (uint256) {
        return totalReserves;
    }

    /// @inheritdoc IFiatDepositOracle
    function updateReserves(uint256 _totalReserves) external onlyRole(ORACLE_ROLE) {
        totalReserves = _totalReserves;
        lastReservesUpdate = block.timestamp;
        emit ReservesUpdated(_totalReserves, block.timestamp);
    }

    /// @inheritdoc IFiatDepositOracle
    function isReservesStale() external view returns (bool) {
        return block.timestamp > lastReservesUpdate + RESERVES_STALENESS;
    }

    /// @inheritdoc IFiatDepositOracle
    function markUsed(bytes32 txId) external onlyRole(MINTER_CONTRACT_ROLE) {
        DepositConfirmation storage deposit = _deposits[txId];
        if (deposit.confirmedAt == 0) revert DepositNotFound();
        if (deposit.used) revert TxAlreadyUsed();
        deposit.used = true;
        usedTxIds[txId] = true;
    }
}
