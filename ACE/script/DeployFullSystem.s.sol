// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CCIDRegistry} from "../src/CCIDRegistry.sol";
import {PolicyManager} from "../src/PolicyManager.sol";
import {StablecoinBOB} from "../src/StablecoinBOB.sol";
import {BatchPoRApprovalMinter} from "../src/BatchPoRApprovalMinter.sol";

/// @title DeployFullSystem
/// @notice Deploys the ACE stablecoin system integrated with the Chainlink CRE PoR workflow.
///
/// Required environment variables:
///   ADMIN_ADDRESS        - address that receives all admin roles
///   FORWARDER_ADDRESS    - CRE forwarder (MockForwarder in dev, KeystoneForwarder in prod)
///
/// Usage (local anvil):
///   forge script script/DeployFullSystem.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
///
/// Usage (Base Sepolia):
///   forge script script/DeployFullSystem.s.sol \
///     --rpc-url base_sepolia --broadcast --verify
contract DeployFullSystem is Script {
    function run() external {
        address admin     = vm.envAddress("ADMIN_ADDRESS");
        address forwarder = vm.envAddress("FORWARDER_ADDRESS");

        vm.startBroadcast();

        // 1. Deploy CCIDRegistry
        CCIDRegistry ccidRegistry = new CCIDRegistry(admin);
        console.log("CCIDRegistry:", address(ccidRegistry));

        // 2. Deploy PolicyManager
        PolicyManager policyManager = new PolicyManager(admin, address(ccidRegistry));
        console.log("PolicyManager:", address(policyManager));

        // 3. Deploy StablecoinBOB
        StablecoinBOB stablecoinBOB = new StablecoinBOB(admin, address(policyManager));
        console.log("StablecoinBOB:", address(stablecoinBOB));

        // 4. Deploy BatchPoRApprovalMinter
        //    - forwarder: the Chainlink CRE forwarder that calls onReport()
        //    - token: StablecoinBOB (implements IMintableERC20.mint)
        //    - admin: receives ADMIN_ROLE and OPERATOR_ROLE on the minter
        //    - initialBankBalance: 0 (no pre-existing reserves)
        BatchPoRApprovalMinter batchMinter = new BatchPoRApprovalMinter(
            forwarder,
            address(stablecoinBOB),
            admin,
            0
        );
        console.log("BatchPoRApprovalMinter:", address(batchMinter));

        // 5. Grant MINTER_ROLE on StablecoinBOB to BatchPoRApprovalMinter
        //    Using setMinter() convenience wrapper (requires DEFAULT_ADMIN_ROLE, held by admin).
        //    The broadcast signer must be `admin` for this to succeed.
        stablecoinBOB.setMinter(address(batchMinter));
        console.log("Granted MINTER_ROLE to BatchPoRApprovalMinter");

        // 6. Grant OPERATOR_ROLE on PolicyManager to StablecoinBOB
        //    Required so that the _update hook can call policyManager.recordMint/recordTransfer
        policyManager.grantRole(policyManager.OPERATOR_ROLE(), address(stablecoinBOB));
        console.log("Granted OPERATOR_ROLE on PolicyManager to StablecoinBOB");

        vm.stopBroadcast();

        console.log("--- Deployment Summary ---");
        console.log("Admin:                 ", admin);
        console.log("Forwarder:             ", forwarder);
        console.log("CCIDRegistry:          ", address(ccidRegistry));
        console.log("PolicyManager:         ", address(policyManager));
        console.log("StablecoinBOB:         ", address(stablecoinBOB));
        console.log("BatchPoRApprovalMinter:", address(batchMinter));
    }
}
