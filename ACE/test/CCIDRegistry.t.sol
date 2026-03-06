// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./BaseTest.sol";
import {ICCIDRegistry} from "../src/interfaces/IACEInterfaces.sol";
import {CCIDRegistry} from "../src/CCIDRegistry.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract CCIDRegistryTest is BaseTest {
    function testRegisterKYC1() public view {
        ICCIDRegistry.Identity memory id = registry.getIdentity(user1);
        assertEq(uint8(id.tier), uint8(ICCIDRegistry.KYCTier.KYC1));
        assertTrue(id.active);
        assertEq(id.wallet, user1);
    }

    function testRegisterKYC2() public view {
        ICCIDRegistry.Identity memory id = registry.getIdentity(user2);
        assertEq(uint8(id.tier), uint8(ICCIDRegistry.KYCTier.KYC2));
        assertTrue(id.active);
    }

    function testRegisterKYC3() public view {
        ICCIDRegistry.Identity memory id = registry.getIdentity(company);
        assertEq(uint8(id.tier), uint8(ICCIDRegistry.KYCTier.KYC3));
        assertTrue(id.active);
    }

    function testCannotRegisterDuplicate() public {
        vm.prank(registrar);
        vm.expectRevert(CCIDRegistry.IdentityAlreadyExists.selector);
        registry.registerIdentity(user1, ICCIDRegistry.KYCTier.KYC2, keccak256("CI-other"));
    }

    function testCannotRegisterSameCredential() public {
        address newWallet = makeAddr("newWallet");
        vm.prank(registrar);
        vm.expectRevert(CCIDRegistry.CredentialAlreadyUsed.selector);
        registry.registerIdentity(newWallet, ICCIDRegistry.KYCTier.KYC1, keccak256("CI-user1"));
    }

    function testExpiredCCID() public {
        assertTrue(registry.isValid(user1));
        vm.warp(block.timestamp + 366 days);
        assertFalse(registry.isValid(user1));
        assertEq(uint8(registry.getTier(user1)), uint8(ICCIDRegistry.KYCTier.NONE));
    }

    function testRevokeIdentity() public {
        assertTrue(registry.isValid(user1));
        vm.prank(admin);
        registry.revokeIdentity(user1);
        assertFalse(registry.isValid(user1));
    }

    function testOnlyAdminCanRevoke() public {
        vm.prank(user1);
        vm.expectRevert();
        registry.revokeIdentity(user1);
    }

    function testOnlyRegistrarCanRegister() public {
        address random = makeAddr("random");
        address newUser = makeAddr("newUser");
        vm.prank(random);
        vm.expectRevert();
        registry.registerIdentity(newUser, ICCIDRegistry.KYCTier.KYC1, keccak256("CI-new"));
    }

    function testCannotRegisterAddressZero() public {
        vm.prank(registrar);
        vm.expectRevert(CCIDRegistry.InvalidWallet.selector);
        registry.registerIdentity(address(0), ICCIDRegistry.KYCTier.KYC1, keccak256("CI-zero"));
    }

    function testCannotRegisterTierNone() public {
        address newUser = makeAddr("newUser");
        vm.prank(registrar);
        vm.expectRevert(CCIDRegistry.InvalidTier.selector);
        registry.registerIdentity(newUser, ICCIDRegistry.KYCTier.NONE, keccak256("CI-none"));
    }
}
