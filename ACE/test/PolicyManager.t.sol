// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./BaseTest.sol";
import {PolicyManager} from "../src/PolicyManager.sol";
import {ICCIDRegistry} from "../src/interfaces/IACEInterfaces.sol";

contract PolicyManagerTest is BaseTest {
    // KYC1 limit = 5000 BOB
    function testTransferWithinKYC1Limit() public {
        // Mint 2000: dailyVolume[user1]=2000. Transfer 2000: 2000+2000=4000 <= 5000 limit.
        _mintTokensTo(user1, 2000 * 1e18);
        vm.prank(user1);
        token.transfer(user2, 2000 * 1e18);
        assertEq(token.balanceOf(user2), 2000 * 1e18);
    }

    function testTransferExceedsKYC1Limit() public {
        // Mint exactly 5000 (within limit for mint check)
        _mintTokensTo(user1, 5000 * 1e18);
        // Now try to transfer 5001 -- but user1 only has 5000, so we need to mint more
        // Actually the daily volume from the mint counts too. Let's mint a small amount first, then transfer.
        // user1 is KYC1 with 5000 limit. Minting 5000 already uses 5000 daily volume on checkMint.
        // Wait: checkMint checks dailyVolume[to] but recordTransfer is only called for transfers not mints.
        // Actually _update for mints only calls checkMint, not recordTransfer. So daily volume not tracked for mints.
        // Transfer of 5001 should fail because dailyVolume[user1] + 5001 > 5000 on checkTransfer.
        // But we need user1 to have 5001 tokens. Mint 5001 (checkMint doesn't record volume).
        // Wait: _update for mint calls checkMint which checks dailyVolume[to][day]+amount vs limit.
        // But dailyVolume is only updated by recordTransfer (OPERATOR_ROLE). Mints don't call recordTransfer.
        // So minting 5001 should work for checkMint since dailyVolume[user1] == 0.
        // Actually wait, checkMint checks dailyVolume[to][day] + amount > limit => 0 + 5001 > 5000 => revert.
        // So we can't even mint 5001 to user1 in one shot. We need to do it across days or use a different approach.

        // Let's just test the transfer limit directly: mint 4999 on one day, warp a day, mint 5001, try transfer
        vm.warp(block.timestamp + 1 days);
        // Need fresh reserves update since it may go stale
        vm.prank(oracleRole);
        oracle.updateReserves(10_000_000 * 1e18);
        _mintTokensTo(user1, 5000 * 1e18);
        // user1 now has 10000 tokens total (5000 from setUp-era mint + 5000 new)
        // dailyVolume for today = 0 (mints don't record). Try transfer 5001
        vm.prank(user1);
        vm.expectRevert(PolicyManager.DailyLimitExceeded.selector);
        token.transfer(user2, 5001 * 1e18);
    }

    function testTransferWithinKYC2Limit() public {
        // user2 is KYC2, limit = 34000. Mint 15000: dailyVolume=15000. Transfer 15000: 15000+15000=30000 <= 34000.
        _mintTokensTo(user2, 15000 * 1e18);
        vm.prank(user2);
        token.transfer(user1, 15000 * 1e18);
        assertEq(token.balanceOf(user1), 15000 * 1e18);
    }

    function testTransferExceedsKYC2Limit() public {
        // KYC2 limit = 34000. Can't mint 34001 in one shot (checkMint checks limit).
        // Mint 34000 today, warp, mint 1 more next day, warp back... or just mint 34000 and transfer 34001 (will fail).
        // Actually we just need the transfer to exceed the limit. Mint 34000, try transfer 34001 (user doesn't have enough).
        // Mint across 2 days to accumulate balance.
        _mintTokensTo(user2, 34000 * 1e18);
        vm.warp(block.timestamp + 1 days);
        vm.prank(oracleRole);
        oracle.updateReserves(10_000_000 * 1e18);
        _mintTokensTo(user2, 1 * 1e18);
        // user2 now has 34001 tokens, new day. Transfer 34001 exceeds daily limit.
        vm.prank(user2);
        vm.expectRevert(PolicyManager.DailyLimitExceeded.selector);
        token.transfer(user1, 34001 * 1e18);
    }

    function testTransferWithinKYC3Limit() public {
        // company is KYC3, limit = 500_000. Mint 200000: dailyVolume=200000. Transfer 200000: 200000+200000=400000 <= 500000.
        _mintTokensTo(company, 200000 * 1e18);
        vm.prank(company);
        token.transfer(user2, 200000 * 1e18);
    }

    function testTransferExceedsKYC3Limit() public {
        _mintTokensTo(company, 500000 * 1e18);
        vm.prank(company);
        vm.expectRevert(PolicyManager.DailyLimitExceeded.selector);
        token.transfer(user2, 500001 * 1e18);
    }

    function testAntiSmurfing() public {
        // user2 is KYC2 with 34000 limit. Do 5 transfers in 1 hour.
        _mintTokensTo(user2, 30000 * 1e18);
        vm.startPrank(user2);
        for (uint256 i = 0; i < 5; i++) {
            token.transfer(user1, 1 * 1e18);
        }
        // 5th transfer triggers cooldown (txCountByHour >= MAX_TX_PER_HOUR on the 5th recordTransfer)
        // The 6th should revert with CooldownActive
        vm.expectRevert(PolicyManager.CooldownActive.selector);
        token.transfer(user1, 1 * 1e18);
        vm.stopPrank();
    }

    function testCooldownExpires() public {
        _mintTokensTo(user2, 30000 * 1e18);
        vm.startPrank(user2);
        for (uint256 i = 0; i < 5; i++) {
            token.transfer(user1, 1 * 1e18);
        }
        // Cooldown active
        vm.expectRevert(PolicyManager.CooldownActive.selector);
        token.transfer(user1, 1 * 1e18);
        vm.stopPrank();

        // Warp 2 hours
        vm.warp(block.timestamp + 2 hours + 1);
        vm.prank(user2);
        token.transfer(user1, 1 * 1e18);
    }

    function testUIFReportEmitted() public {
        // UIF threshold = 34500 BOB. user2 is KYC2 with 34000 limit so can't transfer 34500.
        // company is KYC3 with 500000 limit.
        _mintTokensTo(company, 35000 * 1e18);
        vm.prank(company);
        vm.expectEmit(true, true, false, true);
        emit PolicyManager.UIFReport(company, user2, 34500 * 1e18, block.timestamp);
        token.transfer(user2, 34500 * 1e18);
    }

    function testFrozenWalletCannotTransfer() public {
        _mintTokensTo(user1, 1000 * 1e18);
        vm.prank(admin);
        policy.freezeWallet(user1);

        vm.prank(user1);
        vm.expectRevert(PolicyManager.WalletFrozen.selector);
        token.transfer(user2, 100 * 1e18);
    }

    function testSanctionedWalletCannotTransfer() public {
        _mintTokensTo(user1, 1000 * 1e18);
        vm.prank(admin);
        policy.addToSanctions(user1);

        vm.prank(user1);
        vm.expectRevert(PolicyManager.Sanctioned.selector);
        token.transfer(user2, 100 * 1e18);
    }

    function testMintAccumulatesDailyVolume() public {
        // KYC1 limit = 5000. Mint 3000: dailyVolume=3000. Transfer 2001 would push total to 5001 > 5000.
        _mintTokensTo(user1, 3000 * 1e18);
        vm.prank(user1);
        vm.expectRevert(PolicyManager.DailyLimitExceeded.selector);
        token.transfer(user2, 2001 * 1e18);
    }

    function testMultipleMintsSameDayAccumulate() public {
        // KYC2 limit = 34000. Two mints: 20000 + 15000 = 35000 > 34000, second should fail.
        _mintTokensTo(user2, 20000 * 1e18);
        // Second mint would push dailyVolume[user2] to 35000 which exceeds KYC2 limit.
        bytes32 txId = keccak256(abi.encodePacked(user2, uint256(15000 * 1e18), block.timestamp + 1));
        vm.prank(oracleRole);
        oracle.confirmDeposit(txId, user2, 15000 * 1e18);
        vm.prank(oracleRole);
        vm.expectRevert(PolicyManager.DailyLimitExceeded.selector);
        minter.mint(txId);
    }

    function testMintVolumeResetNextDay() public {
        // Mint up to limit on day 1, then mint again on day 2 (should work).
        _mintTokensTo(user1, 5000 * 1e18);
        vm.warp(block.timestamp + 1 days);
        vm.prank(oracleRole);
        oracle.updateReserves(10_000_000 * 1e18);
        // New day: dailyVolume resets. Can mint again.
        bytes32 txId = keccak256(abi.encodePacked(user1, uint256(1000 * 1e18), block.timestamp));
        vm.prank(oracleRole);
        oracle.confirmDeposit(txId, user1, 1000 * 1e18);
        vm.prank(oracleRole);
        minter.mint(txId);
        assertEq(token.balanceOf(user1), 6000 * 1e18);
    }

    function testPausedContractBlocksAllTransfers() public {
        _mintTokensTo(user1, 1000 * 1e18);
        vm.prank(admin);
        policy.setPaused(true);

        vm.prank(user1);
        vm.expectRevert(PolicyManager.Paused.selector);
        token.transfer(user2, 100 * 1e18);
    }
}
