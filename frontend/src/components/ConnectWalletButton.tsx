import { useConnection, useConnect, useDisconnect, useChainId, useSwitchChain } from 'wagmi'
import { useState, useRef, useEffect } from 'react'
import { arcTestnet } from '../lib/wagmi'
import styles from './ConnectWalletButton.module.css'

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export default function ConnectWalletButton() {
  const { address, isConnected } = useConnection()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const chainId = useChainId()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const isWrongChain = isConnected && chainId !== arcTestnet.id

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (isConnected && address) {
    return (
      <div className={styles.wrap} ref={menuRef}>
        <button
          className={isWrongChain ? styles.wrongChainBtn : styles.connectedBtn}
          onClick={() => setMenuOpen(v => !v)}
        >
          <span className={isWrongChain ? styles.dotWarning : styles.dot} />
          {isWrongChain ? 'Wrong network' : shortenAddress(address)}
        </button>
        {menuOpen && (
          <div className={styles.menu}>
            {isWrongChain && (
              <button
                className={styles.menuItemHighlight}
                onClick={() => {
                  switchChain({ chainId: arcTestnet.id })
                  setMenuOpen(false)
                }}
                disabled={isSwitching}
              >
                {isSwitching ? 'Switching…' : 'Switch to Arc Testnet'}
              </button>
            )}
            <button
              className={styles.menuItem}
              onClick={() => {
                disconnect()
                setMenuOpen(false)
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    )
  }

  const hasConnector = connectors.length > 0

  return (
    <div className={styles.wrap} ref={menuRef}>
      <button
        className={styles.connectBtn}
        onClick={() => setMenuOpen(v => !v)}
        disabled={!hasConnector}
        title={!hasConnector ? 'No wallet detected — install MetaMask or another browser wallet' : undefined}
      >
        {isPending ? 'Connecting…' : 'Connect wallet'}
      </button>
      {menuOpen && hasConnector && (
        <div className={styles.menu}>
          {connectors.map(connector => (
            <button
              key={connector.uid}
              className={styles.menuItem}
              onClick={() => {
                connect({ connector })
                setMenuOpen(false)
              }}
            >
              {connector.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
