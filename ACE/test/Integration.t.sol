// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./BaseTest.sol";
import {Vm} from "forge-std/Vm.sol";
import {PolicyManager} from "../src/PolicyManager.sol";
import {MinterContract} from "../src/MinterContract.sol";
import {RedeemContract} from "../src/RedeemContract.sol";
import {ICCIDRegistry} from "../src/interfaces/IACEInterfaces.sol";

contract IntegrationTest is BaseTest {
    function setUp() public override {
        super.setUp();
        // Link bank accounts for redeem tests
        vm.startPrank(admin);
        redeemer.linkBankAccount(user1, "BANK-USER1-001");
        redeemer.linkBankAccount(user2, "BANK-USER2-001");
        redeemer.linkBankAccount(company, "BANK-COMPANY-001");
        vm.stopPrank();
    }

    function testFullMintRedeemFlow() public {
        // 1. Oracle confirms fiat deposit
        bytes32 txId = keccak256("fiat-deposit-1");
        vm.prank(oracleRole);
        oracle.confirmDeposit(txId, user2, 10_000 * 1e18);

        // 2. Oracle triggers mint
        vm.prank(oracleRole);
        minter.mint(txId);
        assertEq(token.balanceOf(user2), 10_000 * 1e18);

        // 3. user2 transfers to user1
        vm.prank(user2);
        token.transfer(user1, 2000 * 1e18);
        assertEq(token.balanceOf(user1), 2000 * 1e18);
        assertEq(token.balanceOf(user2), 8000 * 1e18);

        // 4. user1 redeems
        vm.startPrank(user1);
        token.approve(address(redeemer), 1000 * 1e18);
        redeemer.redeem(1000 * 1e18);
        vm.stopPrank();
        assertEq(token.balanceOf(user1), 1000 * 1e18);
    }

    function testKYC1UserFlow() public {
        // KYC1 user1: daily limit = 5000 BOB
        // Mint 3000: dailyVolume[user1]=3000
        _mintTokensTo(user1, 3000 * 1e18);

        // Transfer 2000: 3000+2000=5000 == limit, OK. dailyVolume=5000. user1 has 1000 left.
        vm.prank(user1);
        token.transfer(user2, 2000 * 1e18);

        // Next transfer same day exceeds limit (dailyVolume = 5000 + 1 = 5001 > 5000)
        vm.prank(user1);
        vm.expectRevert(PolicyManager.DailyLimitExceeded.selector);
        token.transfer(user2, 1 * 1e18);

        // Next day should work
        vm.warp(block.timestamp + 1 days);
        vm.prank(oracleRole);
        oracle.updateReserves(10_000_000 * 1e18);
        vm.prank(user1);
        token.transfer(user2, 1000 * 1e18);
        assertEq(token.balanceOf(user1), 0);
    }

    function testKYC3CompanyFlow() public {
        // KYC3 company: daily limit = 500,000 BOB
        _mintTokensTo(company, 400_000 * 1e18);
        assertEq(token.balanceOf(company), 400_000 * 1e18);

        // Large transfer within limit
        vm.prank(company);
        token.transfer(user2, 30_000 * 1e18);
        assertEq(token.balanceOf(user2), 30_000 * 1e18);

        // Company redeems large amount - should emit UIFRedeemReport (company is KYC3, limit 500k)
        vm.startPrank(company);
        token.approve(address(redeemer), 34_500 * 1e18);
        vm.recordLogs();
        redeemer.redeem(34_500 * 1e18);
        vm.stopPrank();

        Vm.Log[] memory entries = vm.getRecordedLogs();
        bool foundUIFReport = false;
        bytes32 uifSig = keccak256("UIFRedeemReport(bytes32,address,uint256)");
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == uifSig) {
                foundUIFReport = true;
                assertEq(entries[i].topics[2], bytes32(uint256(uint160(company))));
                break;
            }
        }
        assertTrue(foundUIFReport, "UIFRedeemReport not emitted");
    }

    function testEmergencyScenario() public {
        _mintTokensTo(user1, 2000 * 1e18);

        // Admin freezes user1
        vm.prank(admin);
        policy.freezeWallet(user1);

        // Transfer fails
        vm.prank(user1);
        vm.expectRevert(PolicyManager.WalletFrozen.selector);
        token.transfer(user2, 100 * 1e18);

        // Admin unfreezes
        vm.prank(admin);
        policy.unfreezeWallet(user1);

        // Transfer succeeds
        vm.prank(user1);
        token.transfer(user2, 100 * 1e18);
        assertEq(token.balanceOf(user2), 100 * 1e18);
    }

    function testReservesProtection() public {
        // Set reserves to just above current supply
        vm.prank(oracleRole);
        oracle.updateReserves(500 * 1e18);

        // Try to mint 1000 - should fail (reserves < supply + amount)
        bytes32 txId = keccak256("reserve-test");
        vm.prank(oracleRole);
        oracle.confirmDeposit(txId, user1, 1000 * 1e18);

        vm.prank(oracleRole);
        vm.expectRevert(MinterContract.InsufficientReserves.selector);
        minter.mint(txId);
    }
}
