import { useMemo, useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, TooltipProps } from 'recharts'
import { AGENTS } from '../lib/data'
import { fetchAgent, fetchAllTasks, formatTokenPrice, formatUsdc, ApiError, type TaskListItem } from '../lib/api'
import type { Agent } from '../types'
import styles from './AgentProfile.module.css'

interface ChartPoint {
  block: string
  price: number
}

interface TooltipPayload {
  value: number
  payload: ChartPoint
}

function generateCurveData(basePrice: number): ChartPoint[] {
  const data: ChartPoint[] = []
  let price = 0.000004
  for (let i = 0; i <= 20; i++) {
    price = price * (1 + Math.random() * 0.04 + 0.005)
    data.push({ block: `#${48200 + i * 5}`, price: parseFloat(price.toFixed(9)) })
  }
  data.push({ block: 'Now', price: basePrice })
  return data
}

function CustomTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  const entry = payload[0] as TooltipPayload
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipBlock}>{entry.payload.block}</div>
      <div className={styles.tooltipPrice}>${entry.value.toFixed(9)}</div>
    </div>
  )
}

const AGENT_ID_PATTERN = /^0x[a-fA-F0-9]{64}$/

const ON_CHAIN_STATUS_LABEL: Record<number, string> = {
  1: 'pending',
  2: 'disputed',
  3: 'settled',
  4: 'refunded',
}

const ON_CHAIN_STATUS_COLOR: Record<number, string> = {
  1: 'var(--amber)',
  2: '#ef4444',
  3: 'var(--green)',
  4: 'var(--text-muted)',
}

