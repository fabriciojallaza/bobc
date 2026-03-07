// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./BaseTest.sol";
import {RedeemContract} from "../src/RedeemContract.sol";
import {PolicyManager} from "../src/PolicyManager.sol";
import {ICCIDRegistry} from "../src/interfaces/IACEInterfaces.sol";

contract RedeemContractTest is BaseTest {
    function setUp() public override {
        super.setUp();
        // Link bank accounts
        vm.startPrank(admin);
        redeemer.linkBankAccount(user1, "BANK-USER1-001");
        redeemer.linkBankAccount(user2, "BANK-USER2-001");
        redeemer.linkBankAccount(company, "BANK-COMPANY-001");
        vm.stopPrank();
    }

    function testRedeemBurnsTokens() public {
        _mintTokensTo(user1, 1000 * 1e18);
        uint256 balBefore = token.balanceOf(user1);

        vm.startPrank(user1);
        token.approve(address(redeemer), 500 * 1e18);
        redeemer.redeem(500 * 1e18);
        vm.stopPrank();

        assertEq(token.balanceOf(user1), balBefore - 500 * 1e18);
    }

    function testRedeemEmitsEvent() public {
        _mintTokensTo(user1, 1000 * 1e18);

        vm.startPrank(user1);
        token.approve(address(redeemer), 500 * 1e18);
        // We check that RedeemRequested is emitted (topic1 = redeemId unknown, topic2 = user1)
        vm.expectEmit(false, true, false, false);
        emit RedeemContract.RedeemRequested(bytes32(0), user1, 500 * 1e18, "BANK-USER1-001");
        redeemer.redeem(500 * 1e18);
        vm.stopPrank();
    }

    function testCannotRedeemBelowMinimum() public {
        _mintTokensTo(user1, 1000 * 1e18);
        vm.startPrank(user1);
        token.approve(address(redeemer), 99 * 1e18);
        vm.expectRevert(RedeemContract.BelowMinimum.selector);
        redeemer.redeem(99 * 1e18);
        vm.stopPrank();
    }

    function testCannotRedeemWithoutBankAccount() public {
        address user3 = makeAddr("user3");
        vm.prank(registrar);
        registry.registerIdentity(user3, ICCIDRegistry.KYCTier.KYC1, keccak256("CI-user3"));
        _mintTokensTo(user3, 1000 * 1e18);

        vm.startPrank(user3);
        token.approve(address(redeemer), 500 * 1e18);
        vm.expectRevert(RedeemContract.NoBankAccount.selector);
        redeemer.redeem(500 * 1e18);
        vm.stopPrank();
    }

    function testCannotRedeemWithoutCCID() public {
        address noKyc = makeAddr("noKyc");
        vm.prank(noKyc);
        vm.expectRevert(RedeemContract.InvalidCCID.selector);
        redeemer.redeem(100 * 1e18);
    }

    function testUIFReportOnLargeRedeem() public {
        // company is KYC3, can handle 34500+ amounts
        _mintTokensTo(company, 35000 * 1e18);

        vm.startPrank(company);
        token.approve(address(redeemer), 34500 * 1e18);
        vm.expectEmit(false, true, false, true);
        emit RedeemContract.UIFRedeemReport(bytes32(0), company, 34500 * 1e18);
        redeemer.redeem(34500 * 1e18);
        vm.stopPrank();
    }

    function testConfirmRedeemExecuted() public {
        bytes32 redeemId = keccak256("redeem-1");

        vm.prank(oracleRole);
        redeemer.confirmRedeemExecuted(redeemId);

        assertTrue(redeemer.processedRedeems(redeemId));
    }

    function testConfirmRedeemExecutedOnlyOracle() public {
        bytes32 redeemId = keccak256("redeem-2");
        vm.prank(user1);
        vm.expectRevert();
        redeemer.confirmRedeemExecuted(redeemId);
    }

    function testCannotDoubleConfirmRedeem() public {
        bytes32 redeemId = keccak256("redeem-3");
        vm.prank(oracleRole);
        redeemer.confirmRedeemExecuted(redeemId);

        vm.prank(oracleRole);
        vm.expectRevert(RedeemContract.RedeemAlreadyProcessed.selector);
        redeemer.confirmRedeemExecuted(redeemId);
    }
}
