// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AgentFactory} from "./AgentFactory.sol";

/// @title TaskEscrow
/// @notice Holds USDC for agent task payments. Payment auto-releases to the agent after
///         a fixed dispute window unless the requester disputes first. No oracle required —
///         the requester is the verifier, with a bounded time window to act.
contract TaskEscrow is Ownable {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Pending,    // funds locked, agent working
        Disputed,   // requester flagged before timeout — funds frozen pending owner resolution
        Released,   // funds paid to agent
        Refunded    // funds returned to requester (after dispute resolution)
    }

    struct Task {
        address requester;
        bytes32 agentId;
        uint256 amount;       // USDC, 6 decimals
        uint256 createdAt;
        uint256 disputeDeadline;
        Status status;
    }

    /// @notice Dispute window: requester must dispute within this period or payment auto-releases
    uint256 public constant DISPUTE_WINDOW = 5 minutes;

    IERC20 public immutable USDC;
    AgentFactory public immutable FACTORY;

    mapping(bytes32 => Task) public tasks;
    uint256 public taskNonce;

    event TaskCreated(bytes32 indexed taskId, address indexed requester, bytes32 indexed agentId, uint256 amount, uint256 disputeDeadline);
    event TaskDisputed(bytes32 indexed taskId);
    event TaskReleased(bytes32 indexed taskId, address indexed agentOperator, uint256 amount);
    event TaskRefunded(bytes32 indexed taskId, address indexed requester, uint256 amount);

    error TaskNotFound();
    error NotRequester();
    error AlreadyResolved();
    error DisputeWindowClosed();
    error DisputeWindowStillOpen();
    error AgentInactive();
    error ZeroAmount();

    constructor(address usdc_, address factory_, address owner_) Ownable(owner_) {
        USDC = IERC20(usdc_);
        FACTORY = AgentFactory(factory_);
    }

    /// @notice Lock USDC in escrow for a task assigned to a given agent
    /// @param agentId  The agent expected to complete the task
    /// @param amount   USDC amount to escrow (6 decimals)
    function createTask(bytes32 agentId, uint256 amount) external returns (bytes32 taskId) {
        if (amount == 0) revert ZeroAmount();

        AgentFactory.AgentInfo memory agent = FACTORY.getAgent(agentId);
        if (!agent.active) revert AgentInactive();

        taskId = keccak256(abi.encodePacked(msg.sender, agentId, amount, block.timestamp, taskNonce++));

        USDC.safeTransferFrom(msg.sender, address(this), amount);

        tasks[taskId] = Task({
            requester: msg.sender,
            agentId: agentId,
            amount: amount,
            createdAt: block.timestamp,
            disputeDeadline: block.timestamp + DISPUTE_WINDOW,
            status: Status.Pending
        });

        emit TaskCreated(taskId, msg.sender, agentId, amount, block.timestamp + DISPUTE_WINDOW);
    }

    /// @notice Requester disputes a task before the deadline, freezing funds for owner review
    function dispute(bytes32 taskId) external {
        Task storage task = tasks[taskId];
        if (task.status == Status.None) revert TaskNotFound();
        if (task.requester != msg.sender) revert NotRequester();
        if (task.status != Status.Pending) revert AlreadyResolved();
        if (block.timestamp > task.disputeDeadline) revert DisputeWindowClosed();

        task.status = Status.Disputed;
        emit TaskDisputed(taskId);
    }

    /// @notice Release escrowed funds to the agent operator. Callable by anyone once the
    ///         dispute window has passed and the task was never disputed (optimistic release).
    function release(bytes32 taskId) external {
        Task storage task = tasks[taskId];
        if (task.status == Status.None) revert TaskNotFound();
        if (task.status != Status.Pending) revert AlreadyResolved();
        if (block.timestamp <= task.disputeDeadline) revert DisputeWindowStillOpen();

        task.status = Status.Released;

        AgentFactory.AgentInfo memory agent = FACTORY.getAgent(task.agentId);
        USDC.safeTransfer(agent.operator, task.amount);

        emit TaskReleased(taskId, agent.operator, task.amount);
    }

    /// @notice Owner resolves a disputed task by refunding the requester
    /// @dev    For the hackathon demo this is manually triggered; a production version
    ///         would route through arbitration or a more sophisticated verifier.
    function resolveDisputeRefund(bytes32 taskId) external onlyOwner {
        Task storage task = tasks[taskId];
        if (task.status != Status.Disputed) revert AlreadyResolved();

        task.status = Status.Refunded;
        USDC.safeTransfer(task.requester, task.amount);

        emit TaskRefunded(taskId, task.requester, task.amount);
    }

    /// @notice Owner resolves a disputed task by releasing to the agent anyway
    ///         (e.g. dispute was found to be invalid)
    function resolveDisputeRelease(bytes32 taskId) external onlyOwner {
        Task storage task = tasks[taskId];
        if (task.status != Status.Disputed) revert AlreadyResolved();

        task.status = Status.Released;

        AgentFactory.AgentInfo memory agent = FACTORY.getAgent(task.agentId);
        USDC.safeTransfer(agent.operator, task.amount);

        emit TaskReleased(taskId, agent.operator, task.amount);
    }

    /// @notice Whether a pending task can currently be released
    function canRelease(bytes32 taskId) external view returns (bool) {
        Task storage task = tasks[taskId];
        return task.status == Status.Pending && block.timestamp > task.disputeDeadline;
    }
}
