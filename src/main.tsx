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

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element not found')
}

if (!clerkPublishableKey) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <div style={{ padding: '2rem', fontFamily: 'sans-serif', lineHeight: 1.5 }}>
        <h1>Missing Clerk configuration</h1>
        <p>Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> in your environment to enable authentication.</p>
      </div>
    </React.StrictMode>
  )
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <ClerkProvider publishableKey={clerkPublishableKey}>
          <App />
        </ClerkProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  )
}
