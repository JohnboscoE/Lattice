import { createPublicClient, createWalletClient, http, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const ARC_RPC_URL = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network'

/**
 * Arc Testnet chain definition.
 * Per Circle's own skill docs, Arc Testnet is natively supported by Viem under
 * common chain lists, but we define it explicitly here to avoid depending on
 * viem/chains staying up to date with Arc's specific chain ID.
 */
const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [ARC_RPC_URL] },
  },
} as const

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_RPC_URL),
})

export function requireEnvAddress(key: string): Address {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Environment variable ${key} is not a valid address: ${value}`)
  }
  return value as Address
}

/**
 * Wallet client signing as Agent-A, the simulated task requester.
 *
 * Demo-only design: Agent-A is a fictional entity with no real-world funds at
 * stake, so holding its raw private key directly in backend env is an
 * acceptable simplification here. Do NOT replicate this pattern for any
 * wallet that holds real user funds — use Circle's Developer Controlled
 * Wallets SDK (or equivalent custody solution) for anything beyond a
 * disposable demo account.
 *
 * Lazily constructed so a missing AGENT_A_PRIVATE_KEY only breaks the routes
 * that actually need to sign, not the entire server at boot.
 */
let agentAWalletClient: ReturnType<typeof createWalletClient> | null = null

export function getAgentAWalletClient() {
  if (agentAWalletClient) return agentAWalletClient

  const privateKey = process.env.AGENT_A_PRIVATE_KEY
  if (!privateKey) {
    throw new Error('Missing required environment variable: AGENT_A_PRIVATE_KEY')
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
    throw new Error('AGENT_A_PRIVATE_KEY is not a valid 32-byte hex private key')
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`)

  agentAWalletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(ARC_RPC_URL),
  })

  return agentAWalletClient
}

/**
 * Serializes all Agent-A wallet writes (approve, createTask, release) through
 * a single in-process queue.
 *
 * Root cause this fixes: viem's wallet client fetches "current nonce" fresh
 * for each writeContract call. If two writes are triggered close together
 * (e.g. a manual task creation from the UI overlapping with LiveDemo's
 * auto-creation timer), both can read the same nonce before either confirms,
 * and the second submission is rejected by the node as "already known."
 *
 * This queue ensures only one write is ever in flight at a time from this
 * backend process, so each write's nonce is read only after the previous
 * write has been broadcast — eliminating the race without needing to track
 * nonces manually, which would be fragile and easy to desync from actual
 * chain state (e.g. after a server restart).
 *
 * Limitation: this only serializes writes within THIS process. If you ever
 * run multiple backend instances signing as the same wallet, this does not
 * protect against cross-process nonce collisions — you'd need a real
 * distributed nonce manager or one wallet per instance.
 */
let writeQueue: Promise<unknown> = Promise.resolve()

export function queueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(fn, fn)
  // Swallow errors in the queue chain itself so one failed write doesn't
  // permanently jam the queue for subsequent calls — the caller still sees
  // their own promise's real rejection via `result`.
  writeQueue = result.catch(() => {})
  return result
}
