// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CCIDRegistry} from "../src/CCIDRegistry.sol";
import {PolicyManager} from "../src/PolicyManager.sol";
import {FiatDepositOracle} from "../src/FiatDepositOracle.sol";
import {StablecoinBOB} from "../src/StablecoinBOB.sol";
import {MinterContract} from "../src/MinterContract.sol";
import {RedeemContract} from "../src/RedeemContract.sol";
import {ICCIDRegistry} from "../src/interfaces/IACEInterfaces.sol";

contract BaseTest is Test {
    CCIDRegistry registry;
    PolicyManager policy;
    FiatDepositOracle oracle;
    StablecoinBOB token;
    MinterContract minter;
    RedeemContract redeemer;

    address admin = makeAddr("admin");
    address registrar = makeAddr("registrar");
    address oracleRole = makeAddr("oracle");
    address user1 = makeAddr("user1");
    address user2 = makeAddr("user2");
    address company = makeAddr("company");

    function setUp() public virtual {
        vm.startPrank(admin);

        registry = new CCIDRegistry(admin);
        policy = new PolicyManager(admin, address(registry));
        oracle = new FiatDepositOracle(admin);
        token = new StablecoinBOB(admin, address(policy));
        minter = new MinterContract(admin, address(oracle), address(token), address(registry));
        redeemer = new RedeemContract(admin, address(token), address(registry), address(policy));

        // Grant roles
        registry.grantRole(registry.REGISTRAR_ROLE(), registrar);
        oracle.grantRole(oracle.ORACLE_ROLE(), oracleRole);
        oracle.grantRole(oracle.MINTER_CONTRACT_ROLE(), address(minter));
        token.grantRole(token.MINTER_ROLE(), address(minter));
        minter.grantRole(minter.ORACLE_ROLE(), oracleRole);
        redeemer.grantRole(redeemer.ORACLE_ROLE(), oracleRole);

        // Token contract needs OPERATOR_ROLE on PolicyManager to call recordTransfer
        policy.grantRole(policy.OPERATOR_ROLE(), address(token));

        vm.stopPrank();

        // Register identities
        vm.startPrank(registrar);
        registry.registerIdentity(user1, ICCIDRegistry.KYCTier.KYC1, keccak256("CI-user1"));
        registry.registerIdentity(user2, ICCIDRegistry.KYCTier.KYC2, keccak256("CI-user2"));
        registry.registerIdentity(company, ICCIDRegistry.KYCTier.KYC3, keccak256("NIT-company"));
        vm.stopPrank();

        // Set reserves
        vm.prank(oracleRole);
        oracle.updateReserves(10_000_000 * 1e18);
    }

    // Helper: confirm deposit and mint tokens to a user
    function _mintTokensTo(address user, uint256 amount) internal {
        bytes32 txId = keccak256(abi.encodePacked(user, amount, block.timestamp));
        vm.prank(oracleRole);
        oracle.confirmDeposit(txId, user, amount);
        vm.prank(oracleRole);
        minter.mint(txId);
    }
}
