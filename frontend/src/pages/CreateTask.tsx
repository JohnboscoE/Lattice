import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchAllRealAgents } from '../lib/agents'
import { createTask, ApiError } from '../lib/api'
import type { Agent } from '../types'
import styles from './CreateTask.module.css'

type SubmitState = 'idle' | 'submitting' | 'success' | 'error'
type LoadState = 'loading' | 'ready' | 'error'

/**
 * Parse a "$0.0021" style price string into a raw USDC integer string
 * (6-decimal units) suitable for the backend's amount field.
 *
 * Uses string manipulation rather than floating point multiplication to
 * avoid precision issues at small USDC amounts.
 */
function priceToRawUsdc(price: string): string {
  const numeric = price.replace('$', '')
  const [whole, fraction = ''] = numeric.split('.')
  const paddedFraction = (fraction + '000000').slice(0, 6)
  const raw = `${whole}${paddedFraction}`.replace(/^0+(?=\d)/, '')
  return raw || '0'
}

export default function CreateTask() {
  const navigate = useNavigate()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [selectedId, setSelectedId] = useState<string>('')
  const [input, setInput] = useState<string>('')
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [result, setResult] = useState<{ taskId: string; txHash: string } | null>(null)

  // Load every real agent (on-chain, including anything newly deployed by
  // any user) rather than only the hand-coded demo agents. Previously this
  // page only ever showed Scribe-7 as selectable, since it read directly
  // from the static mock array instead of the live backend.
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const all = await fetchAllRealAgents()
        if (cancelled) return

        setAgents(all)
        // Default-select the first active on-chain agent, if any.
        const firstOnChain = all.find(a => a.onChain && a.status !== 'offline')
        setSelectedId(firstOnChain?.id ?? all[0]?.id ?? '')
        setLoadState('ready')
      } catch (err) {
        if (cancelled) return
        console.error('Failed to load agents for task creation:', err)
        setLoadState('error')
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  const availableAgents = agents.filter(a => a.status !== 'offline')
  const agent = availableAgents.find(a => a.id === selectedId) ?? availableAgents[0]

  async function handleSubmit(): Promise<void> {
    if (!input.trim() || !agent) return

    if (!agent.onChain || !agent.agentId) {
      setSubmitState('error')
      setErrorMessage(`${agent.name} is not yet live on-chain — task creation isn't available for this agent.`)
      return
    }

    setSubmitState('submitting')
    setErrorMessage('')

    try {
      const amount = priceToRawUsdc(agent.price)
      const response = await createTask(agent.agentId, amount, input.trim())
      setResult({ taskId: response.taskId, txHash: response.txHash })
      setSubmitState('success')
    } catch (err) {
      setSubmitState('error')
      setErrorMessage(err instanceof ApiError ? err.message : 'Failed to create task. Is the backend running?')
    }
  }

  if (submitState === 'success' && result) {
    const explorerUrl = `https://testnet.arcscan.app/tx/${result.txHash}`

    return (
      <div className={styles.page}>
        <div className={styles.successWrap}>
          <div className={styles.successIcon}>✓</div>
          <h2 className={styles.successTitle}>Task submitted</h2>
          <p className={styles.successSub}>Escrow locked on Arc Testnet</p>
          <div className={styles.successDetails}>
            <div className={styles.successRow}>
              <span>Task ID</span>
              <code>{result.taskId.slice(0, 10)}…{result.taskId.slice(-8)}</code>
            </div>
            <div className={styles.successRow}>
              <span>Transaction</span>
              <a href={explorerUrl} target="_blank" rel="noreferrer" className={styles.explorerLink}>
                {result.txHash.slice(0, 10)}…{result.txHash.slice(-8)} ↗
              </a>
            </div>
          </div>
          <p className={styles.indexingNote}>
            Explorer indexing can take a few seconds after submission — if the link shows "not found," wait a moment and retry.
          </p>
          <div className={styles.successActions}>
            <button className={styles.submitBtn} onClick={() => navigate('/demo')}>
              View live demo
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <button className={styles.back} onClick={() => navigate('/agents')}>← Back</button>
        <h1 className={styles.title}>New task</h1>
        <p className={styles.sub}>Select an agent, describe the task, and pay via USDC escrow on Arc.</p>

        {loadState === 'loading' && (
          <div className={styles.loadingNote}>Loading agents…</div>
        )}

        {loadState === 'error' && (
          <div className={styles.errorBox}>Failed to load agents — is the backend running?</div>
        )}

        {loadState === 'ready' && (
          <div className={styles.form}>
            {/* Agent selector */}
            <div className={styles.field}>
              <label className={styles.label}>Agent</label>
              <div className={styles.agentList}>
                {availableAgents.map(a => {
                  const disabled = a.status === 'busy' || !a.onChain
                  return (
                    <button
                      key={a.id}
                      className={`${styles.agentOption} ${selectedId === a.id ? styles.agentSelected : ''}`}
                      onClick={() => setSelectedId(a.id)}
                      disabled={disabled}
                      type="button"
                    >
                      <span className={styles.agentIcon}>{a.icon}</span>
                      <div className={styles.agentInfo}>
                        <span className={styles.agentName}>
                          {a.name}
                          {a.onChain && <span className={styles.onChainDot} title="Live on Arc Testnet" />}
                        </span>
                        <span className={styles.agentType}>{a.type}</span>
                      </div>
                      <div className={styles.agentRight}>
                        <span className={styles.agentPrice}>{a.price}</span>
                        {a.status === 'busy' && <span className={styles.busyTag}>busy</span>}
                        {!a.onChain && <span className={styles.busyTag}>not yet on-chain</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Task input */}
            <div className={styles.field}>
              <label className={styles.label}>Task input</label>
              <textarea
                className={styles.textarea}
                placeholder="Enter a URL to summarize, data to retrieve, or a computation to run…"
                value={input}
                onChange={e => setInput(e.target.value)}
                rows={5}
              />
            </div>

            {/* Escrow breakdown */}
            <div className={styles.escrowBox}>
              {[
                { label: 'Agent', val: agent?.name ?? '—' },
                { label: 'Cost', val: `${agent?.price ?? '—'} USDC` },
                { label: 'Arc fee', val: '~$0.01 USDC' },
                { label: 'Dispute window', val: '5 minutes' },
              ].map(row => (
                <div key={row.label} className={styles.escrowRow}>
                  <span className={styles.escrowLabel}>{row.label}</span>
                  <span className={styles.escrowVal}>{row.val}</span>
                </div>
              ))}
              <div className={styles.escrowDivider} />
              <div className={styles.escrowRow}>
                <span className={styles.escrowLabelStrong}>Total escrowed</span>
                <span className={styles.escrowTotal}>{agent?.price ?? '—'} USDC</span>
              </div>
            </div>

            {submitState === 'error' && (
              <div className={styles.errorBox}>{errorMessage}</div>
            )}

            <button
              className={styles.submitBtn}
              onClick={handleSubmit}
              disabled={!input.trim() || submitState === 'submitting' || !agent?.onChain}
              type="button"
            >
              {submitState === 'submitting' ? 'Locking escrow on Arc…' : 'Lock escrow and submit task'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
