// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {AgentFactory} from "../src/AgentFactory.sol";
import {TaskEscrow} from "../src/TaskEscrow.sol";

/// @title Deploy
/// @notice Deploys AgentFactory and TaskEscrow to Arc Testnet.
/// @dev    Run with:
///         forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast --verify
///
///         Required environment variables (set in .env, loaded via foundry.toml):
///         PRIVATE_KEY     - deployer wallet private key
///         USDC_ADDRESS    - Arc Testnet USDC contract address
///         OWNER_ADDRESS   - address that will own AgentFactory and TaskEscrow
///                           (defaults to deployer if unset)
contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address usdcAddress = vm.envAddress("USDC_ADDRESS");

        address owner;
        try vm.envAddress("OWNER_ADDRESS") returns (address ownerOverride) {
            owner = ownerOverride;
        } catch {
            owner = vm.addr(deployerPrivateKey);
        }

        console.log("Deployer:", vm.addr(deployerPrivateKey));
        console.log("USDC address:", usdcAddress);
        console.log("Owner:", owner);

        vm.startBroadcast(deployerPrivateKey);

        AgentFactory factory = new AgentFactory(usdcAddress, owner);
        console.log("AgentFactory deployed at:", address(factory));

        TaskEscrow escrow = new TaskEscrow(usdcAddress, address(factory), owner);
        console.log("TaskEscrow deployed at:", address(escrow));

        vm.stopBroadcast();

        console.log("\n--- Deployment summary ---");
        console.log("AgentFactory:", address(factory));
        console.log("TaskEscrow:  ", address(escrow));
        console.log("Copy these addresses into backend/.env");
    }
}
