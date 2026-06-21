import { AGENTS } from './data'
import { fetchAgents, formatTokenPrice, formatUsdc, type OnChainAgentResponse } from './api'
import type { Agent } from '../types'

/** Pick a deterministic icon for agents with no hand-picked one (e.g. newly deployed). */
const FALLBACK_ICONS = ['◆', '▲', '●', '◈', '✦', '⬡', '◉', '⟁']
function fallbackIcon(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return FALLBACK_ICONS[hash % FALLBACK_ICONS.length]
}

/**
 * Newly deployed agents have no hand-set "price per task" — there's no
 * contract concept of per-task pricing, that's UI-only on existing mock
 * agents — so use the same flat rate used everywhere else in the demo
 * until real per-agent pricing exists.
 */
function derivePriceLabel(): string {
  return '$0.0021'
}

function onChainAgentToAgent(live: OnChainAgentResponse, mockMatch: Agent | undefined): Agent {
  if (mockMatch) {
    return {
      ...mockMatch,
      tokenPrice: formatTokenPrice(live.currentPrice),
      mcap: formatUsdc(live.fdv),
      graduated: live.graduated,
      status: live.active ? mockMatch.status : 'offline',
    }
  }

  // No mock entry — this is a genuinely new agent (e.g. deployed via the
  // wallet-connect "Deploy agent" flow). Construct a real Agent record
  // directly from live chain data instead of silently dropping it.
  return {
    id: live.agentId,
    name: live.name,
    type: live.agentType,
    status: live.active ? 'online' : 'offline',
    tasks: null,
    success: null,
    avgTime: null,
    price: derivePriceLabel(),
    icon: fallbackIcon(live.agentId),
    tokenPrice: formatTokenPrice(live.currentPrice),
    mcap: formatUsdc(live.fdv),
    onChain: true,
    agentId: live.agentId,
    tokenAddress: live.tokenAddress,
    operatorAddress: live.operator,
    graduated: live.graduated,
  }
}

/**
 * Fetch the full, real agent list: every agent registered on AgentFactory,
 * each either enriching a hand-designed mock entry (Scribe-7, etc.) or
 * constructed fresh from live chain data (any agent with no mock
 * counterpart — e.g. newly deployed by a user). Mock-only agents with no
 * on-chain match (Fetch-3, Calc-1, etc.) are appended after, unchanged, as
 * decorative/illustrative entries.
 *
 * This is THE shared source of truth for "what agents exist" — any page
 * that needs to list, select, or look up agents should use this rather
 * than reading the static AGENTS array directly, which previously caused
 * the same "new agent invisible" bug to be fixed independently (and
 * inconsistently) in multiple pages.
 */
export async function fetchAllRealAgents(): Promise<Agent[]> {
  const { agents: onChainAgents } = await fetchAgents()

  const liveAgentIds = new Set(onChainAgents.map(a => a.agentId))

  const fromChain = onChainAgents.map(live => {
    const mockMatch = AGENTS.find(m => m.agentId === live.agentId)
    return onChainAgentToAgent(live, mockMatch)
  })

  const mockOnly = AGENTS.filter(m => !m.onChain || !liveAgentIds.has(m.agentId ?? ''))

  return [...fromChain, ...mockOnly]
}
