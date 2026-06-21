// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {AgentFactory} from "../src/AgentFactory.sol";

/// @title RegisterDemoAgents
/// @notice Registers the two demo agents used in the Lattice live simulation
///         (Agent-A as requester operator, Scribe-7 as the provider agent).
/// @dev    Run with:
///         forge script script/RegisterDemoAgents.s.sol --rpc-url arc_testnet --broadcast
///
///         Required environment variables:
///         PRIVATE_KEY       - deployer / caller private key
///         FACTORY_ADDRESS   - deployed AgentFactory address
///         SCRIBE_OPERATOR   - wallet address that will operate Scribe-7
contract RegisterDemoAgents is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address factoryAddress = vm.envAddress("FACTORY_ADDRESS");
        address scribeOperator = vm.envAddress("SCRIBE_OPERATOR");

        AgentFactory factory = AgentFactory(factoryAddress);

        vm.startBroadcast(deployerPrivateKey);

        (bytes32 agentId, address tokenAddr) = factory.registerAgent(
            "Scribe-7",
            "SCRB7",
            "text-summarization",
            scribeOperator
        );

        vm.stopBroadcast();

        console.log("Registered agent: Scribe-7");
        console.log("Agent ID:", vm.toString(agentId));
        console.log("Token address:", tokenAddr);
        console.log("Operator:", scribeOperator);
    }
}
