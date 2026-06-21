import { useState, useEffect, useRef, useCallback } from 'react'
import { AGENTS } from '../lib/data'
import {
  createTask,
  fetchAllTasks,
  releaseTask,
  fetchHealth,
  ApiError,
  type TaskListItem,
} from '../lib/api'
import styles from './LiveDemo.module.css'

const SCRIBE = AGENTS.find(a => a.id === 'scribe-7')

/** Sample inputs cycled through for each auto-created demo task. */
const SAMPLE_INPUTS = [
  'https://docs.arc.network',
  'https://www.circle.com/usdc',
  'Summarize the benefits of stablecoin-native settlement for AI agent micropayments.',
  'https://docs.claude.com/en/api/overview',
]

/** How often a new real task is auto-created, in ms. */
const TASK_CREATION_INTERVAL_MS = 25_000
/** How often we refresh the shared task list from the backend, in ms. */
const POLL_INTERVAL_MS = 4_000
/** Stop auto-creating new tasks once this many exist in the shared history,
 *  so an idle/forgotten open tab doesn't silently drain Agent-A's testnet
 *  USDC. The user can explicitly raise this via "Continue session". */
const TASKS_PER_BATCH = 8

type OnChainStatus = 'pending' | 'released' | 'disputed' | 'refunded' | 'unknown'

const ON_CHAIN_STATUS_MAP: Record<number, OnChainStatus> = {
  1: 'pending',
  2: 'disputed',
  3: 'released',
  4: 'refunded',
}

function mapOnChainStatus(status: number | null): OnChainStatus {
  if (status === null) return 'unknown'
  return ON_CHAIN_STATUS_MAP[status] ?? 'unknown'
}

/**
 * Live demo, backed entirely by the backend's shared task history
 * (GET /tasks) rather than local-only component state.
 *
 * This fixes two real problems with the earlier local-state version:
 * 1. Task history previously vanished on navigation/tab-switch, since it
 *    only lived in this component's React state.
 * 2. Concurrent task creation (e.g. from CreateTask.tsx and this page's
 *    auto-creation timer both firing close together) could cause nonce
 *    collisions on the backend — now fixed at the source via a write queue
 *    in chain.ts, but reading from the shared list here also means this
 *    page naturally reflects tasks created anywhere, not just here.
 */
