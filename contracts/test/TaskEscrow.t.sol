// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {TaskEscrow} from "../src/TaskEscrow.sol";
import {AgentFactory} from "../src/AgentFactory.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract TaskEscrowTest is Test {
    TaskEscrow escrow;
    AgentFactory factory;
    MockUSDC usdc;

    address owner = address(0xA11CE);
    address requester = address(0xD00D);
    address operator = address(0xB0B);
    address rando = address(0xFEED);

    bytes32 agentId;

    function setUp() public {
        usdc = new MockUSDC();
        factory = new AgentFactory(address(usdc), owner);
        escrow = new TaskEscrow(address(usdc), address(factory), owner);

        (agentId,) = factory.registerAgent("Scribe-7", "SCRB7", "text-summarization", operator);

        usdc.mint(requester, 1_000 * 1e6);
        vm.prank(requester);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // -------------------------------------------------------------------
    // Task creation
    // -------------------------------------------------------------------

    function test_createTaskLocksFunds() public {
        uint256 amount = 2_100; // $0.0021 USDC = 2,100 micro-units (1e6 * 0.0021)

        vm.prank(requester);
        bytes32 taskId = escrow.createTask(agentId, amount);

        (address taskRequester,,, , , TaskEscrow.Status status) = escrow.tasks(taskId);
        assertEq(taskRequester, requester);
        assertEq(uint8(status), uint8(TaskEscrow.Status.Pending));
        assertEq(usdc.balanceOf(address(escrow)), amount);
    }

    function test_createTaskRevertsForZeroAmount() public {
        vm.prank(requester);
        vm.expectRevert(TaskEscrow.ZeroAmount.selector);
        escrow.createTask(agentId, 0);
    }

    function test_createTaskRevertsForInactiveAgent() public {
        vm.prank(owner);
        factory.deactivateAgent(agentId);

        vm.prank(requester);
        vm.expectRevert(TaskEscrow.AgentInactive.selector);
        escrow.createTask(agentId, 2_100);
    }

    function test_createTaskSetsCorrectDisputeDeadline() public {
        vm.prank(requester);
        bytes32 taskId = escrow.createTask(agentId, 2_100);

        (, , , uint256 createdAt, uint256 disputeDeadline,) = escrow.tasks(taskId);
        assertEq(disputeDeadline, createdAt + escrow.DISPUTE_WINDOW());
    }

    // -------------------------------------------------------------------
    // Release (happy path)
    // -------------------------------------------------------------------

    function test_releaseRevertsBeforeDisputeWindowCloses() public {
        vm.prank(requester);
        bytes32 taskId = escrow.createTask(agentId, 2_100);

        vm.expectRevert(TaskEscrow.DisputeWindowStillOpen.selector);
        escrow.release(taskId);
    }

    function test_releasePaysAgentAfterWindowCloses() public {
        vm.prank(requester);
        bytes32 taskId = escrow.createTask(agentId, 2_100);

        vm.warp(block.timestamp + escrow.DISPUTE_WINDOW() + 1);
        escrow.release(taskId);

        assertEq(usdc.balanceOf(operator), 2_100);

        (, , , , , TaskEscrow.Status status) = escrow.tasks(taskId);
        assertEq(uint8(status), uint8(TaskEscrow.Status.Released));
    }

    function test_releaseCallableByAnyone() public {
        vm.prank(requester);
        bytes32 taskId = escrow.createTask(agentId, 2_100);

        vm.warp(block.timestamp + escrow.DISPUTE_WINDOW() + 1);

        // rando, not the requester or operator, triggers release
        vm.prank(rando);
        escrow.release(taskId);

        assertEq(usdc.balanceOf(operator), 2_100);
    }

    function test_releaseRevertsIfAlreadyReleased() public {
        vm.prank(requester);
        bytes32 taskId = escrow.createTask(agentId, 2_100);

        vm.warp(block.timestamp + escrow.DISPUTE_WINDOW() + 1);
        escrow.release(taskId);

        vm.expectRevert(TaskEscrow.AlreadyResolved.selector);
        escrow.release(taskId);
    }

    function test_canReleaseReturnsFalseBeforeWindow() public {
        vm.prank(requester);
        bytes32 taskId = escrow.createTask(agentId, 2_100);
        assertFalse(escrow.canRelease(taskId));
    }

    function test_canReleaseReturnsTrueAfterWindow() public {
        vm.prank(requester);
        bytes32 taskId = escrow.createTask(agentId, 2_100);

        vm.warp(block.timestamp + escrow.DISPUTE_WINDOW() + 1);
        assertTrue(escrow.canRelease(taskId));
    }

    // -------------------------------------------------------------------
    // Dispute path
    // -------------------------------------------------------------------

    function test_requesterCanDisputeBeforeDeadline() public {
        vm.prank(requester);
        bytes32 taskId = escrow.createTask(agentId, 2_100);

        vm.prank(requester);
        escrow.dispute(taskId);

        (, , , , , TaskEscrow.Status status) = escrow.tasks(taskId);
        assertEq(uint8(status), uint8(TaskEscrow.Status.Disputed));
    }

    function test_disputeRevertsAfterDeadline() public {
        vm.prank(requester);
        bytes32 taskId = escrow.createTask(agentId, 2_100);

        vm.warp(block.timestamp + escrow.DISPUTE_WINDOW() + 1);

        vm.prank(requester);
        vm.expectRevert(TaskEscrow.DisputeWindowClosed.selector);
        escrow.dispute(taskId);
    }

    function test_disputeRevertsForNonRequester() public {
        vm.prank(requester);
        bytes32 taskId = escrow.createTask(agentId, 2_100);

        vm.prank(rando);
        vm.expectRevert(TaskEscrow.NotRequester.selector);
        escrow.dispute(taskId);
    }

    function test_disputedTaskCannotBeReleasedNormally() public {
        vm.prank(requester);
        bytes32 taskId = escrow.createTask(agentId, 2_100);

        vm.prank(requester);
        escrow.dispute(taskId);

        vm.warp(block.timestamp + escrow.DISPUTE_WINDOW() + 1);

        vm.expectRevert(TaskEscrow.AlreadyResolved.selector);
        escrow.release(taskId);
    }

    // -------------------------------------------------------------------
    // Dispute resolution (owner)
    // -------------------------------------------------------------------

    function test_ownerCanResolveDisputeWithRefund() public {
        uint256 requesterBalBefore = usdc.balanceOf(requester);

        vm.prank(requester);
        bytes32 taskId = escrow.createTask(agentId, 2_100);

        vm.prank(requester);
        escrow.dispute(taskId);

        vm.prank(owner);
        escrow.resolveDisputeRefund(taskId);

        assertEq(usdc.balanceOf(requester), requesterBalBefore);
        (, , , , , TaskEscrow.Status status) = escrow.tasks(taskId);
        assertEq(uint8(status), uint8(TaskEscrow.Status.Refunded));
    }

    function test_ownerCanResolveDisputeWithRelease() public {
        vm.prank(requester);
        bytes32 taskId = escrow.createTask(agentId, 2_100);

        vm.prank(requester);
        escrow.dispute(taskId);

        vm.prank(owner);
        escrow.resolveDisputeRelease(taskId);

        assertEq(usdc.balanceOf(operator), 2_100);
        (, , , , , TaskEscrow.Status status) = escrow.tasks(taskId);
        assertEq(uint8(status), uint8(TaskEscrow.Status.Released));
    }

    function test_nonOwnerCannotResolveDispute() public {
        vm.prank(requester);
        bytes32 taskId = escrow.createTask(agentId, 2_100);

        vm.prank(requester);
        escrow.dispute(taskId);

        vm.prank(rando);
        vm.expectRevert();
        escrow.resolveDisputeRefund(taskId);
    }

    function test_resolveRevertsIfNotDisputed() public {
        vm.prank(requester);
        bytes32 taskId = escrow.createTask(agentId, 2_100);

        vm.prank(owner);
        vm.expectRevert(TaskEscrow.AlreadyResolved.selector);
        escrow.resolveDisputeRefund(taskId);
    }
}
