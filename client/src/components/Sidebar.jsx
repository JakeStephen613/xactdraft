import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

export default function Sidebar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  function isActive(to) {
    if (to === '/dashboard') return pathname === '/dashboard' || pathname.startsWith('/jobs/')
    return pathname.startsWith(to)
  }

  return (
    <aside style={s.aside}>
      <div style={s.top}>
        <Link to="/dashboard" style={s.wordmark}>XactDraft</Link>

        <p style={s.sectionLabel}>Workspace</p>
        <nav style={s.nav}>
          <Link to="/dashboard" className={isActive('/dashboard') ? 'nav-link nav-link-active' : 'nav-link'}>
            Jobs
          </Link>
          <Link to="/upload" className={isActive('/upload') ? 'nav-link nav-link-active' : 'nav-link'}>
            New job
          </Link>
        </nav>
      </div>

      <div style={s.bottom}>
        <div style={s.divider} />
        <button onClick={signOut} className="nav-link">
          Sign out
        </button>
      </div>
    </aside>
  )
}

const s = {
  aside: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: 220,
    height: '100vh',
    background: '#18181b',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '20px 14px',
    zIndex: 50,
  },
  top: {},
  wordmark: {
    display: 'block',
    fontSize: 15,
    fontWeight: 600,
    color: '#fff',
    textDecoration: 'none',
    letterSpacing: '-0.02em',
    padding: '6px 10px',
    marginBottom: 28,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 500,
    color: '#52525b',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    padding: '0 10px',
    marginBottom: 6,
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  bottom: {},
  divider: {
    height: 1,
    background: '#27272a',
    margin: '0 10px 10px',
  },
}