function timeAgo(timestampMs: number): string {
  const diffSec = Math.floor((Date.now() - timestampMs) / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.floor(diffHr / 24)}d ago`
}

export default function AgentProfile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // First check for a hand-designed mock agent matching this slug (e.g.
  // 'scribe-7'). If none matches AND the id looks like a real bytes32
  // agentId, this is an agent that exists only on-chain (e.g. deployed via
  // DeployAgent.tsx) — construct a minimal placeholder Agent record for it
  // rather than silently falling back to AGENTS[0], which would show the
  // wrong agent's profile entirely.
  const mockMatch = AGENTS.find(a => a.id === id)
  const looksLikeAgentId = !!id && AGENT_ID_PATTERN.test(id)

  const initialAgent: Agent = mockMatch ?? {
    id: id ?? '',
    name: 'Loading…',
    type: '',
    status: 'online',
    tasks: null,
    success: null,
    avgTime: null,
    price: '$0.0021',
    icon: '◆',
    tokenPrice: 0,
    mcap: 0,
    onChain: true,
    agentId: looksLikeAgentId ? id : undefined,
  }

  const [agent, setAgent] = useState<Agent>(initialAgent)
  const [liveDataFailed, setLiveDataFailed] = useState(false)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    setAgent(initialAgent)
    setLiveDataFailed(false)
    setNotFound(false)

    const targetAgentId = mockMatch?.agentId ?? (looksLikeAgentId ? id : undefined)
    if (!targetAgentId) {
      if (!mockMatch) setNotFound(true)
      return
    }

    let cancelled = false

    async function loadLive() {
      try {
        const { agent: live } = await fetchAgent(targetAgentId!)
        if (cancelled) return

        setAgent(prev => ({
          ...prev,
          // For on-chain-only agents (no mock match) fill in real fields
          // from the live response, since the placeholder above had nothing.
          name: mockMatch ? prev.name : live.name,
          type: mockMatch ? prev.type : live.agentType,
          status: live.active ? prev.status : 'offline',
          tokenPrice: formatTokenPrice(live.currentPrice),
          mcap: formatUsdc(live.fdv),
          graduated: live.graduated,
          tokenAddress: mockMatch ? prev.tokenAddress : live.tokenAddress,
          operatorAddress: mockMatch ? prev.operatorAddress : live.operator,
        }))
      } catch (err) {
        if (cancelled) return
        console.error('Failed to load live agent profile data:', err instanceof ApiError ? err.message : err)
        if (!mockMatch) {
          setNotFound(true)
        } else {
          setLiveDataFailed(true)
        }
      }
    }

    loadLive()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const chartData = useMemo(() => generateCurveData(agent.tokenPrice), [agent.tokenPrice])

  // Real task history for this agent, fetched separately from the agent's
  // own profile data since GET /tasks returns ALL tasks across all agents —
  // we filter client-side to just this agent's agentId. Previously this
  // section always showed SAMPLE_TASKS (fabricated placeholder data) for
  // every non-mock agent, or nothing at all — even though real completed
  // tasks existed the whole time in the backend's task store.
  const [realTasks, setRealTasks] = useState<TaskListItem[]>([])
  const [taskHistoryLoaded, setTaskHistoryLoaded] = useState(false)

  useEffect(() => {
    const targetAgentId = mockMatch?.agentId ?? (looksLikeAgentId ? id : undefined)
    if (!targetAgentId) {
      setRealTasks([])
      setTaskHistoryLoaded(true)
      return
    }

    let cancelled = false

    async function loadTaskHistory() {
      try {
        const { tasks } = await fetchAllTasks()
        if (cancelled) return
        setRealTasks(tasks.filter(t => t.agentId === targetAgentId))
        setTaskHistoryLoaded(true)
      } catch (err) {
        if (cancelled) return
        console.error('Failed to load task history:', err instanceof ApiError ? err.message : err)
        setTaskHistoryLoaded(true) // still mark loaded so we show an empty/error state, not an infinite spinner
      }
    }

    loadTaskHistory()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Fabricated sample history is only ever shown for agents with no real
  // agentId to query against — i.e. the page literally cannot know their
  // real history because none exists to fetch. Any agent with a real
  // agentId (Scribe-7, or any newly deployed agent) shows its REAL history
  // — even if that real history is currently empty, an honest "no tasks
  // yet" beats fabricated activity for a verifiable on-chain entity.

  if (notFound) {
    return (
      <div className={styles.page}>
        <div className="container">
          <button className={styles.back} onClick={() => navigate('/agents')}>
            ← Back to agents
          </button>
          <div className={styles.tooltip} style={{ padding: 24, marginTop: 20 }}>
            Agent not found. It may not exist, or the backend is unreachable.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className="container">
        <button className={styles.back} onClick={() => navigate('/agents')}>
          ← Back to agents
        </button>

        <div className={styles.layout}>
          {/* Left column */}
          <div className={styles.left}>
            <div className={styles.profileCard}>
              <div className={styles.profileTop}>
                <div className={styles.avatar}>{agent.icon}</div>
                <div className={styles.profileInfo}>
                  <h1 className={styles.name}>{agent.name}</h1>
                  <p className={styles.type}>{agent.type}</p>
                </div>
                <div
                  className={styles.statusBadge}
                  style={{
                    color: agent.status === 'online' ? 'var(--green)' : 'var(--amber)',
                    borderColor: agent.status === 'online' ? 'var(--green-dim)' : '#854f0b',
                    background: agent.status === 'online' ? 'var(--green-bg)' : '#1a0e00',
                  }}
                >
                  {agent.status}
                </div>
              </div>

              {agent.description && (
                <p className={styles.description}>{agent.description}</p>
              )}

              {agent.capabilities && (
                <div className={styles.caps}>
                  {agent.capabilities.map(c => (
                    <span key={c} className={styles.cap}>{c}</span>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.statsGrid}>
              {[
                { label: 'Tasks completed', val: agent.tasks ?? '—' },
                { label: 'Success rate', val: agent.success ?? '—' },
                { label: 'Avg response', val: agent.avgTime ?? '—' },
                { label: 'Cost per task', val: agent.price },
              ].map(s => (
                <div key={s.label} className={styles.statCard}>
                  <div className={styles.statVal}>{s.val}</div>
                  <div className={styles.statLabel}>{s.label}</div>
                </div>
              ))}
            </div>

            <div className={styles.hireCard}>
              <div className={styles.hireTop}>
                <div>
                  <div className={styles.hirePrice}>{agent.price}</div>
                  <div className={styles.hireSub}>per task · USDC escrow</div>
                </div>
                <button className={styles.hireBtn} onClick={() => navigate('/tasks/new')}>
                  Hire this agent
                </button>
              </div>
              <p className={styles.hireNote}>
                Payment held in escrow. Auto-releases after 5-minute dispute window.
              </p>
            </div>
          </div>

          {/* Right column */}
          <div className={styles.right}>
            <div className={styles.chartCard}>
              <div className={styles.chartHeader}>
                <div>
                  <div className={styles.chartLabel}>Token price</div>
                  <div className={styles.chartPrice}>${agent.tokenPrice.toFixed(9)}</div>
                </div>
                <div className={styles.chartMcapBlock}>
                  <div className={styles.chartLabel}>Market cap</div>
                  <div className={styles.chartMcapVal}>${agent.mcap.toLocaleString()}</div>
                </div>
              </div>
              <div className={styles.chart}>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <XAxis dataKey="block" hide />
                    <YAxis hide domain={['auto', 'auto']} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="price"
                      stroke="#4ade80"
                      strokeWidth={1.5}
                      dot={false}
                      activeDot={{ r: 3, fill: '#4ade80' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className={styles.chartNote}>
                Bonding curve · 1B token supply · Graduation at $4,020 USDC
              </div>
              {liveDataFailed && (
                <div className={styles.liveFailedNote}>
                  Live chain data unavailable — showing last known values.
                </div>
              )}
            </div>

            <div className={styles.historyCard}>
              <div className={styles.historyTitle}>Recent tasks</div>
              {!taskHistoryLoaded ? (
                <div className={styles.historyEmpty}>Loading task history…</div>
              ) : realTasks.length === 0 ? (
                <div className={styles.historyEmpty}>
                  No tasks completed yet. This agent is live on Arc Testnet — task history will appear here once requests are processed.
                </div>
              ) : (
                <div className={styles.historyList}>
                  {realTasks
                    .slice()
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .map(t => (
                      <div key={t.taskId} className={styles.taskRow}>
                        <div className={styles.taskLeft}>
                          <div className={styles.taskId}>{t.taskId.slice(0, 10)}…{t.taskId.slice(-6)}</div>
                          <div className={styles.taskInput}>{t.input}</div>
                          {t.resultStatus === 'complete' && t.result && (
                            <div className={styles.taskResult}>{t.result}</div>
                          )}
                          {t.resultStatus === 'failed' && (
                            <div className={styles.taskResultError}>{t.resultError ?? 'Summarization failed'}</div>
                          )}
                        </div>
                        <div className={styles.taskRight}>
                          <div
                            className={styles.taskStatus}
                            style={{ color: t.onChainStatus !== null ? ON_CHAIN_STATUS_COLOR[t.onChainStatus] : 'var(--text-muted)' }}
                          >
                            {t.onChainStatus !== null ? ON_CHAIN_STATUS_LABEL[t.onChainStatus] : 'unknown'}
                          </div>
                          <div className={styles.taskMeta}>
                            $0.0021 · {timeAgo(t.createdAt)}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
