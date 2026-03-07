// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CCIDRegistry} from "../src/CCIDRegistry.sol";
import {PolicyManager} from "../src/PolicyManager.sol";
import {StablecoinBOB} from "../src/StablecoinBOB.sol";

/// @title DeployFullSystem
/// @notice Deploys CCIDRegistry, PolicyManager, and StablecoinBOB.
/// The CRE team deploys BatchPoRApprovalMinter separately and calls setMinter().
///
/// Required env vars:
///   ADMIN_ADDRESS  - receives all admin/registrar roles
///   PRIVATE_KEY    - deployer key
///
/// Usage (Base Sepolia):
///   forge script script/DeployFullSystem.s.sol \
///     --rpc-url https://sepolia.base.org --broadcast --verify \
///     --etherscan-api-key $BASESCAN_API_KEY
contract DeployFullSystem is Script {
    function run() external {
        address admin = vm.envAddress("ADMIN_ADDRESS");

        vm.startBroadcast();

        // 1. CCIDRegistry
        CCIDRegistry ccidRegistry = new CCIDRegistry(admin);
        console.log("CCIDRegistry:  ", address(ccidRegistry));

        // 2. PolicyManager
        PolicyManager policyManager = new PolicyManager(admin, address(ccidRegistry));
        console.log("PolicyManager: ", address(policyManager));

        // 3. StablecoinBOB
        StablecoinBOB stablecoinBOB = new StablecoinBOB(admin, address(policyManager));
        console.log("StablecoinBOB: ", address(stablecoinBOB));

        // 4. Grant OPERATOR_ROLE on PolicyManager to StablecoinBOB
        //    Needed so _update hook can call recordMint/recordTransfer
        policyManager.grantRole(policyManager.OPERATOR_ROLE(), address(stablecoinBOB));
        console.log("Granted OPERATOR_ROLE to StablecoinBOB on PolicyManager");

        // 5. Grant REGISTRAR_ROLE on CCIDRegistry to admin (agent wallet)
        ccidRegistry.grantRole(ccidRegistry.REGISTRAR_ROLE(), admin);
        console.log("Granted REGISTRAR_ROLE to admin on CCIDRegistry");

        vm.stopBroadcast();

        console.log("--- Deploy Summary ---");
        console.log("Admin:         ", admin);
        console.log("CCIDRegistry:  ", address(ccidRegistry));
        console.log("PolicyManager: ", address(policyManager));
        console.log("StablecoinBOB: ", address(stablecoinBOB));
        console.log("NOTE: CRE team deploys BatchPoRApprovalMinter, then call setMinter()");
    }
}
