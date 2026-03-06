// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./BaseTest.sol";
import {PolicyManager} from "../src/PolicyManager.sol";
import {ICCIDRegistry} from "../src/interfaces/IACEInterfaces.sol";

contract StablecoinBOBTest is BaseTest {
    function testTransferBetweenValidWallets() public {
        _mintTokensTo(user1, 1000 * 1e18);
        vm.prank(user1);
        token.transfer(user2, 500 * 1e18);
        assertEq(token.balanceOf(user2), 500 * 1e18);
        assertEq(token.balanceOf(user1), 500 * 1e18);
    }

    function testTransferFromWalletWithoutCCID() public {
        address noKyc = makeAddr("noKyc");
        // Give noKyc tokens by minting directly (admin has no MINTER_ROLE, use workaround)
        // We'll mint to user1 then have user1 transfer, but noKyc has no CCID so that fails too.
        // Instead, grant minter role to admin temporarily, mint to noKyc bypassing policy (mint checks CCID).
        // Actually _update for mint calls checkMint which checks isValid. So we can't mint to noKyc.
        // We can test that even trying to transfer FROM noKyc reverts.
        // The simplest test: noKyc tries to transfer 0 tokens (they have none), but the CCID check happens first.
        // Actually with 0 balance ERC20 transfer would succeed (0 transfer) unless the policy reverts first.
        // Let's just verify the revert.
        vm.prank(noKyc);
        vm.expectRevert(PolicyManager.InvalidCCID.selector);
        token.transfer(user1, 1);
    }

    function testTransferToWalletWithoutCCID() public {
        address noKyc = makeAddr("noKyc");
        _mintTokensTo(user1, 1000 * 1e18);
        vm.prank(user1);
        vm.expectRevert(PolicyManager.InvalidCCID.selector);
        token.transfer(noKyc, 100 * 1e18);
    }

    function testTransferWithExpiredCCID() public {
        _mintTokensTo(user1, 1000 * 1e18);
        vm.warp(block.timestamp + 366 days);
        vm.prank(user1);
        vm.expectRevert(PolicyManager.InvalidCCID.selector);
        token.transfer(user2, 100 * 1e18);
    }

    function testFreezeWalletBlocksTransfer() public {
        _mintTokensTo(user1, 1000 * 1e18);
        vm.prank(admin);
        policy.freezeWallet(user1);
        vm.prank(user1);
        vm.expectRevert(PolicyManager.WalletFrozen.selector);
        token.transfer(user2, 100 * 1e18);
    }

    function testPauseBlocksTransfer() public {
        _mintTokensTo(user1, 1000 * 1e18);
        // StablecoinBOB has its own pause via Pausable
        vm.prank(admin);
        token.pause();
        vm.prank(user1);
        vm.expectRevert(); // EnforcedPause from OZ Pausable
        token.transfer(user2, 100 * 1e18);
    }

    function testMinterRoleCanMint() public {
        _mintTokensTo(user1, 1000 * 1e18);
        assertEq(token.balanceOf(user1), 1000 * 1e18);
    }

    function testNonMinterCannotMint() public {
        vm.prank(user1);
        vm.expectRevert();
        token.mint(user1, 1000 * 1e18);
    }
}
