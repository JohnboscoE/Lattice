import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useConnection,
  useChainId,
  useSwitchChain,
  useWriteContract,
  useWaitForTransactionReceipt,
  type BaseError,
} from 'wagmi'
import { parseEventLogs, type Log } from 'viem'
import { arcTestnet } from '../lib/wagmi'
import styles from './DeployAgent.module.css'

/**
 * Minimal ABI for registerAgent — matches contracts/src/AgentFactory.sol.
 * Hand-written rather than imported from a compiled artifact, consistent
 * with the backend's abi.ts approach: only the functions/events actually
 * used here, kept auditable at a glance.
 */
const AGENT_FACTORY_ABI = [
  {
    type: 'function',
    name: 'registerAgent',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'agentType', type: 'string' },
      { name: 'operator', type: 'address' },
    ],
    outputs: [
      { name: 'agentId', type: 'bytes32' },
      { name: 'token', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'AgentRegistered',
    inputs: [
      { name: 'agentId', type: 'bytes32', indexed: true },
      { name: 'operator', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: false },
      { name: 'name', type: 'string', indexed: false },
    ],
  },
] as const

// Same address as backend/.env's AGENT_FACTORY_ADDRESS — kept as a frontend
// constant since this page talks to the contract directly, not through the
// backend API.
const AGENT_FACTORY_ADDRESS = (import.meta.env.VITE_AGENT_FACTORY_ADDRESS ??
  '0x80dCdAA7ab2dd9bE1fA4F5ac52B51A42186C3E12') as `0x${string}`

interface RegisteredAgentResult {
  agentId: string
  tokenAddress: string
}

export default function DeployAgent() {
  const navigate = useNavigate()
  const { address, isConnected } = useConnection()
  const chainId = useChainId()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const isWrongChain = isConnected && chainId !== arcTestnet.id

  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [agentType, setAgentType] = useState('')
  const [result, setResult] = useState<RegisteredAgentResult | null>(null)

  const { writeContract, data: hash, isPending, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, data: receipt } = useWaitForTransactionReceipt({ hash })

  // Once the receipt arrives, decode the AgentRegistered event to get the
  // real agentId and token address — same pattern as the backend's
  // createTask flow: never trust a simulated return value, always decode
  // from the actual mined transaction's logs.
  if (receipt && !result) {
    const events = parseEventLogs({
      abi: AGENT_FACTORY_ABI,
      eventName: 'AgentRegistered',
      logs: receipt.logs as Log[],
    })
    const event = events[0]
    if (event) {
      setResult({
        agentId: event.args.agentId,
        tokenAddress: event.args.token,
      })
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!address || !name.trim() || !symbol.trim() || !agentType.trim() || isWrongChain) return

    writeContract({
      address: AGENT_FACTORY_ADDRESS,
      abi: AGENT_FACTORY_ABI,
      functionName: 'registerAgent',
      args: [name.trim(), symbol.trim(), agentType.trim(), address],
    })
  }

  if (result) {
    return (
      <div className={styles.page}>
        <div className={styles.successWrap}>
          <div className={styles.successIcon}>✓</div>
          <h2 className={styles.successTitle}>Agent deployed</h2>
          <p className={styles.successSub}>{name} is now live on Arc Testnet</p>
          <div className={styles.successDetails}>
            <div className={styles.successRow}>
              <span>Agent ID</span>
              <code>{result.agentId.slice(0, 10)}…{result.agentId.slice(-8)}</code>
            </div>
            <div className={styles.successRow}>
              <span>Token contract</span>
              <a
                href={`https://testnet.arcscan.app/address/${result.tokenAddress}`}
                target="_blank"
                rel="noreferrer"
                className={styles.explorerLink}
              >
                {result.tokenAddress.slice(0, 10)}…{result.tokenAddress.slice(-6)} ↗
              </a>
            </div>
          </div>
          <p className={styles.indexingNote}>
            Your agent's bonding curve token launched at a $4,000 starting market cap, same as every agent on Lattice.
          </p>
          <div className={styles.successActions}>
            <button className={styles.submitBtn} onClick={() => navigate('/agents')}>
              View agent directory
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
        <h1 className={styles.title}>Deploy an agent</h1>
        <p className={styles.sub}>
          Register your agent on Lattice. A bonding curve token deploys automatically —
          starting market cap $4,000 USDC, graduation at $4,020.
        </p>

        {!isConnected && (
          <div className={styles.connectPrompt}>
            <p>Connect a wallet to deploy an agent. The connected wallet becomes the agent's operator and receives all task payments.</p>
          </div>
        )}

        {isWrongChain && (
          <div className={styles.chainWarning}>
            <p>
              Your wallet is connected to a different network. Switch to <strong>Arc Testnet</strong> to deploy an agent.
            </p>
            <button
              className={styles.switchBtn}
              onClick={() => switchChain({ chainId: arcTestnet.id })}
              disabled={isSwitching}
              type="button"
            >
              {isSwitching ? 'Switching…' : 'Switch to Arc Testnet'}
            </button>
          </div>
        )}

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label}>Agent name</label>
            <input
              className={styles.input}
              placeholder="e.g. Fetch-3"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={!isConnected || isWrongChain}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Token symbol</label>
            <input
              className={styles.input}
              placeholder="e.g. FTCH3"
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              maxLength={11}
              disabled={!isConnected || isWrongChain}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Agent type</label>
            <input
              className={styles.input}
              placeholder="e.g. data-retrieval"
              value={agentType}
              onChange={e => setAgentType(e.target.value)}
              disabled={!isConnected || isWrongChain}
            />
          </div>

          {isConnected && address && (
            <div className={styles.operatorBox}>
              <span className={styles.operatorLabel}>Operator (your connected wallet)</span>
              <code className={styles.operatorAddr}>{address}</code>
            </div>
          )}

          {writeError && (
            <div className={styles.errorBox}>
              {(writeError as BaseError).shortMessage ?? writeError.message}
            </div>
          )}

          <button
            type="submit"
            className={styles.submitBtn}
            disabled={!isConnected || isWrongChain || !name.trim() || !symbol.trim() || !agentType.trim() || isPending || isConfirming}
          >
            {isPending ? 'Confirm in wallet…' : isConfirming ? 'Deploying on Arc…' : 'Deploy agent'}
          </button>
        </form>
      </div>
    </div>
  )
}
