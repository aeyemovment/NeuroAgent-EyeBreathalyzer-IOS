'use client'

import { useMemo, useState } from 'react'
import {
  C9_PROTOCOL,
  runDemoC9ResearchAnalysis,
  type C9ResearchResult,
} from './c9orf72Protocol'
import { APP_URL, COLLABORATE_URL_WITH_APP, CONTACT_PRIMARY, NON_COMMERCIAL_SHORT } from './copyright'

const styles = {
  wrap: {
    marginTop: 20,
    padding: 16,
    borderRadius: 12,
    border: '1px solid #7c3aed55',
    background: 'rgba(46, 16, 101, 0.35)',
    color: '#e2e8f0',
    fontFamily: 'system-ui, sans-serif',
  } as React.CSSProperties,
  h2: { fontSize: 18, margin: '0 0 8px', color: '#e9d5ff' } as React.CSSProperties,
  muted: { fontSize: 13, color: '#c4b5fd', lineHeight: 1.5 } as React.CSSProperties,
  warn: {
    fontSize: 12,
    color: '#fde68a',
    background: 'rgba(120,53,15,0.35)',
    border: '1px solid #854d0e',
    borderRadius: 8,
    padding: 10,
    lineHeight: 1.45,
    margin: '12px 0',
  } as React.CSSProperties,
  video: {
    width: '100%',
    borderRadius: 10,
    background: '#000',
    marginTop: 10,
    maxHeight: 280,
  } as React.CSSProperties,
  btn: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box' as const,
    marginTop: 10,
    padding: '12px 14px',
    borderRadius: 10,
    border: 'none',
    fontWeight: 700,
    fontSize: 14,
    textAlign: 'center' as const,
    textDecoration: 'none',
    cursor: 'pointer',
  },
  metric: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    padding: '6px 0',
    borderBottom: '1px solid #4c1d9555',
  } as React.CSSProperties,
}

export function C9ProtocolPanel() {
  const [result, setResult] = useState<C9ResearchResult | null>(null)
  const [ran, setRan] = useState(false)

  const bandColor = useMemo(() => {
    if (!result) return '#94a3b8'
    if (result.trialInterestBand === 'elevated') return '#f472b6'
    if (result.trialInterestBand === 'moderate') return '#fbbf24'
    return '#34d399'
  }, [result])

  function runDemo() {
    const r = runDemoC9ResearchAnalysis('eyebreathalyzer-3-demo')
    setResult(r)
    setRan(true)
    try {
      const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      // stash for download button
      ;(window as any).__C9_LAST_RESULT_URL__ = url
    } catch { /* ignore */ }
  }

  function downloadJson() {
    if (!result) return
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `opendementia-c9orf72-research-flag-${Date.now()}.json`
    a.click()
  }

  return (
    <div style={styles.wrap} id="c9orf72-protocol">
      <h2 style={styles.h2}>{C9_PROTOCOL.name}</h2>
      <p style={styles.muted}>
        <strong>Protocol:</strong> {C9_PROTOCOL.version} · {C9_PROTOCOL.mutation}
      </p>
      <p style={styles.muted}>{C9_PROTOCOL.purpose}</p>

      <div style={styles.warn}>
        <strong>Research prototype only.</strong> Does not diagnose ALS-FTD or detect C9ORF72.
        Gene-specific trial eligibility requires genetic confirmation and the trial’s inclusion
        criteria. Demo metrics from the sample OKN video are synthetic / illustrative for
        investigator workflow design.
      </div>

      <video
        style={styles.video}
        controls
        playsInline
        poster={C9_PROTOCOL.demoPoster}
        src={C9_PROTOCOL.demoVideo}
      >
        Your browser does not support video.
      </video>
      <p style={{ fontSize: 11, color: '#a78bfa', marginTop: 6 }}>
        Demo source: eyebreathalyzer OKN recording (research demo asset)
      </p>

      <button
        type="button"
        onClick={runDemo}
        style={{ ...styles.btn, background: '#a78bfa', color: '#1e1b4b' }}
      >
        {ran ? 'Re-run demo research analysis' : 'Run demo research analysis (C9 trial-interest flag)'}
      </button>

      {result && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 14, margin: '0 0 8px' }}>
            Trial-interest band (research):{' '}
            <strong style={{ color: bandColor, textTransform: 'uppercase' }}>
              {result.trialInterestBand}
            </strong>
          </p>
          <p style={styles.muted}>{result.investigatorSummary}</p>

          <div style={{ marginTop: 12 }}>
            {C9_PROTOCOL.researchFlags.map((f) => (
              <div key={f.id} style={styles.metric}>
                <span>{f.label}</span>
                <span style={{ fontFamily: 'monospace', color: '#e9d5ff' }}>
                  {result.metrics[f.id] ?? '—'}
                </span>
              </div>
            ))}
          </div>

          <h3 style={{ fontSize: 13, marginTop: 16, color: '#e9d5ff' }}>Required next steps</h3>
          <ol style={{ fontSize: 12, color: '#c4b5fd', lineHeight: 1.55, paddingLeft: 18 }}>
            {result.requiredNextSteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>

          <button
            type="button"
            onClick={downloadJson}
            style={{ ...styles.btn, background: '#334155', color: '#e2e8f0' }}
          >
            Download research JSON
          </button>
          <a
            href={C9_PROTOCOL.collaborateUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...styles.btn, background: 'linear-gradient(180deg,#62c3ff,#2ea6ff)', color: '#001227' }}
          >
            Register trial/research interest (collaborate form) →
          </a>
          <a
            href={APP_URL}
            style={{ ...styles.btn, background: '#fbbf24', color: '#1c1917' }}
          >
            OpenDementia app home →
          </a>
        </div>
      )}

      <p style={{ fontSize: 10, color: '#6b7280', marginTop: 14, lineHeight: 1.4 }}>
        {NON_COMMERCIAL_SHORT}
        <br />
        Contact: {CONTACT_PRIMARY} · Form: {COLLABORATE_URL_WITH_APP.split('?')[0]}
      </p>
    </div>
  )
}
