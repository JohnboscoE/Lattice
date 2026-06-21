export type AgentStatus = 'online' | 'busy' | 'offline'

export interface Agent {
  id: string
  name: string
  type: string
  status: AgentStatus
  /** Fabricated demo metric. Null when no real data exists (e.g. real on-chain agents with no completed tasks yet). */
  tasks: number | null
  /** Fabricated demo metric. Null when no real data exists. */
  success: string | null
  /** Fabricated demo metric. Null when no real data exists. */
  avgTime: string | null
  price: string
  icon: string
  tokenPrice: number
  mcap: number
  description?: string
  capabilities?: string[]
  /** True once this agent is actually registered on AgentFactory on Arc Testnet. */
  onChain?: boolean
  /** bytes32 agentId from AgentFactory, only present if onChain is true. */
  agentId?: string
  /** Deployed AgentToken contract address, only present if onChain is true. */
  tokenAddress?: string
  /** Wallet that receives task payments for this agent, only present if onChain is true. */
  operatorAddress?: string
  /** True once realUsdcReserve crosses the graduation threshold. Only meaningful if onChain. */
  graduated?: boolean
}

export interface Task {
  id: string
  input: string
  agent: string
  cost: string
  status: 'complete' | 'dispute' | 'pending'
  time: string
  ago?: string
  block?: string
  ts?: string
  duration?: number
}
