import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import App from './App'
import {
  APP_URL,
  COLLABORATE_CTA,
  COLLABORATE_URL_WITH_APP,
  CONTACT_PRIMARY,
  COPYRIGHT_LINE,
  LICENSE_NAME,
  NON_COMMERCIAL_NOTICE,
  NON_COMMERCIAL_SHORT,
} from './copyright'
import { C9ProtocolPanel } from './C9ProtocolPanel'
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
          OpenDementia · You are on the app ({APP_URL}). Full OKN sign-in needs Clerk env on Vercel.
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

const btnPrimary: React.CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 10,
  padding: '14px 16px',
  borderRadius: 12,
  border: 'none',
  fontWeight: 700,
  fontSize: 15,
  textAlign: 'center',
  textDecoration: 'none',
  cursor: 'pointer',
}

/** OpenDementia landing when Clerk env is missing (so Vercel still launches). */
function OpenDementiaLanding() {
  const [accepted, setAccepted] = React.useState(() => {
    try {
      return localStorage.getItem('opendementia_terms_v1') === '1'
    } catch {
      return false
    }
  })

  function acceptTerms() {
    const el = document.getElementById('c1') as HTMLInputElement | null
    const el2 = document.getElementById('c2') as HTMLInputElement | null
    if (!el?.checked || !el2?.checked) {
      alert('Please accept both research and non-commercialization checkboxes.')
      return
    }
    try {
      localStorage.setItem('opendementia_terms_v1', '1')
    } catch { /* ignore */ }
    setAccepted(true)
  }

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
        You are on the <strong style={{ color: '#e2e8f0' }}>OpenDementia app</strong> — open research
        eye-tracking (OKN) for dementia research organizations. In research use, it may{' '}
        <strong style={{ color: '#e2e8f0' }}>
          surface OKN / eye-movement impairment-pattern signals associated with some dementia subtypes
        </strong>{' '}
        and help researchers{' '}
        <strong style={{ color: '#e2e8f0' }}>prioritize patients for referral to targeted genetic testing</strong>{' '}
        (e.g. C9ORF72 ALS-FTD pathways for gene-specific trials). Not a genetic test.
      </p>
      <p style={{ fontSize: 13, color: '#7dd3fc' }}>
        App link:{' '}
        <a href={APP_URL} style={{ color: '#7dd3fc' }}>
          {APP_URL}
        </a>
      </p>
      <p style={{ fontSize: 12, color: '#fbbf24' }}>
        Research prototype only. Not a clinical diagnosis of any dementia subtype. Not for clinical care.
      </p>
      <p
        style={{
          fontSize: 11,
          color: '#94a3b8',
          lineHeight: 1.45,
          marginTop: 12,
          padding: 12,
          borderRadius: 8,
          border: '1px solid #334155',
          background: 'rgba(15,23,42,0.6)',
        }}
      >
        {NON_COMMERCIAL_NOTICE}
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
          <h2 style={{ fontSize: 16, marginTop: 0 }}>1) Enter the OpenDementia app</h2>
          <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>
            Accept terms to continue in this app. Research only · not diagnostic.
          </p>
          <label style={{ display: 'flex', gap: 8, fontSize: 13, margin: '12px 0' }}>
            <input type="checkbox" id="c1" />
            I agree — research only, not diagnostic.
          </label>
          <label style={{ display: 'flex', gap: 8, fontSize: 13, margin: '12px 0' }}>
            <input type="checkbox" id="c2" />
            I accept the non-commercialization copyright terms.
          </label>
          <button type="button" onClick={acceptTerms} style={{ ...btnPrimary, background: '#fbbf24', color: '#1c1917' }}>
            Continue in OpenDementia app →
          </button>

          <h2 style={{ fontSize: 16, marginTop: 28 }}>2) Also register as a collaborator</h2>
          <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>
            Please fill out the NeuroAgent form (opens in a new tab). Then come back to the app
            link above.
          </p>
          <a
            href={COLLABORATE_URL_WITH_APP}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...btnPrimary, background: 'linear-gradient(180deg,#62c3ff,#2ea6ff)', color: '#001227' }}
          >
            Open collaborate form →
          </a>
          <p style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
            After the form, return to the app: {APP_URL}
          </p>
        </div>
      ) : (
        <div
          style={{
            marginTop: 20,
            padding: 16,
            borderRadius: 12,
            border: '1px solid #065f46',
            background: 'rgba(6,78,59,0.3)',
          }}
        >
          <h2 style={{ fontSize: 16, marginTop: 0 }}>You are in OpenDementia</h2>
          <p style={{ fontSize: 13, color: '#a7f3d0', lineHeight: 1.5 }}>
            Terms accepted. This page <strong>is</strong> the app. Bookmark it:
          </p>
          <a
            href={APP_URL}
            style={{ ...btnPrimary, background: '#34d399', color: '#052e16' }}
          >
            OpenDementia app home → {APP_URL.replace('https://', '')}
          </a>

          <p style={{ fontSize: 13, color: '#e2e8f0', marginTop: 18, lineHeight: 1.5 }}>
            Full camera OKN protocol needs Clerk + Supabase on Vercel (optional for research landing):
          </p>
          <ul style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
            <li>
              <code>VITE_CLERK_PUBLISHABLE_KEY</code>
            </li>
            <li>
              <code>VITE_SUPABASE_URL</code> / <code>VITE_SUPABASE_ANON_KEY</code>
            </li>
          </ul>

          <C9ProtocolPanel />

          <h3 style={{ fontSize: 14, marginTop: 20 }}>Collaborator registration</h3>
          <p style={{ fontSize: 12, color: '#94a3b8' }}>
            Have your lab fill this out (new tab). It does not replace the app link.
          </p>
          <a
            href={COLLABORATE_URL_WITH_APP}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...btnPrimary, background: 'linear-gradient(180deg,#62c3ff,#2ea6ff)', color: '#001227' }}
          >
            Fill collaborate form →
          </a>
          <p style={{ fontSize: 11, color: '#64748b', marginTop: 10 }}>
            Return to app anytime: <a href={APP_URL} style={{ color: '#7dd3fc' }}>{APP_URL}</a>
          </p>
          <p style={{ fontSize: 11, color: '#64748b', marginTop: 12 }}>{NON_COMMERCIAL_SHORT}</p>
          <p style={{ fontSize: 12, color: '#64748b' }}>{CONTACT_PRIMARY}</p>
        </div>
      )}
      <footer style={{ marginTop: 28, fontSize: 10, color: '#475569', lineHeight: 1.4 }}>
        {COPYRIGHT_LINE}
        <br />
        {LICENSE_NAME}
        <br />
        App: {APP_URL}
        <br />
        {COLLABORATE_CTA}
      </footer>
    </div>
  )
}