function useLiveSimulation() {
  const [tasks, setTasks] = useState<TaskListItem[]>([])
  const [totalSettled, setTotalSettled] = useState(0)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [maxTasks, setMaxTasks] = useState(TASKS_PER_BATCH)
  const [listError, setListError] = useState<string | null>(null)
  const inputIdx = useRef(0)
  const mountedRef = useRef(true)
  const releaseAttempted = useRef<Set<string>>(new Set())
  const previouslyReleased = useRef<Set<string>>(new Set())

  const refreshList = useCallback(async () => {
    try {
      const { tasks: list } = await fetchAllTasks()
      if (!mountedRef.current) return

      // Track newly-released tasks to bump the settled total exactly once per task.
      for (const t of list) {
        if (t.onChainStatus === 3 && !previouslyReleased.current.has(t.taskId)) {
          previouslyReleased.current.add(t.taskId)
          setTotalSettled(s => parseFloat((s + 0.0021).toFixed(4)))
        }
      }

      setTasks(list)
      setListError(null)

      // Auto-release any task whose dispute window has passed.
      const now = Date.now() / 1000
      for (const t of list) {
        if (
          t.onChainStatus === 1 &&
          t.disputeDeadline !== null &&
          now > t.disputeDeadline &&
          !releaseAttempted.current.has(t.taskId)
        ) {
          releaseAttempted.current.add(t.taskId)
          releaseTask(t.taskId).catch(() => {
            // Release failure surfaces on next poll cycle via unchanged onChainStatus;
            // remove from attempted set so it can be retried.
            releaseAttempted.current.delete(t.taskId)
          })
        }
      }
    } catch (err) {
      if (!mountedRef.current) return
      setListError(err instanceof ApiError ? err.message : 'Failed to load task history — is the backend running?')
    }
  }, [])

  const createNewTask = useCallback(async () => {
    if (!SCRIBE?.agentId || !SCRIBE.onChain) return
    if (tasks.length >= maxTasks) return

    setCreating(true)
    setCreateError(null)

    const input = SAMPLE_INPUTS[inputIdx.current % SAMPLE_INPUTS.length]
    inputIdx.current++

    try {
      const amount = '2100' // $0.0021, matches Scribe-7's listed price
      await createTask(SCRIBE.agentId, amount, input)
      if (!mountedRef.current) return
      await refreshList()
    } catch (err) {
      if (!mountedRef.current) return
      setCreateError(err instanceof ApiError ? err.message : 'Failed to create task — is the backend running?')
    } finally {
      if (mountedRef.current) setCreating(false)
    }
  }, [tasks.length, maxTasks, refreshList])

  useEffect(() => {
    mountedRef.current = true

    refreshList().then(() => {
      if (mountedRef.current) createNewTask()
    })

    const creationTimer = setInterval(createNewTask, TASK_CREATION_INTERVAL_MS)
    const pollTimer = setInterval(refreshList, POLL_INTERVAL_MS)

    return () => {
      mountedRef.current = false
      clearInterval(creationTimer)
      clearInterval(pollTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const continueSession = useCallback(() => {
    setMaxTasks(m => m + TASKS_PER_BATCH)
  }, [])

  return { tasks, totalSettled, creating, createError, listError, maxTasks, continueSession }
}

function formatCountdown(deadline: number | null): string {
  if (deadline === null) return ''
  const remaining = Math.max(0, deadline - Date.now() / 1000)
  if (remaining === 0) return 'releasable now'
  const mins = Math.floor(remaining / 60)
  const secs = Math.floor(remaining % 60)
  return `${mins}m ${secs.toString().padStart(2, '0')}s until releasable`
}

const STATUS_LABEL: Record<OnChainStatus, string> = {
  pending: 'Escrow locked',
  released: 'Settled ✓',
  disputed: 'Disputed',
  refunded: 'Refunded',
  unknown: 'Status unknown',
}

const STATUS_COLOR: Record<OnChainStatus, string> = {
  pending: 'var(--amber)',
  released: 'var(--green)',
  disputed: '#ef4444',
  refunded: 'var(--text-muted)',
  unknown: 'var(--text-muted)',
}

export default function LiveDemo() {
  const { tasks, totalSettled, creating, createError, listError, maxTasks, continueSession } = useLiveSimulation()
  const [, forceTick] = useState(0)
  const [claudeRemaining, setClaudeRemaining] = useState<number | null>(null)

  // Re-render every second so countdown timers stay live without a full poll cycle.
  useEffect(() => {
    const id = setInterval(() => forceTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  // Track remaining Claude API call budget so the UI can warn before it's exhausted.
  useEffect(() => {
    let cancelled = false
    async function checkHealth() {
      try {
        const health = await fetchHealth()
        if (!cancelled) setClaudeRemaining(health.claudeApi.remaining)
      } catch {
        // Backend unreachable — leave last known value, don't spam errors here
        // since createError/listError already surface connectivity issues.
      }
    }
    checkHealth()
    const id = setInterval(checkHealth, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const settledCount = tasks.filter(t => t.onChainStatus === 3).length
  const atCap = tasks.length >= maxTasks

  if (!SCRIBE?.onChain) {
    return (
      <div className={styles.page}>
        <div className="container">
          <div className={styles.logEmpty}>Scribe-7 is not configured as an on-chain agent.</div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Live on Arc Testnet</p>
            <h1 className={styles.title}>Agent-A × Scribe-7</h1>
            <p className={styles.sub}>
              Real tasks, real USDC escrow, real settlement — created automatically every {TASK_CREATION_INTERVAL_MS / 1000}s.
              Each task carries a genuine 5-minute dispute window before auto-release. History persists across navigation.
            </p>
          </div>
          <div className={styles.liveBadge}>
            <span className={styles.liveDot} />
            {creating ? 'Creating task…' : atCap ? `Paused at ${maxTasks} tasks` : 'Live'}
          </div>
        </div>

        {createError && <div className={styles.errorBanner}>{createError}</div>}
        {listError && <div className={styles.errorBanner}>{listError}</div>}
        {claudeRemaining !== null && claudeRemaining <= 3 && (
          <div className={styles.errorBanner}>
            Only {claudeRemaining} Claude API call{claudeRemaining === 1 ? '' : 's'} remaining this session — summarization will pause to protect credits once exhausted. Restart the backend to reset.
          </div>
        )}

        {atCap && (
          <div className={styles.continueBanner}>
            <span>This session has created {maxTasks} real tasks on Arc Testnet, each spending Agent-A's USDC. Continue to create more.</span>
            <button className={styles.continueBtn} onClick={continueSession}>
              Continue session
            </button>
          </div>
        )}

        <div className={styles.metricsGrid} style={{ marginBottom: 28 }}>
          {[
            { val: tasks.length.toString(), label: 'Tasks created' },
            { val: settledCount.toString(), label: 'Settled' },
            { val: `$${totalSettled.toFixed(4)}`, label: 'USDC settled' },
            { val: claudeRemaining !== null ? claudeRemaining.toString() : '—', label: 'Claude calls left' },
          ].map(m => (
            <div key={m.label} className={styles.metric}>
              <div className={styles.metricVal}>{m.val}</div>
              <div className={styles.metricLabel}>{m.label}</div>
            </div>
          ))}
        </div>

        <div className={styles.logCard}>
          <div className={styles.logTitle}>Task activity</div>
          {tasks.length === 0 && (
            <div className={styles.logEmpty}>Creating the first task on Arc Testnet…</div>
          )}
          <div className={styles.logList}>
            {tasks.map(task => {
              const onChainStatus = mapOnChainStatus(task.onChainStatus)
              return (
                <div key={task.taskId} className={styles.taskCard}>
                  <div className={styles.taskCardTop}>
                    <div>
                      <div className={styles.logId}>{task.taskId.slice(0, 10)}…{task.taskId.slice(-6)}</div>
                      <div className={styles.logInput}>{task.input}</div>
                    </div>
                    <div
                      className={styles.onChainBadge}
                      style={{ color: STATUS_COLOR[onChainStatus] }}
                    >
                      {STATUS_LABEL[onChainStatus]}
                    </div>
                  </div>

                  <div className={styles.taskCardMeta}>
                    <span>0.0021 USDC</span>
                    <span>
                      {onChainStatus === 'pending' ? formatCountdown(task.disputeDeadline) : ''}
                    </span>
                    <a
                      href={`https://testnet.arcscan.app/tx/${task.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.explorerLink}
                    >
                      view on explorer ↗
                    </a>
                  </div>

                  <div className={styles.resultBox}>
                    {task.resultStatus === 'pending' && <span className={styles.resultPending}>Queued for Scribe-7…</span>}
                    {task.resultStatus === 'processing' && <span className={styles.resultPending}>Scribe-7 is reading and summarizing…</span>}
                    {task.resultStatus === 'complete' && <span className={styles.resultComplete}>{task.result}</span>}
                    {task.resultStatus === 'failed' && (
                      <span className={styles.resultFailed}>
                        Summarization failed: {task.resultError ?? 'unknown error'}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
