import { defineChain } from 'viem'
import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'

const ARC_RPC_URL = import.meta.env.VITE_ARC_RPC_URL ?? 'https://rpc.testnet.arc.network'

/**
 * Arc Testnet, defined explicitly rather than imported from wagmi/chains
 * since it's not (yet) part of wagmi's built-in chain list. Mirrors the
 * chain definition used on the backend (see backend/src/chain.ts) — keep
 * these in sync if either changes.
 */
export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [ARC_RPC_URL] },
  },
  blockExplorers: {
    default: { name: 'Arcscan', url: 'https://testnet.arcscan.app' },
  },
  testnet: true,
})

/**
 * Wagmi config for the "Deploy agent" flow, where the USER's own wallet
 * signs the registerAgent() transaction directly — unlike CreateTask.tsx
 * and LiveDemo.tsx, which go through the backend's Agent-A-signed write
 * path. This is the only part of the app that needs a real wallet
 * connection; everything else intentionally avoids it for simplicity.
 *
 * Only `injected()` is configured — no dedicated `metaMask()` connector.
 * In current wagmi, metaMask() requires a separate @metamask/connect-evm
 * SDK package (not installed here) and routes through MetaMask's own
 * Connect SDK rather than plain EIP-1193 injection. injected() already
 * correctly detects and connects to MetaMask via the browser's standard
 * window.ethereum / EIP-6963 provider — no extra dependency needed for
 * MetaMask specifically. Also no WalletConnect, since that requires a
 * project ID and external service dependency unnecessary for this demo.
 */
export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(ARC_RPC_URL),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
