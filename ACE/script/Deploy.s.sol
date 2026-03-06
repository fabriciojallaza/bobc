// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CCIDRegistry} from "../src/CCIDRegistry.sol";
import {PolicyManager} from "../src/PolicyManager.sol";
import {FiatDepositOracle} from "../src/FiatDepositOracle.sol";
import {StablecoinBOB} from "../src/StablecoinBOB.sol";
import {MinterContract} from "../src/MinterContract.sol";
import {RedeemContract} from "../src/RedeemContract.sol";

contract Deploy is Script {
    function run() external {
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address bankAgent = vm.envAddress("BANK_AGENT_ADDRESS");
        address creOracle = vm.envAddress("CRE_ORACLE_ADDRESS");

        vm.startBroadcast();

        // 1. Deploy CCIDRegistry
        CCIDRegistry ccidRegistry = new CCIDRegistry(admin);
        console.log("CCIDRegistry:", address(ccidRegistry));

        // 2. Deploy PolicyManager
        PolicyManager policyManager = new PolicyManager(admin, address(ccidRegistry));
        console.log("PolicyManager:", address(policyManager));

        // 3. Deploy FiatDepositOracle
        FiatDepositOracle oracle = new FiatDepositOracle(admin);
        console.log("FiatDepositOracle:", address(oracle));

        // 4. Deploy StablecoinBOB
        StablecoinBOB token = new StablecoinBOB(admin, address(policyManager));
        console.log("StablecoinBOB:", address(token));

        // 5. Deploy MinterContract
        MinterContract minter = new MinterContract(admin, address(oracle), address(token), address(ccidRegistry));
        console.log("MinterContract:", address(minter));

        // 6. Deploy RedeemContract
        RedeemContract redeemer = new RedeemContract(admin, address(token), address(ccidRegistry), address(policyManager));
        console.log("RedeemContract:", address(redeemer));

        // --- Role configuration ---

        // CCIDRegistry: grant REGISTRAR_ROLE to bank agent
        ccidRegistry.grantRole(ccidRegistry.REGISTRAR_ROLE(), bankAgent);
        console.log("Granted REGISTRAR_ROLE to bank agent");

        // FiatDepositOracle: grant ORACLE_ROLE to CRE oracle
        oracle.grantRole(oracle.ORACLE_ROLE(), creOracle);
        console.log("Granted ORACLE_ROLE to CRE oracle");

        // FiatDepositOracle: grant MINTER_CONTRACT_ROLE to minter
        oracle.grantRole(oracle.MINTER_CONTRACT_ROLE(), address(minter));
        console.log("Granted MINTER_CONTRACT_ROLE to minter");

        // StablecoinBOB: grant MINTER_ROLE to minter
        token.grantRole(token.MINTER_ROLE(), address(minter));
        console.log("Granted MINTER_ROLE to minter");

        // StablecoinBOB: grant MINTER_ROLE to redeemer (for forceRedeem -> burnByMinter)
        token.grantRole(token.MINTER_ROLE(), address(redeemer));
        console.log("Granted MINTER_ROLE to redeemer");

        // PolicyManager: grant OPERATOR_ROLE to token
        policyManager.grantRole(policyManager.OPERATOR_ROLE(), address(token));
        console.log("Granted OPERATOR_ROLE to token");

        // PolicyManager: grant OPERATOR_ROLE to bank agent
        policyManager.grantRole(policyManager.OPERATOR_ROLE(), bankAgent);
        console.log("Granted OPERATOR_ROLE to bank agent");

        // RedeemContract: grant ORACLE_ROLE to CRE oracle
        redeemer.grantRole(redeemer.ORACLE_ROLE(), creOracle);
        console.log("Granted ORACLE_ROLE to CRE oracle on redeemer");

        vm.stopBroadcast();

        console.log("--- Deployment Summary ---");
        console.log("Admin:", admin);
        console.log("Bank Agent:", bankAgent);
        console.log("CRE Oracle:", creOracle);
        console.log("CCIDRegistry:", address(ccidRegistry));
        console.log("PolicyManager:", address(policyManager));
        console.log("FiatDepositOracle:", address(oracle));
        console.log("StablecoinBOB:", address(token));
        console.log("MinterContract:", address(minter));
        console.log("RedeemContract:", address(redeemer));
    }
}
