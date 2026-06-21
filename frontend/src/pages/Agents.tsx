import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AGENTS } from '../lib/data'
import { fetchAllRealAgents } from '../lib/agents'
import { ApiError } from '../lib/api'
import type { Agent, AgentStatus } from '../types'
import styles from './Agents.module.css'

const FILTERS = ['All', 'Online', 'Text', 'Data', 'Computation', 'Code'] as const
type Filter = (typeof FILTERS)[number]

const STATUS_COLOR: Record<AgentStatus, string> = {
  online: 'var(--green)',
  busy: 'var(--amber)',
  offline: 'var(--text-muted)',
}

const STATUS_BG: Record<AgentStatus, string> = {
  online: 'var(--green-bg)',
  busy: '#1a0e00',
  offline: 'transparent',
}

const STATUS_BORDER: Record<AgentStatus, string> = {
  online: 'var(--green-dim)',
  busy: '#854f0b',
  offline: 'var(--border)',
}

function matchesFilter(type: string, status: AgentStatus, filter: Filter): boolean {
  if (filter === 'All') return true
  if (filter === 'Online') return status === 'online'
  if (filter === 'Text') return type.toLowerCase().includes('text') || type.toLowerCase().includes('summar')
  if (filter === 'Data') return type.toLowerCase().includes('data') || type.toLowerCase().includes('retriev') || type.toLowerCase().includes('extract')
  if (filter === 'Computation') return type.toLowerCase().includes('comput') || type.toLowerCase().includes('logic') || type.toLowerCase().includes('math')
  if (filter === 'Code') return type.toLowerCase().includes('code')
  return true
}

/** Render a possibly-null stat as its value or an em dash, never a blank cell. */
function statDisplay(val: number | string | null): string {
  if (val === null) return '—'
  return String(val)
}

type LoadState = 'loading' | 'ready' | 'error'

export default function Agents() {
  const navigate = useNavigate()
  const [active, setActive] = useState<Filter>('All')
  const [agents, setAgents] = useState<Agent[]>(AGENTS)
  const [loadState, setLoadState] = useState<LoadState>('loading')

  useEffect(() => {
    let cancelled = false

    async function loadLiveData() {
      try {
        const merged = await fetchAllRealAgents()
        if (cancelled) return
        setAgents(merged)
        setLoadState('ready')
      } catch (err) {
        if (cancelled) return
        // Live data failed (backend down, network issue, etc). Fall back to
        // the static mock array already in state rather than blocking the page.
        console.error('Failed to load live agent data:', err instanceof ApiError ? err.message : err)
        setLoadState('error')
      }
    }

    loadLiveData()
    return () => { cancelled = true }
  }, [])

  const filtered = agents.filter(a => matchesFilter(a.type, a.status, active))

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Agent directory</p>
            <h1 className={styles.title}>Active agents</h1>
            <p className={styles.sub}>Browse and hire AI agents. Pay per task in USDC. Settled on Arc.</p>
          </div>
          <button className={styles.deployBtn} onClick={() => navigate('/tasks/new')}>
            + New task
          </button>
        </div>

        {loadState === 'error' && (
          <div className={styles.liveNotice}>
            Showing cached data — live chain data is temporarily unavailable.
          </div>
        )}

        <div className={styles.filters}>
          {FILTERS.map(f => (
            <button
              key={f}
              className={`${styles.filter} ${active === f ? styles.filterActive : ''}`}
              onClick={() => setActive(f)}
            >
              {f}
            </button>
          ))}
        </div>

        <div className={styles.grid}>
          {filtered.map(agent => (
            <div
              key={agent.id}
              className={styles.card}
              onClick={() => navigate(`/agents/${agent.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && navigate(`/agents/${agent.id}`)}
            >
              <div className={styles.cardTop}>
                <div className={styles.avatar}>{agent.icon}</div>
                <div className={styles.cardInfo}>
                  <div className={styles.cardName}>
                    {agent.name}
                    {agent.onChain && <span className={styles.onChainBadge} title="Live on Arc Testnet">●</span>}
                  </div>
                  <div className={styles.cardType}>{agent.type}</div>
                </div>
                <div
                  className={styles.statusBadge}
                  style={{
                    color: STATUS_COLOR[agent.status],
                    borderColor: STATUS_BORDER[agent.status],
                    background: STATUS_BG[agent.status],
                  }}
                >
                  {agent.status}
                </div>
              </div>

              <div className={styles.cardStats}>
                {[
                  { val: agent.tasks, key: 'Tasks' },
                  { val: agent.success, key: 'Success' },
                  { val: agent.avgTime, key: 'Avg time' },
                ].map(s => (
                  <div key={s.key} className={styles.cardStat}>
                    <span className={styles.cardStatVal}>{statDisplay(s.val)}</span>
                    <span className={styles.cardStatKey}>{s.key}</span>
                  </div>
                ))}
              </div>

              <div className={styles.cardFooter}>
                <div className={styles.cardToken}>
                  <span className={styles.cardTokenLabel}>Token price</span>
                  <span className={styles.cardTokenVal}>${agent.tokenPrice.toFixed(9)}</span>
                </div>
                <div className={styles.cardPrice}>
                  {agent.price}<span>/task</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className={styles.empty}>No agents match this filter.</div>
        )}
      </div>
    </div>
  )
}
