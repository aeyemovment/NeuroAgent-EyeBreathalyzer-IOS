import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import App from './App'
import './index.css'

// Error boundary to catch and display React render errors (especially #300)
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

/**
 * Research preview: if Clerk is not configured on Vercel, still mount the app.
 * Auth-gated features degrade gracefully (SignedOut UI / local consent).
 */
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
          Research preview · Clerk auth not configured on this deploy — local/research mode only.
          Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> on Vercel for full sign-in.
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
  // Stub minimal Clerk-less path: App still uses Clerk hooks — wrap with dummy provider pattern
  // Use a no-op by rendering AppAuthBypass instead if hooks require provider.
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ResearchShell>
        <AppBypassClerk />
      </ResearchShell>
    </React.StrictMode>,
  )
}

/**
 * When Clerk is missing, App.tsx still imports useUser/useClerk/SignedIn.
 * Provide a thin bypass shell that does not crash and lets research consent + lanes run.
 */
function AppBypassClerk() {
  // Dynamic import alternative: re-export simplified experience
  // Prefer mounting real App only under Clerk. Without Clerk, show research gate + instructions.
  return <AppResearchNoAuth />
}

function AppResearchNoAuth() {
  const [lane, setLane] = React.useState(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('lane')
      if (q === 'dementia' || q === 'rare-neuro' || q === 'autism') return q
    } catch { /* ignore */ }
    return 'autism'
  })
  const [accepted, setAccepted] = React.useState(false)

  const nonClaim =
    lane === 'dementia'
      ? 'Not a dementia diagnostic or screening tool.'
      : lane === 'rare-neuro'
        ? 'Not a clinical diagnostic tool.'
        : 'Not an autism diagnostic or screening tool.'

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
      <p style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7dd3fc' }}>
        NeuroAgent research product
      </p>
      <h1 style={{ fontSize: 28, margin: '8px 0' }}>EyeBreathalyzer</h1>
      <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.5 }}>
        HazyEyesIOS OKN / MediaPipe research app — autism, dementia, and rare neuro lanes.
        Research only · non-commercial · not for diagnosis.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '16px 0' }}>
        {(['autism', 'dementia', 'rare-neuro'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setLane(id)
              const url = new URL(window.location.href)
              url.searchParams.set('lane', id)
              window.history.replaceState({}, '', url.toString())
            }}
            style={{
              borderRadius: 999,
              border: '1px solid',
              borderColor: lane === id ? '#34d399' : '#334155',
              background: lane === id ? 'rgba(52,211,153,0.15)' : 'transparent',
              color: lane === id ? '#6ee7b7' : '#94a3b8',
              padding: '8px 12px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {id === 'rare-neuro' ? 'Rare neuro research' : id === 'dementia' ? 'Dementia research' : 'Autism research'}
          </button>
        ))}
      </div>
      <p style={{ fontSize: 12, color: '#fbbf24' }}>{nonClaim}</p>

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
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Research consent (Layer A)</h2>
          <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>
            This public deploy is in research-preview mode without Clerk. Full camera OKN protocol
            requires auth env vars on Vercel. You can accept research terms and continue to the
            protocol when Clerk is configured, or use local <code>npm run dev</code> with keys.
          </p>
          <p style={{ fontSize: 12, color: '#64748b' }}>
            Contact: info@neuroagentai.org · Modular consent master v0.9 is not auto-enrolled here.
          </p>
          <label style={{ display: 'flex', gap: 8, fontSize: 13, margin: '12px 0' }}>
            <input type="checkbox" id="c1" />
            I understand this is research-only and not for diagnosis or clinical screening.
          </label>
          <button
            type="button"
            className="btn"
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
              background: '#34d399',
              color: '#052e16',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Accept research terms
          </button>
        </div>
      ) : (
        <div
          style={{
            marginTop: 20,
            padding: 16,
            borderRadius: 12,
            border: '1px solid #065f46',
            background: 'rgba(6,78,59,0.25)',
          }}
        >
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Almost ready</h2>
          <p style={{ fontSize: 13, color: '#a7f3d0', lineHeight: 1.5 }}>
            Terms accepted for <strong>{lane}</strong> lane. Full OKN camera protocol needs Clerk +
            Supabase env on Vercel:
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
            Add those in the Vercel project settings → Environment Variables → Redeploy, and this
            page will load the full EyeBreathalyzer test UI automatically.
          </p>
          <p style={{ fontSize: 12, color: '#64748b' }}>
            GitHub: github.com/aeyemovment/NeuroAgent-EyeBreathalyzer-IOS
          </p>
        </div>
      )}
    </div>
  )
}
