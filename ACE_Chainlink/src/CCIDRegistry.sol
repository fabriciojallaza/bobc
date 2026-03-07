// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ICCIDRegistry} from "./interfaces/IACEInterfaces.sol";

/// @title CCIDRegistry - Cross-Chain Identity Registry
/// @notice Manages KYC identities linking wallets to verified credentials
contract CCIDRegistry is ICCIDRegistry, AccessControl {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    error IdentityAlreadyExists();
    error IdentityNotFound();
    error IdentityExpired();
    error CredentialAlreadyUsed();
    error InvalidWallet();
    error InvalidTier();

    event IdentityRegistered(address indexed wallet, KYCTier tier, uint256 expiresAt);
    event IdentityRevoked(address indexed wallet);

    /// @dev wallet => Identity
    mapping(address => Identity) private _identities;

    /// @dev credentialHash => wallet (tracks active credential assignments)
    mapping(bytes32 => address) private _credentialToWallet;

    uint256 public constant IDENTITY_DURATION = 365 days;

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @inheritdoc ICCIDRegistry
    function getIdentity(address wallet) external view returns (Identity memory) {
        return _identities[wallet];
    }

    /// @inheritdoc ICCIDRegistry
    function isValid(address wallet) external view returns (bool) {
        Identity storage id = _identities[wallet];
        return id.active && id.expiresAt > block.timestamp;
    }

    /// @inheritdoc ICCIDRegistry
    function getTier(address wallet) external view returns (KYCTier) {
        Identity storage id = _identities[wallet];
        if (!id.active || id.expiresAt <= block.timestamp) {
            return KYCTier.NONE;
        }
        return id.tier;
    }

    /// @inheritdoc ICCIDRegistry
    function registerIdentity(
        address wallet,
        KYCTier tier,
        bytes32 credentialHash
    ) external onlyRole(REGISTRAR_ROLE) {
        if (wallet == address(0)) revert InvalidWallet();
        if (tier == KYCTier.NONE) revert InvalidTier();

        Identity storage existing = _identities[wallet];
        if (existing.active) revert IdentityAlreadyExists();

        address existingWallet = _credentialToWallet[credentialHash];
        if (existingWallet != address(0) && _identities[existingWallet].active) {
            revert CredentialAlreadyUsed();
        }

        uint256 expiresAt = block.timestamp + IDENTITY_DURATION;

        _identities[wallet] = Identity({
            wallet: wallet,
            tier: tier,
            expiresAt: expiresAt,
            active: true,
            credentialHash: credentialHash
        });

        _credentialToWallet[credentialHash] = wallet;

        emit IdentityRegistered(wallet, tier, expiresAt);
    }

    /// @inheritdoc ICCIDRegistry
    function revokeIdentity(address wallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Identity storage id = _identities[wallet];
        if (!id.active) revert IdentityNotFound();

        id.active = false;

        emit IdentityRevoked(wallet);
    }
}
