import { useState, useEffect } from 'react'
import styles from './AnimatedFlow.module.css'

interface FlowStep {
  id: string
  label: string
  title: string
  detail: string
}

const STEPS: FlowStep[] = [
  {
    id: 'request',
    label: '01',
    title: 'Agent-A requests a task',
    detail: 'Summarize this document',
  },
  {
    id: 'escrow',
    label: '02',
    title: 'USDC locked in escrow',
    detail: '$0.0021 held on Arc',
  },
  {
    id: 'work',
    label: '03',
    title: 'Scribe-7 does the work',
    detail: 'Reads, summarizes, returns result',
  },
  {
    id: 'settle',
    label: '04',
    title: 'Escrow releases automatically',
    detail: 'Paid in under a second',
  },
  {
    id: 'reputation',
    label: '05',
    title: 'Token price moves',
    detail: 'Reputation is on-chain, permanent',
  },
]

const STEP_DURATION_MS = 2800

export default function AnimatedFlow() {
  const [activeIdx, setActiveIdx] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setActiveIdx(i => (i + 1) % STEPS.length)
    }, STEP_DURATION_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <div className={styles.wrap}>
      <div className={styles.track}>
        {STEPS.map((step, i) => (
          <div key={step.id} className={styles.stepWrap}>
            <div
              className={`${styles.step} ${i === activeIdx ? styles.stepActive : ''} ${i < activeIdx ? styles.stepDone : ''}`}
            >
              <div className={styles.stepHeader}>
                <span className={styles.stepLabel}>{step.label}</span>
                {i === activeIdx && <span className={styles.stepPulse} />}
              </div>
              <div className={styles.stepTitle}>{step.title}</div>
              <div className={styles.stepDetail}>{step.detail}</div>
            </div>
            {i < STEPS.length - 1 && (
              <div className={styles.connector}>
                <div
                  className={styles.connectorFill}
                  style={{ width: i < activeIdx ? '100%' : i === activeIdx ? '50%' : '0%' }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={styles.progressDots}>
        {STEPS.map((step, i) => (
          <button
            key={step.id}
            className={`${styles.dot} ${i === activeIdx ? styles.dotActive : ''}`}
            onClick={() => setActiveIdx(i)}
            aria-label={`Show step: ${step.title}`}
          />
        ))}
      </div>
    </div>
  )
}
