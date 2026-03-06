// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ICCIDRegistry - Cross-Chain Identity Registry Interface
/// @notice Manages KYC identities for the BOB Stablecoin ecosystem
interface ICCIDRegistry {
    enum KYCTier { NONE, KYC1, KYC2, KYC3 }

    struct Identity {
        address wallet;
        KYCTier tier;
        uint256 expiresAt;
        bool active;
        bytes32 credentialHash;
    }

    /// @notice Returns the full identity struct for a wallet
    /// @param wallet The wallet address to query
    /// @return The Identity struct
    function getIdentity(address wallet) external view returns (Identity memory);

    /// @notice Checks if a wallet has a valid, active, non-expired identity
    /// @param wallet The wallet address to check
    /// @return True if the identity is valid
    function isValid(address wallet) external view returns (bool);

    /// @notice Returns the KYC tier for a wallet
    /// @param wallet The wallet address to query
    /// @return The KYCTier enum value
    function getTier(address wallet) external view returns (KYCTier);

    /// @notice Registers a new identity for a wallet
    /// @param wallet The wallet to register
    /// @param tier The KYC tier to assign
    /// @param credentialHash Hash of the credential document (CI/NIT)
    function registerIdentity(address wallet, KYCTier tier, bytes32 credentialHash) external;

    /// @notice Revokes the identity for a wallet
    /// @param wallet The wallet to revoke
    function revokeIdentity(address wallet) external;
}

/// @title IPolicyManager - Policy Enforcement Interface
/// @notice Enforces compliance rules for transfers, mints, and redemptions
interface IPolicyManager {
    /// @notice Checks if a transfer is allowed
    /// @param from Source address
    /// @param to Destination address
    /// @param amount Transfer amount
    /// @return allowed Whether the transfer is allowed
    /// @return reason Empty string if allowed, otherwise the reason for rejection
    function checkTransfer(address from, address to, uint256 amount) external view returns (bool allowed, string memory reason);

    /// @notice Records a transfer for compliance tracking
    /// @param from Source address
    /// @param to Destination address
    /// @param amount Transfer amount
    function recordTransfer(address from, address to, uint256 amount) external;

    /// @notice Checks if a mint is allowed
    /// @param to Recipient address
    /// @param amount Mint amount
    /// @return allowed Whether the mint is allowed
    /// @return reason Empty string if allowed, otherwise the reason for rejection
    function checkMint(address to, uint256 amount) external view returns (bool allowed, string memory reason);

    /// @notice Records a mint for daily volume tracking
    /// @param to Recipient address
    /// @param amount Mint amount
    function recordMint(address to, uint256 amount) external;

    /// @notice Checks if a redemption is allowed
    /// @param from Redeemer address
    /// @param amount Redemption amount
    /// @return allowed Whether the redemption is allowed
    /// @return reason Empty string if allowed, otherwise the reason for rejection
    function checkRedeem(address from, uint256 amount) external view returns (bool allowed, string memory reason);
}

/// @title IFiatDepositOracle - Fiat Deposit Oracle Interface
/// @notice Manages fiat deposit confirmations and reserve tracking
interface IFiatDepositOracle {
    struct DepositConfirmation {
        bytes32 txId;
        address user;
        uint256 amount;
        uint256 confirmedAt;
        bool used;
    }

    /// @notice Returns the deposit confirmation for a transaction ID
    /// @param txId The transaction ID to query
    /// @return The DepositConfirmation struct
    function getDeposit(bytes32 txId) external view returns (DepositConfirmation memory);

    /// @notice Confirms a fiat deposit
    /// @param txId Unique transaction ID
    /// @param user The user who made the deposit
    /// @param amount The deposit amount
    function confirmDeposit(bytes32 txId, address user, uint256 amount) external;

    /// @notice Returns the total fiat reserves
    /// @return The total reserves amount
    function getTotalReserves() external view returns (uint256);

    /// @notice Updates the total reserves
    /// @param totalReserves The new total reserves amount
    function updateReserves(uint256 totalReserves) external;

    /// @notice Checks if reserves data is stale (> 24 hours old)
    /// @return True if reserves are stale
    function isReservesStale() external view returns (bool);

    /// @notice Marks a deposit as used
    /// @param txId The transaction ID to mark as used
    function markUsed(bytes32 txId) external;
}
