import { publicClient, requireEnvAddress } from './chain.js'
import { AGENT_FACTORY_ABI, AGENT_TOKEN_ABI } from './abi.js'
import type { Address } from 'viem'

export interface OnChainAgent {
  agentId: string
  name: string
  agentType: string
  operator: Address
  tokenAddress: Address
  active: boolean
  registeredAt: number
  currentPrice: string   // USDC per token, 18-decimal fixed point, as a string to avoid JS float loss
  fdv: string            // USDC, 6-decimal units, as a string
  graduated: boolean
  realUsdcReserve: string
}

let factoryAddress: Address | null = null

function getFactoryAddress(): Address {
  if (!factoryAddress) {
    factoryAddress = requireEnvAddress('AGENT_FACTORY_ADDRESS')
  }
  return factoryAddress
}

/**
 * Fetch all registered agents directly from AgentFactory, enriched with live
 * price/fdv/graduation data from each agent's AgentToken contract.
 *
 * This is an N+1 read pattern (agentCount, then agentIds(i) for each, then
 * getAgent + token reads for each) — acceptable for a handful of agents on a
 * hackathon timeline, but would need a subgraph or cached indexer to scale.
 */
export async function fetchAllAgents(): Promise<OnChainAgent[]> {
  const factory = getFactoryAddress()

  const count = await publicClient.readContract({
    address: factory,
    abi: AGENT_FACTORY_ABI,
    functionName: 'agentCount',
  })

  const agentIds = await Promise.all(
    Array.from({ length: Number(count) }, (_, i) =>
      publicClient.readContract({
        address: factory,
        abi: AGENT_FACTORY_ABI,
        functionName: 'agentIds',
        args: [BigInt(i)],
      })
    )
  )

  const agents = await Promise.all(agentIds.map(fetchAgentById))
  return agents
}

/**
 * Fetch a single agent's full info, joining AgentFactory registry data with
 * live AgentToken curve state.
 */
export async function fetchAgentById(agentId: `0x${string}`): Promise<OnChainAgent> {
  const factory = getFactoryAddress()

  const info = await publicClient.readContract({
    address: factory,
    abi: AGENT_FACTORY_ABI,
    functionName: 'getAgent',
    args: [agentId],
  })

  const tokenAddress = info.token as Address

  const [currentPrice, fdv, graduated, realUsdcReserve] = await Promise.all([
    publicClient.readContract({ address: tokenAddress, abi: AGENT_TOKEN_ABI, functionName: 'currentPrice' }),
    publicClient.readContract({ address: tokenAddress, abi: AGENT_TOKEN_ABI, functionName: 'fdv' }),
    publicClient.readContract({ address: tokenAddress, abi: AGENT_TOKEN_ABI, functionName: 'graduated' }),
    publicClient.readContract({ address: tokenAddress, abi: AGENT_TOKEN_ABI, functionName: 'realUsdcReserve' }),
  ])

  return {
    agentId,
    name: info.name,
    agentType: info.agentType,
    operator: info.operator as Address,
    tokenAddress,
    active: info.active,
    registeredAt: Number(info.registeredAt),
    currentPrice: currentPrice.toString(),
    fdv: fdv.toString(),
    graduated,
    realUsdcReserve: realUsdcReserve.toString(),
  }
}
