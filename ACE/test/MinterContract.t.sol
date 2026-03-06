// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./BaseTest.sol";
import {MinterContract} from "../src/MinterContract.sol";
import {FiatDepositOracle} from "../src/FiatDepositOracle.sol";
import {ICCIDRegistry} from "../src/interfaces/IACEInterfaces.sol";

contract MinterContractTest is BaseTest {
    function testMintOnValidDeposit() public {
        bytes32 txId = keccak256("deposit-1");
        vm.prank(oracleRole);
        oracle.confirmDeposit(txId, user1, 1000 * 1e18);

        vm.prank(oracleRole);
        minter.mint(txId);

        assertEq(token.balanceOf(user1), 1000 * 1e18);
    }

    function testCannotDoubleMint() public {
        bytes32 txId = keccak256("deposit-2");
        vm.prank(oracleRole);
        oracle.confirmDeposit(txId, user1, 1000 * 1e18);

        vm.prank(oracleRole);
        minter.mint(txId);

        vm.prank(oracleRole);
        vm.expectRevert(MinterContract.DepositAlreadyMinted.selector);
        minter.mint(txId);
    }

    function testCannotMintWithExpiredDeposit() public {
        bytes32 txId = keccak256("deposit-3");
        vm.prank(oracleRole);
        oracle.confirmDeposit(txId, user1, 1000 * 1e18);

        vm.warp(block.timestamp + 25 hours);

        // Need to refresh reserves so they're not stale
        vm.prank(oracleRole);
        oracle.updateReserves(10_000_000 * 1e18);

        vm.prank(oracleRole);
        vm.expectRevert(MinterContract.DepositExpired.selector);
        minter.mint(txId);
    }

    function testCannotMintToWalletWithoutCCID() public {
        address noKyc = makeAddr("noKyc");
        bytes32 txId = keccak256("deposit-4");
        vm.prank(oracleRole);
        oracle.confirmDeposit(txId, noKyc, 1000 * 1e18);

        vm.prank(oracleRole);
        vm.expectRevert(MinterContract.InvalidCCID.selector);
        minter.mint(txId);
    }

    function testCannotMintAboveMaxLimit() public {
        bytes32 txId = keccak256("deposit-5");
        vm.prank(oracleRole);
        oracle.confirmDeposit(txId, company, 500_001 * 1e18);

        vm.prank(oracleRole);
        vm.expectRevert(MinterContract.MintLimitExceeded.selector);
        minter.mint(txId);
    }

    function testCannotMintWithStaleReserves() public {
        // Warp past reserves staleness first
        vm.warp(block.timestamp + 24 hours + 1);

        // Then confirm deposit (so it's fresh and not expired)
        bytes32 txId = keccak256("deposit-6");
        vm.prank(oracleRole);
        oracle.confirmDeposit(txId, user1, 1000 * 1e18);

        // Reserves are stale (last update was >24h ago), but deposit is fresh
        vm.prank(oracleRole);
        vm.expectRevert(MinterContract.ReservesStale.selector);
        minter.mint(txId);
    }

    function testCannotMintWithInsufficientReserves() public {
        // Set reserves to very low
        vm.prank(oracleRole);
        oracle.updateReserves(100 * 1e18);

        bytes32 txId = keccak256("deposit-7");
        vm.prank(oracleRole);
        oracle.confirmDeposit(txId, user1, 1000 * 1e18);

        vm.prank(oracleRole);
        vm.expectRevert(MinterContract.InsufficientReserves.selector);
        minter.mint(txId);
    }
}
