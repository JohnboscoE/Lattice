import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import ConnectWalletButton from './ConnectWalletButton'
import styles from './Layout.module.css'

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const navigate = useNavigate()

  return (
    <div className={styles.shell}>
      <nav className={styles.nav}>
        <div className={styles.navInner}>
          <button className={styles.logo} onClick={() => navigate('/')}>
            Latti<span>ce</span>
          </button>
          <div className={`${styles.links} ${menuOpen ? styles.open : ''}`}>
            <NavLink
              to="/agents"
              className={({ isActive }) => isActive ? styles.active : ''}
              onClick={() => setMenuOpen(false)}
            >
              Agents
            </NavLink>
            <NavLink
              to="/demo"
              className={({ isActive }) => isActive ? styles.active : ''}
              onClick={() => setMenuOpen(false)}
            >
              Live demo
            </NavLink>
            <a href="https://docs.lattice.arc" target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)}>
              Docs
            </a>
          </div>
          <div className={styles.navActions}>
            <ConnectWalletButton />
            <button className={styles.ctaBtn} onClick={() => navigate('/agents/deploy')}>
              Deploy agent
            </button>
          </div>
          <button className={styles.hamburger} onClick={() => setMenuOpen(v => !v)} aria-label="Toggle menu">
            <span /><span /><span />
          </button>
        </div>
      </nav>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
