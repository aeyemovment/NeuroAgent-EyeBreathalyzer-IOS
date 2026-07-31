import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import App from './App'
import './index.css'

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null; errorInfo: React.ErrorInfo | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null, errorInfo: null }
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ error, errorInfo })
    console.error('ErrorBoundary caught:', error.message)
    console.error('Component stack:', errorInfo.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'monospace', fontSize: '12px', color: '#ff6b6b', background: '#1a1a2e', minHeight: '100vh', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          <h2 style={{ color: '#fff' }}>React Render Error</h2>
          <p><strong>{this.state.error.message}</strong></p>
          <p style={{ color: '#999' }}>{this.state.errorInfo?.componentStack}</p>
        </div>
      )
    }
    return this.props.children
  }
}

const clerkPublishableKey = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '').trim()
const hasClerk = clerkPublishableKey.length > 0 && !clerkPublishableKey.includes('your_')

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element not found')
}

function ResearchShell({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      {!hasClerk && (
        <div
          style={{
            background: '#1e3a5f',
            color: '#e2e8f0',
            fontSize: 12,
            padding: '8px 12px',
            textAlign: 'center',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          OpenDementia research preview · Add VITE_CLERK_PUBLISHABLE_KEY on Vercel for full OKN sign-in.
        </div>
      )}
      {children}
    </ErrorBoundary>
  )
}

if (hasClerk) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ClerkProvider publishableKey={clerkPublishableKey}>
        <ResearchShell>
          <App />
        </ResearchShell>
      </ClerkProvider>
    </React.StrictMode>,
  )
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ResearchShell>
        <OpenDementiaLanding />
      </ResearchShell>
    </React.StrictMode>,
  )
}

/** OpenDementia landing when Clerk env is missing (so Vercel still launches). */
function OpenDementiaLanding() {
  const [accepted, setAccepted] = React.useState(false)

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0b1220',
        color: '#e2e8f0',
        fontFamily: 'system-ui, sans-serif',
        padding: '2rem 1.25rem',
        maxWidth: 520,
        margin: '0 auto',
      }}
    >
      <p style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#fbbf24' }}>
        NeuroAgent · open research
      </p>
      <h1 style={{ fontSize: 32, margin: '8px 0', fontWeight: 700 }}>OpenDementia</h1>
      <p style={{ color: '#94a3b8', fontSize: 15, lineHeight: 1.55 }}>
        Open research eye-tracking (OKN) for <strong style={{ color: '#e2e8f0' }}>dementia research</strong> organizations.
        Research only · non-commercial · not for diagnosis.
      </p>
      <p style={{ fontSize: 12, color: '#fbbf24' }}>
        Not a dementia diagnostic or screening tool. Not for clinical care.
      </p>

      {!accepted ? (
        <div
          style={{
            marginTop: 20,
            padding: 16,
            borderRadius: 12,
            border: '1px solid #334155',
            background: 'rgba(15,23,42,0.8)',
          }}
        >
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Research consent</h2>
          <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>
            I understand OpenDementia is a NeuroAgent research preview for dementia research only.
            It is not a medical device and must not be used for diagnosis or clinical screening.
          </p>
          <p style={{ fontSize: 12, color: '#64748b' }}>Contact: info@neuroagentai.org</p>
          <label style={{ display: 'flex', gap: 8, fontSize: 13, margin: '12px 0' }}>
            <input type="checkbox" id="c1" />
            I agree — research only, not diagnostic.
          </label>
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById('c1') as HTMLInputElement | null
              if (!el?.checked) {
                alert('Please accept the research checkbox to continue.')
                return
              }
              setAccepted(true)
            }}
            style={{
              width: '100%',
              marginTop: 8,
              padding: '12px',
              borderRadius: 10,
              border: 'none',
              background: '#fbbf24',
              color: '#1c1917',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Accept & continue
          </button>
        </div>
      ) : (
        <div
          style={{
            marginTop: 20,
            padding: 16,
            borderRadius: 12,
            border: '1px solid #854d0e',
            background: 'rgba(120,53,15,0.25)',
          }}
        >
          <h2 style={{ fontSize: 16, marginTop: 0 }}>OpenDementia</h2>
          <p style={{ fontSize: 13, color: '#fde68a', lineHeight: 1.5 }}>
            Terms accepted. Full camera OKN protocol needs Clerk + Supabase on Vercel:
          </p>
          <ul style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
            <li>
              <code>VITE_CLERK_PUBLISHABLE_KEY</code>
            </li>
            <li>
              <code>VITE_SUPABASE_URL</code> / <code>VITE_SUPABASE_ANON_KEY</code>
            </li>
          </ul>
          <p style={{ fontSize: 13, color: '#e2e8f0' }}>
            After env is set and redeployed, the full OKN test UI loads automatically.
          </p>
          <p style={{ fontSize: 12, color: '#64748b' }}>
            info@neuroagentai.org
          </p>
        </div>
      )}
    </div>
  )
}
