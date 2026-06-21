// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AgentToken} from "./AgentToken.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title AgentFactory
/// @notice Registers AI agents on Lattice and deploys a dedicated bonding-curve token
///         for each one. Token price reflects agent reputation: completed tasks drive
///         buys, buys move price, price is the on-chain reputation signal.
contract AgentFactory is Ownable {
    struct AgentInfo {
        address operator;      // wallet authorized to act as this agent
        address token;         // deployed AgentToken address
        string name;
        string agentType;      // e.g. "text-summarization", "data-retrieval"
        uint256 registeredAt;
        bool active;
    }

    /// @notice USDC token address used by all agent curves on this deployment
    address public immutable USDC;

    /// @notice agentId => AgentInfo
    mapping(bytes32 => AgentInfo) public agents;

    /// @notice operator address => agentId, for quick reverse lookup
    mapping(address => bytes32) public operatorToAgentId;

    /// @notice Ordered list of all registered agent ids, for enumeration
    bytes32[] public agentIds;

    event AgentRegistered(bytes32 indexed agentId, address indexed operator, address token, string name);
    event AgentDeactivated(bytes32 indexed agentId);
    event AgentReactivated(bytes32 indexed agentId);

    error AgentAlreadyRegistered();
    error AgentNotFound();
    error OperatorAlreadyRegistered();
    error NotAgentOperator();

    constructor(address usdc_, address owner_) Ownable(owner_) {
        USDC = usdc_;
    }

    /// @notice Register a new agent and deploy its bonding-curve token
    /// @param name        Display name (e.g. "Scribe-7")
    /// @param symbol      Token symbol (e.g. "SCRB7")
    /// @param agentType   Free-text category (e.g. "text-summarization")
    /// @param operator     Wallet that will act as this agent (signs task completions)
    function registerAgent(
        string calldata name,
        string calldata symbol,
        string calldata agentType,
        address operator
    ) external returns (bytes32 agentId, address token) {
        if (operatorToAgentId[operator] != bytes32(0)) revert OperatorAlreadyRegistered();

        agentId = keccak256(abi.encodePacked(name, operator, block.timestamp, agentIds.length));
        if (agents[agentId].token != address(0)) revert AgentAlreadyRegistered();

        AgentToken newToken = new AgentToken(name, symbol, USDC, agentId, owner());
        token = address(newToken);

        agents[agentId] = AgentInfo({
            operator: operator,
            token: token,
            name: name,
            agentType: agentType,
            registeredAt: block.timestamp,
            active: true
        });

        operatorToAgentId[operator] = agentId;
        agentIds.push(agentId);

        emit AgentRegistered(agentId, operator, token, name);
    }

    /// @notice Deactivate an agent (e.g. it goes offline or misbehaves)
    function deactivateAgent(bytes32 agentId) external onlyOwner {
        if (agents[agentId].token == address(0)) revert AgentNotFound();
        agents[agentId].active = false;
        emit AgentDeactivated(agentId);
    }

    /// @notice Reactivate a previously deactivated agent
    function reactivateAgent(bytes32 agentId) external onlyOwner {
        if (agents[agentId].token == address(0)) revert AgentNotFound();
        agents[agentId].active = true;
        emit AgentReactivated(agentId);
    }

    /// @notice Total number of agents ever registered (active or not)
    function agentCount() external view returns (uint256) {
        return agentIds.length;
    }

    /// @notice Fetch agent info by id, reverting if it doesn't exist
    function getAgent(bytes32 agentId) external view returns (AgentInfo memory) {
        if (agents[agentId].token == address(0)) revert AgentNotFound();
        return agents[agentId];
    }

    /// @notice Resolve an operator address to its agentId, reverting if unregistered
    function requireAgentId(address operator) external view returns (bytes32) {
        bytes32 agentId = operatorToAgentId[operator];
        if (agentId == bytes32(0)) revert NotAgentOperator();
        return agentId;
    }
}
