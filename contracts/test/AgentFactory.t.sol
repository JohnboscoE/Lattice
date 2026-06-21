// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {AgentFactory} from "../src/AgentFactory.sol";
import {AgentToken} from "../src/AgentToken.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract AgentFactoryTest is Test {
    AgentFactory factory;
    MockUSDC usdc;

    address owner = address(0xA11CE);
    address operator1 = address(0xB0B);
    address operator2 = address(0xC0C);

    function setUp() public {
        usdc = new MockUSDC();
        factory = new AgentFactory(address(usdc), owner);
    }

    // -------------------------------------------------------------------
    // Registration
    // -------------------------------------------------------------------

    function test_registerAgentDeploysToken() public {
        (bytes32 agentId, address tokenAddr) = factory.registerAgent(
            "Scribe-7",
            "SCRB7",
            "text-summarization",
            operator1
        );

        assertTrue(agentId != bytes32(0));
        assertTrue(tokenAddr != address(0));

        AgentToken token = AgentToken(tokenAddr);
        assertEq(token.name(), "Scribe-7");
        assertEq(token.symbol(), "SCRB7");
    }

    function test_registerAgentStoresCorrectInfo() public {
        (bytes32 agentId,) = factory.registerAgent("Fetch-3", "FTCH3", "data-retrieval", operator1);

        AgentFactory.AgentInfo memory info = factory.getAgent(agentId);
        assertEq(info.operator, operator1);
        assertEq(info.name, "Fetch-3");
        assertEq(info.agentType, "data-retrieval");
        assertTrue(info.active);
    }

    function test_registerAgentIncrementsCount() public {
        assertEq(factory.agentCount(), 0);

        factory.registerAgent("Scribe-7", "SCRB7", "text-summarization", operator1);
        assertEq(factory.agentCount(), 1);

        factory.registerAgent("Fetch-3", "FTCH3", "data-retrieval", operator2);
        assertEq(factory.agentCount(), 2);
    }

    function test_registerAgentRevertsForDuplicateOperator() public {
        factory.registerAgent("Scribe-7", "SCRB7", "text-summarization", operator1);

        vm.expectRevert(AgentFactory.OperatorAlreadyRegistered.selector);
        factory.registerAgent("Scribe-8", "SCRB8", "text-summarization", operator1);
    }

    function test_eachAgentGetsDistinctToken() public {
        (, address token1) = factory.registerAgent("Scribe-7", "SCRB7", "text-summarization", operator1);
        (, address token2) = factory.registerAgent("Fetch-3", "FTCH3", "data-retrieval", operator2);

        assertTrue(token1 != token2);
    }

    // -------------------------------------------------------------------
    // Lookups
    // -------------------------------------------------------------------

    function test_requireAgentIdResolvesOperator() public {
        (bytes32 agentId,) = factory.registerAgent("Scribe-7", "SCRB7", "text-summarization", operator1);

        bytes32 resolved = factory.requireAgentId(operator1);
        assertEq(resolved, agentId);
    }

    function test_requireAgentIdRevertsForUnregisteredOperator() public {
        vm.expectRevert(AgentFactory.NotAgentOperator.selector);
        factory.requireAgentId(operator1);
    }

    function test_getAgentRevertsForUnknownId() public {
        vm.expectRevert(AgentFactory.AgentNotFound.selector);
        factory.getAgent(keccak256("nonexistent"));
    }

    // -------------------------------------------------------------------
    // Activation control
    // -------------------------------------------------------------------

    function test_ownerCanDeactivateAgent() public {
        (bytes32 agentId,) = factory.registerAgent("Scribe-7", "SCRB7", "text-summarization", operator1);

        vm.prank(owner);
        factory.deactivateAgent(agentId);

        AgentFactory.AgentInfo memory info = factory.getAgent(agentId);
        assertFalse(info.active);
    }

    function test_ownerCanReactivateAgent() public {
        (bytes32 agentId,) = factory.registerAgent("Scribe-7", "SCRB7", "text-summarization", operator1);

        vm.prank(owner);
        factory.deactivateAgent(agentId);

        vm.prank(owner);
        factory.reactivateAgent(agentId);

        AgentFactory.AgentInfo memory info = factory.getAgent(agentId);
        assertTrue(info.active);
    }

    function test_nonOwnerCannotDeactivateAgent() public {
        (bytes32 agentId,) = factory.registerAgent("Scribe-7", "SCRB7", "text-summarization", operator1);

        vm.prank(operator1);
        vm.expectRevert();
        factory.deactivateAgent(agentId);
    }
}
