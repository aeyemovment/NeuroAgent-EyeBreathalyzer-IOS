import { SignedIn, SignedOut, SignInButton, UserButton, useClerk, useUser } from '@clerk/clerk-react'
import { useEffect, useRef, useState, useCallback } from 'react'
import type { UIEvent } from 'react'
import { createClient } from '@supabase/supabase-js'
import { parseUploadEvent, resolveBacAction } from './okn-core/uploadHelpers'
import type { UploadPhase } from './okn-core/uploadHelpers'
import { runBaselineGate } from './okn-core/baselineGate'
import type { BaselineMLSession } from './okn-core/baselineGate'
import { DEFAULT_LANE, RESEARCH_LANES, type ResearchLaneId } from './researchLanes'
import './styles.css'

declare global {
  interface Window {
    startTest: () => void
    resetTest: () => void
  }
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''
const supabaseBucket = import.meta.env.VITE_SUPABASE_BUCKET ?? 'okn-results'
const supabaseClient = (supabaseUrl && supabaseAnonKey) ? createClient(supabaseUrl, supabaseAnonKey) : null

const isIOSSafari = () => {
  const ua = navigator.userAgent
  return /iP(hone|ad|od)/.test(ua) && /WebKit/.test(ua) && !/(CriOS|FxiOS|OPiOS|EdgiOS)/.test(ua)
}
const isStandalone = () =>
  (window.navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches

function App() {
  const [testPhase, setTestPhase] = useState<'idle' | 'camera' | 'results'>('idle')
  const [testResult, setTestResult] = useState<any>(null)
  const [csvVisible, setCsvVisible] = useState(false)
  const [showA2HS, setShowA2HS] = useState(false)
  const [cameraPosition, setCameraPosition] = useState('')
  const [subjectNumber, setSubjectNumber] = useState('')
  const [bacValue, setBacValue] = useState('')
  const [selfReportLabel, setSelfReportLabel] = useState<'' | 'sober' | 'drunk'>('')
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [feedbackText, setFeedbackText] = useState('')
  const [feedbackStatus, setFeedbackStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [feedbackError, setFeedbackError] = useState<string | null>(null)
  const [isLandscape, setIsLandscape] = useState(() => window.innerWidth > window.innerHeight)
  const [consentChoice, setConsentChoice] = useState<'accepted' | 'declined' | null>(null)
  const [consentVisible, setConsentVisible] = useState(false)
  const [consentLoading, setConsentLoading] = useState(true)
  const [consentScrolledToEnd, setConsentScrolledToEnd] = useState(false)
  const [consentChecked, setConsentChecked] = useState(false)
  const [researchLane] = useState<ResearchLaneId>(DEFAULT_LANE)
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle')
  const [uploadRowId, setUploadRowId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pendingMetadata, setPendingMetadata] = useState<Record<string, any> | null>(null)
  const [activeTab, setActiveTab] = useState<'test' | 'settings'>('test')
  // Baseline workflow state
  const [baselineStatus, setBaselineStatus] = useState<'loading' | 'none' | 'needs_second' | 'exists' | 'error'>('loading')
  const [baselineSessions, setBaselineSessions] = useState<Array<Record<string, number>>>([])
  const [sessionType, setSessionType] = useState<'baseline' | 'test'>('test')
  const [soberConfirmed, setSoberConfirmed] = useState(false)
  const [baselineAttempts, setBaselineAttempts] = useState(0)
  const MIN_BASELINES = 5
  const [calibrationStep, setCalibrationStep] = useState<number>(0) // 0=not started, N=N baselines done
  const { isLoaded: isUserLoaded, isSignedIn, user } = useUser()
  const { signOut } = useClerk()
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? null
  const consentCardRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (isIOSSafari() && !isStandalone()) setShowA2HS(true)
  }, [])

  useEffect(() => {
    const checkOrientation = () => setIsLandscape(window.innerWidth > window.innerHeight)
    window.addEventListener('resize', checkOrientation)
    window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 100))
    return () => {
      window.removeEventListener('resize', checkOrientation)
      window.removeEventListener('orientationchange', () => {})
    }
  }, [])

  // Re-trigger canvas resize after camera phase mounts — fixes pixel blur from zero-sized init
  useEffect(() => {
    if (testPhase !== 'camera') return
    const raf = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'))
    })
    return () => cancelAnimationFrame(raf)
  }, [testPhase])

  // Sync consent choice to window global so app.js can access it
  useEffect(() => {
    ;(window as any).__CONSENT_CHOICE__ = consentChoice
  }, [consentChoice])

  useEffect(() => {
    ;(window as any).__USER_EMAIL__ = userEmail ?? null
  }, [userEmail])

  // NOTE: Do NOT sync sessionType to window.__SESSION_TYPE__ via useEffect.
  // The async nature of React state creates a race condition where the effect
  // overwrites the direct window.__SESSION_TYPE__ = 'baseline' set in handleStartBaseline.
  // Instead, window.__SESSION_TYPE__ is set directly in handleStartBaseline/handleStartRegularTest.

  // Query Supabase for user's sober baseline after consent accepted
  useEffect(() => {
    if (!isUserLoaded || !isSignedIn || !userEmail || !supabaseClient) {
      setBaselineStatus('loading')
      return
    }
    if (consentChoice !== 'accepted') {
      setBaselineStatus('loading')
      return
    }

    const fetchBaseline = async () => {
      setBaselineStatus('loading')
      try {
        // Fetch baseline sessions (need 5 for floor-normalized z-scoring)
        const { data, error } = await supabaseClient
          .from('okn_results_v2')
          .select('ml_features')
          .eq('user_id', userEmail)
          .eq('session_type', 'baseline')
          .order('created_at', { ascending: false })
          .limit(10)

        if (error) {
          console.warn('Baseline query failed:', error)
          setBaselineStatus('error')
          return
        }

        // Filter to v2+ baselines only
        const v2Sessions = (data || [])
          .filter((r: any) => r.ml_features && r.ml_features._version >= 7) // v7: 5-baseline floor model. Reject v6 and earlier.
          .map((r: any) => r.ml_features)

        if (v2Sessions.length >= MIN_BASELINES) {
          // 5+ baselines: full personalized classifier with floor-normalized z-scores
          setBaselineStatus('exists')
          setBaselineSessions(v2Sessions)
          ;(window as any).__BASELINE_FEATURES__ = v2Sessions
        } else if (v2Sessions.length >= 1) {
          // 1-4 baselines: need more calibration tests
          setBaselineStatus('needs_second')
          setBaselineSessions(v2Sessions)
          setCalibrationStep(v2Sessions.length)
        } else {
          // Check localStorage for pending baselines
          const pending = localStorage.getItem('hazyeyes_pending_baseline')
          if (pending) {
            try {
              const parsed = JSON.parse(pending)
              const v4Sessions = (parsed.sessions || []).filter((s: any) => s._version >= 7)
              if (parsed.email === userEmail && v4Sessions.length >= MIN_BASELINES) {
                setBaselineStatus('exists')
                setBaselineSessions(v4Sessions)
                ;(window as any).__BASELINE_FEATURES__ = v4Sessions
                return
              } else if (parsed.email === userEmail && v4Sessions.length >= 1) {
                setBaselineStatus('needs_second')
                setBaselineSessions(v4Sessions)
                setCalibrationStep(v4Sessions.length)
                return
              }
            } catch (_e) { /* ignore corrupt localStorage */ }
          }
          setBaselineStatus('none')
        }
      } catch (_e) {
        console.warn('Baseline query exception')
        setBaselineStatus('error')
      }
    }

    fetchBaseline()
  }, [isUserLoaded, isSignedIn, userEmail, consentChoice])

  useEffect(() => {
    document.title = 'OpenDementia — NeuroAgent Research'

    // Initialize Supabase for anon uploads (no Clerk auth)
    if (supabaseClient) {
      ;(window as any).__SUPABASE_CLIENT__ = supabaseClient
      ;(window as any).__SUPABASE_CONFIG__ = {
        url: supabaseUrl,
        anonKey: supabaseAnonKey,
        bucket: supabaseBucket
      }
      console.log('Supabase client initialized (anon, no auth)')
    } else {
      console.warn('Supabase not configured — uploads disabled')
      delete (window as any).__SUPABASE_CLIENT__
      delete (window as any).__SUPABASE_CONFIG__
    }
    const loadAppScript = () => {
      const existingScript = document.querySelector('script[id="okn-app-script"]')
      if (existingScript) existingScript.remove()

      const cacheBuster = import.meta.env.DEV ? `?t=${Date.now()}` : ''
      const script = document.createElement('script')
      script.src = `/app.js${cacheBuster}`
      script.type = 'text/javascript'
      script.id = 'okn-app-script'
      script.onload = () => {
        console.log('app.js loaded')
        setTimeout(() => window.dispatchEvent(new Event('resize')), 100)
      }
      script.onerror = (error) => console.error('Failed to load app.js:', error)
      document.body.appendChild(script)
    }

    loadAppScript()

    if (import.meta.env.DEV) {
      ;(window as any).reloadAppJS = () => {
        delete (window as any).__OKN_APP_INITIALIZED__
        loadAppScript()
      }
    }

    return () => {
      const video = document.getElementById('video') as HTMLVideoElement
      if (video?.srcObject) {
        const stream = video.srcObject as MediaStream
        stream.getTracks().forEach(track => track.stop())
      }
    }
  }, [])

  // Listen for test-complete event from app.js
  useEffect(() => {
    const handleTestComplete = (event: CustomEvent) => {
      console.log('Test complete:', event.detail)
      setTestResult(event.detail)
      setTestPhase('results')
      // Reset upload state for new test
      setUploadPhase('idle')
      setUploadRowId(null)
      setUploadError(null)
      setPendingMetadata(null)
    }
    window.addEventListener('test-complete', handleTestComplete as EventListener)
    return () => window.removeEventListener('test-complete', handleTestComplete as EventListener)
  }, [])

  // Listen for upload-state-change events from app.js
  useEffect(() => {
    const handleUploadState = (event: CustomEvent) => {
      const status = parseUploadEvent(event.detail ?? {})
      setUploadPhase(status.phase)
      setUploadRowId(status.supabaseRowId)
      setUploadError(status.error)
    }
    window.addEventListener('upload-state-change', handleUploadState as EventListener)
    return () => window.removeEventListener('upload-state-change', handleUploadState as EventListener)
  }, [])

  useEffect(() => {
    if (!isUserLoaded) return

    if (!isSignedIn) {
      setConsentChoice(null)
      setConsentVisible(false)
      setConsentLoading(false)
      return
    }

    if (!supabaseClient || !userEmail) {
      setConsentLoading(false)
      setConsentVisible(true)
      return
    }

    const fetchConsent = async () => {
      setConsentLoading(true)
      try {
        const { data, error } = await supabaseClient
          .from('user_consent')
          .select('accepted')
          .eq('user_email', userEmail)
          .maybeSingle()

        if (error) {
          console.warn('Could not fetch consent state:', error)
          setConsentVisible(true)
          setConsentLoading(false)
          return
        }

        if (data && typeof data.accepted === 'boolean') {
          setConsentChoice(data.accepted ? 'accepted' : 'declined')
          setConsentVisible(!data.accepted)
        } else {
          setConsentVisible(true)
        }
      } catch (error) {
        console.warn('Failed to fetch consent state:', error)
        setConsentVisible(true)
      } finally {
        setConsentLoading(false)
      }
    }

    fetchConsent()
  }, [isUserLoaded, isSignedIn, supabaseClient, userEmail])

  useEffect(() => {
    if (consentVisible) {
      setConsentScrolledToEnd(false)
      setConsentChecked(false)
      requestAnimationFrame(() => {
        const el = consentCardRef.current
        if (el && el.scrollHeight <= el.clientHeight + 1) {
          setConsentScrolledToEnd(true)
        }
      })
    }
  }, [consentVisible])

  const handleConsentScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 4) {
      setConsentScrolledToEnd(true)
    }
  }

  const persistConsentChoice = async (accepted: boolean) => {
    if (!supabaseClient || !userEmail) return
    try {
      const { error } = await supabaseClient
        .from('user_consent')
        .upsert({ user_email: userEmail, accepted, accepted_at: new Date().toISOString() })
      if (error) {
        console.warn('Could not persist consent choice:', error)
      }
    } catch (error) {
      console.warn('Failed to persist consent choice:', error)
    }
  }

  const setConsentFromSettings = (choice: 'accepted' | 'declined') => {
    setConsentChoice(choice)
    setConsentVisible(false)
    setConsentChecked(choice === 'accepted')
    void persistConsentChoice(choice === 'accepted')
  }

  const handleStartBaseline = () => {
    // Sober confirmation only required for first calibration (baselineStatus='none')
    // For second calibration (needs_second), user already confirmed
    if (baselineStatus === 'none' && !soberConfirmed) return
    setSessionType('baseline')
    ;(window as any).__SESSION_TYPE__ = 'baseline'
    handleStartTest()
  }

  const handleStartRegularTest = () => {
    setSessionType('test')
    ;(window as any).__SESSION_TYPE__ = 'test'
    handleStartTest()
  }

  const handleStartTest = () => {
    if (!isSignedIn) {
      console.warn('Sign-in required before starting the test.')
      return
    }
    if (consentLoading) {
      console.warn('Consent status still loading...')
      return
    }
    if (!consentChoice) {
      setConsentVisible(true)
      return
    }
    // Guard: __SESSION_TYPE__ must be explicitly set by handleStartBaseline or handleStartRegularTest
    if (!(window as any).__SESSION_TYPE__) {
      console.error('Bug: handleStartTest called without __SESSION_TYPE__ set. Refusing to start.')
      return
    }

    // Apply test-active body class
    const style = document.createElement('style')
    style.id = 'test-state-style'
    style.textContent = `body.test-active { overflow: hidden; }`
    document.head.appendChild(style)
    ;(window as any).cleanupTestState = () => {
      document.getElementById('test-state-style')?.remove()
    }

    setTestPhase('camera')
    document.body.classList.add('test-active')

    // Request fullscreen to hide browser chrome
    try {
      const el = document.documentElement as any
      const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen
      if (rfs) rfs.call(el).catch(() => {})
    } catch (_) {}

    // Try to lock landscape
    try {
      if (screen.orientation && typeof screen.orientation.lock === 'function') {
        screen.orientation.lock('landscape').catch(() => {})
      }
    } catch (_) {}

    // Wait for video element then start
    setTimeout(() => {
      const waitForVideo = () => {
        const videoEl = document.getElementById('video')
        if (videoEl) {
          if (window.startTest) {
            window.startTest()
          } else {
            setTimeout(() => window.startTest?.(), 100)
          }
        } else {
          setTimeout(waitForVideo, 100)
        }
      }
      waitForVideo()
    }, 200)
  }

  const handleFinish = () => {
    try {
      ;(window as any).cleanupTestState?.()
      window.resetTest?.()
    } catch (_) {}

    // Exit fullscreen
    try {
      const doc = document as any
      const efs = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen
      if (efs && doc.fullscreenElement || doc.webkitFullscreenElement) efs.call(doc)
    } catch (_) {}

    setTestPhase('idle')
    setTestResult(null)
    setCsvVisible(false)
    setCameraPosition('')
    setSubjectNumber('')
    setBacValue('')
    setSelfReportLabel('')
    setSubmitStatus('idle')
    setSubmitError(null)
    setUploadPhase('idle')
    setUploadRowId(null)
    setUploadError(null)
    setPendingMetadata(null)
    setFeedbackText('')
    setFeedbackStatus('idle')
    setFeedbackError(null)
    setSessionType('test')
    ;(window as any).__SESSION_TYPE__ = 'test'
    setSoberConfirmed(false)
    // Don't reset calibrationStep or baselineSessions here — they persist across tests
    document.body.classList.remove('test-active')

    try {
      if (screen.orientation && typeof screen.orientation.unlock === 'function') {
        screen.orientation.unlock()
      }
    } catch (_) {}
  }

  // Submit metadata to Supabase row — used directly and by auto-submit
  // IMPORTANT: All hooks must be above early returns (camera/results phase) to satisfy React's rules of hooks
  const submitMetadataToRow = useCallback(async (rowId: string, payload: Record<string, any>) => {
    if (!supabaseClient) {
      setSubmitError('Supabase is not configured.')
      setSubmitStatus('error')
      return
    }
    setSubmitStatus('submitting')
    try {
      const { error, data } = await supabaseClient
        .from('okn_results_v2')
        .update(payload)
        .eq('id', rowId)
        .select('id')

      if (error) {
        console.error('okn_results_v2 update failed:', error)
        setSubmitStatus('error')
        setSubmitError(`Could not save: ${error.message}`)
        return
      }

      if (!data || data.length === 0) {
        console.warn('okn_results_v2 update matched 0 rows', { supabaseRowId: rowId })
        setSubmitStatus('error')
        setSubmitError('Update was blocked. Check that okn_results_v2 allows updates (RLS).')
        return
      }

      console.log('okn_results_v2 updated successfully:', data)
      setSubmitStatus('success')
      setPendingMetadata(null)
    } catch (err) {
      console.error('okn_results_v2 update exception:', err)
      setSubmitStatus('error')
      setSubmitError('Could not save. Please try again.')
    }
  }, [supabaseClient])

  // Auto-submit pending metadata when upload completes
  useEffect(() => {
    if (uploadPhase === 'complete' && uploadRowId && pendingMetadata && submitStatus !== 'submitting') {
      void submitMetadataToRow(uploadRowId, pendingMetadata)
    }
  }, [uploadPhase, uploadRowId, pendingMetadata, submitMetadataToRow, submitStatus])

  // --- Camera phase ---
  if (testPhase === 'camera') {
    return (
      <div className="test-camera test-camera--landscape">
        <div className="test-camera__view test-camera__view--landscape">
          <video id="video" playsInline autoPlay muted></video>
          <canvas
            id="eyeCanvas"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 2, background: 'transparent', pointerEvents: 'none' }}
          ></canvas>
          <canvas
            id="oknCanvas"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 3, background: 'transparent', pointerEvents: 'none' }}
          ></canvas>

          <div id="trackingTag" className="tag">Starting...</div>
          <div id="overlayInstruction" className="overlay-instruction hidden"></div>
          <div id="calibCountdown" className="calib-countdown hidden"></div>

          <div className="calibration-overlay">
            <div className="calibration-content">
              <div className="calibration-text" id="calibrationText"></div>
              <div className="calibration-instruction" id="calibrationInstruction"></div>
            </div>
          </div>
        </div>

        <div className="test-camera__hud">
        </div>
      </div>
    )
  }

  // --- Results phase ---
  if (testPhase === 'results' && testResult) {
    // Baseline session: validate quality and store, or show retry
    if (sessionType === 'baseline') {
      const rawFeatures = testResult.baselineRawFeatures

      // Tier 1: existing passQuality (tracking quality from app.js)
      if (!testResult.passQuality) {
        return (
          <div className="results-screen-ios">
            <div className="results-header-ios"><h1>Calibration Results</h1></div>
            <div className="results-content-ios">
              <section className="outcome-panel risk-medium">
                <p className="outcome-label">Calibration Needs Retry</p>
                <h2 className="outcome-value">Tracking Quality Too Low</h2>
              </section>
              <p style={{ padding: '0 16px', color: '#ccc' }}>
                {testResult.retryReason || 'Tracking quality was below threshold. Please retry with better lighting and keep your head still.'}
              </p>
            </div>
            <div className="results-actions-ios">
              <button className="btn primary large" onClick={() => { setBaselineAttempts(a => a + 1); handleFinish() }}>Retry Calibration</button>
            </div>
          </div>
        )
      }

      // Baseline quality gate (replaces old Tier 2 + gain sanity)
      // Thresholds from 84-session forensic analysis — see GATE_SPEC.md
      const gateResult = rawFeatures ? runBaselineGate(rawFeatures, baselineSessions.length > 0 ? baselineSessions : null) : null

      console.log('Baseline quality gate:', gateResult)

      if (!gateResult || !gateResult.pass) {
        return (
          <div className="results-screen-ios">
            <div className="results-header-ios"><h1>Calibration Results</h1></div>
            <div className="results-content-ios">
              <section className="outcome-panel risk-medium">
                <p className="outcome-label">Calibration Needs Retry</p>
                <h2 className="outcome-value">Quality Below Threshold</h2>
              </section>
              <p style={{ padding: '0 16px', color: '#ccc' }}>
                {gateResult?.message || 'Could not compute eye tracking features. Retry with better lighting and ensure your face is fully visible.'}
              </p>
              <p style={{ padding: '0 16px', color: '#999', fontSize: '13px' }}>
                Tips: Good lighting, head still, follow the stripes closely.
              </p>
            </div>
            <div className="results-actions-ios">
              <button className="btn primary large" onClick={() => { setBaselineAttempts(a => a + 1); handleFinish() }}>Retry Calibration</button>
            </div>
          </div>
        )
      }

      // All gates passed — this calibration test is good
      const features = rawFeatures ? {
        gaze_transition_entropy: rawFeatures.gaze_transition_entropy,
        saccade_frequency: rawFeatures.saccade_frequency,
        _version: 7,  // v7: 5-baseline floor model (gte+sf)
      } : null

      // Determine calibration progress
      const completedBaselines = baselineSessions.length
      const currentStep = completedBaselines + 1  // this test is step N+1
      const isLastCalibration = currentStep >= MIN_BASELINES

      if (!isLastCalibration && features) {
        // Not done yet — need more calibration tests
        const handleStartNextCalibration = () => {
          // Upload this baseline to Supabase with BAC=0 (sober by definition)
          window.dispatchEvent(new CustomEvent('upload-with-bac', { detail: { bac: 0 } }))
          const newSessions = [...baselineSessions, features]
          setBaselineSessions(newSessions)
          setCalibrationStep(newSessions.length)
          setBaselineStatus('needs_second')
          try {
            localStorage.setItem('hazyeyes_pending_baseline', JSON.stringify({
              sessions: newSessions, timestamp: Date.now(), email: userEmail,
            }))
          } catch (_e) { /* storage full */ }

          // Full cleanup (exit fullscreen, unlock orientation, etc.) then return to idle
          try { ;(window as any).cleanupTestState?.(); window.resetTest?.() } catch (_e2) { /* */ }
          try {
            const doc = document as any
            const efs = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen
            if (efs && (doc.fullscreenElement || doc.webkitFullscreenElement)) efs.call(doc)
          } catch (_e2) { /* */ }
          try {
            if (screen.orientation && typeof (screen.orientation as any).unlock === 'function') {
              (screen.orientation as any).unlock()
            }
          } catch (_e2) { /* */ }
          document.body.classList.remove('test-active')

          setTestPhase('idle')
          setTestResult(null)
          setUploadPhase('idle')
          setUploadRowId(null)
          setUploadError(null)
        }

        const remaining = MIN_BASELINES - currentStep

        return (
          <div className="results-screen-ios">
            <div className="results-header-ios"><h1>Calibration {currentStep} of {MIN_BASELINES}</h1></div>
            <div className="results-content-ios">
              <section className="outcome-panel risk-low">
                <p className="outcome-label">Test {currentStep} Complete</p>
                <h2 className="outcome-value">{remaining} More to Go</h2>
              </section>
              <p style={{ padding: '0 16px', color: '#ccc' }}>
                {remaining === 1
                  ? 'Almost there! One more calibration test to establish your baseline.'
                  : `${remaining} more calibration tests to establish a stable baseline for personalized detection.`}
              </p>
            </div>
            <div className="results-actions-ios">
              <button className="btn primary large" onClick={handleStartNextCalibration}>
                Start Calibration Test {currentStep + 1}
              </button>
            </div>
          </div>
        )
      }

      // Last calibration done — all tests complete
      const handleBaselineComplete = () => {
        // Upload this baseline to Supabase with BAC=0 (sober by definition)
        window.dispatchEvent(new CustomEvent('upload-with-bac', { detail: { bac: 0 } }))
        if (features) {
          const allSessions = [...baselineSessions, features]
          setBaselineSessions(allSessions)
          setBaselineStatus('exists')
          setCalibrationStep(allSessions.length)
          ;(window as any).__BASELINE_FEATURES__ = allSessions
          try {
            localStorage.setItem('hazyeyes_pending_baseline', JSON.stringify({
              sessions: allSessions, timestamp: Date.now(), email: userEmail,
            }))
          } catch (_e) { /* storage full */ }
        }
        handleFinish()
      }

      return (
        <div className="results-screen-ios">
          <div className="results-header-ios"><h1>Calibration Complete</h1></div>
          <div className="results-content-ios">
            <section className="outcome-panel risk-low">
              <p className="outcome-label">Sober Baseline</p>
              <h2 className="outcome-value">Baseline Established</h2>
            </section>
            <p style={{ padding: '0 16px', color: '#ccc' }}>
              Your personal baseline is set from {MIN_BASELINES} calibration tests.
              Future tests will be compared against this baseline using personalized detection.
            </p>
          </div>
          <div className="results-actions-ios">
            <button className="btn primary large" onClick={handleBaselineComplete}>Start Testing</button>
          </div>
        </div>
      )
    }

    // --- Test session results — BAC or self-report required before submission ---
    const handleBacSubmit = () => {
      setSubmitError(null)

      const bac = bacValue !== '' ? parseFloat(bacValue) : null
      const hasBac = bac !== null && !isNaN(bac) && bac >= 0 && bac <= 5
      const hasLabel = selfReportLabel === 'sober' || selfReportLabel === 'drunk'

      if (!hasBac && !hasLabel) {
        setSubmitError('Enter your BAC level, or select sober/drunk below.')
        return
      }

      setSubmitStatus('submitting')

      if (hasBac) {
        // BAC provided → upload to okn_results_v2 (primary table)
        window.dispatchEvent(new CustomEvent('upload-with-bac', {
          detail: { bac }
        }))
      } else {
        // Self-report only (no BAC) → upload to uncertain_bac_tests
        window.dispatchEvent(new CustomEvent('upload-with-bac', {
          detail: { bac: null, selfReportLabel, targetTable: 'uncertain_bac_tests' }
        }))
      }
    }

    const elevated =
      testResult.decision === 'likely' || testResult.decision === 'insufficient'
    // Research edition: no impairment framing in UI
    const impairmentStatus = elevated
      ? 'Research signal: elevated pattern'
      : 'Research signal: baseline-range pattern'
    const statusTone = elevated ? 'risk-high' : 'risk-low'

    const isUploading = uploadPhase === 'uploading' || submitStatus === 'submitting'
    const isDone = uploadPhase === 'complete'

    return (
      <div className="results-screen-ios">
        <div className="results-header-ios">
          <h1 style={{ color: '#fff', fontWeight: 800, fontSize: '28px' }}>Turn Phone Back to Portrait</h1>
        </div>

        <div className="results-content-ios">
          <section className={`outcome-panel ${statusTone}`}>
            <p className="outcome-label">Assessment</p>
            <h2 className="outcome-value">{impairmentStatus}</h2>
          </section>

          <section className="subject-panel">
            <h3>Submit Your BAC</h3>
            <div className="form-row">
              <label htmlFor="bac-value">BAC Level</label>
              <input
                id="bac-value"
                type="number"
                step="0.001"
                min="0"
                max="5"
                value={bacValue}
                onChange={(e) => setBacValue(e.target.value)}
                placeholder="0.00"
                disabled={isUploading || isDone}
              />
            </div>
            <div className="form-row" style={{ marginTop: '8px' }}>
              <label htmlFor="self-report">Or self-report (no breathalyzer)</label>
              <select
                id="self-report"
                value={selfReportLabel}
                onChange={(e) => setSelfReportLabel(e.target.value as '' | 'sober' | 'drunk')}
                disabled={isUploading || isDone}
                style={{ padding: '8px 12px', borderRadius: '8px', background: '#1a1a2e', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', fontSize: '15px' }}
              >
                <option value="">-- Select --</option>
                <option value="sober">Sober</option>
                <option value="drunk">Drunk</option>
              </select>
            </div>
            {isUploading && <div className="info-text">Uploading...</div>}
            {uploadPhase === 'failed' && <div className="error-text">Upload failed: {uploadError ?? 'unknown error'}</div>}
            {submitError && <div className="error-text">{submitError}</div>}
            {isDone && <div className="success-text">Submitted!</div>}
            <button
              className="btn primary"
              onClick={handleBacSubmit}
              disabled={isUploading || isDone || uploadPhase === 'failed'}
            >
              {isUploading ? 'Uploading...' : isDone ? 'Submitted!' : 'Submit & Save'}
            </button>
          </section>
        </div>

        <div className="results-actions-ios">
          <button className="btn primary large" onClick={handleFinish} disabled={!isDone}>
            {isDone ? 'Return to Start' : 'Submit to continue'}
          </button>
        </div>
      </div>
    )
  }

  // --- Idle / Start screen ---
  const canStart = !!consentChoice && !!isSignedIn && !!isUserLoaded && !consentLoading

  return (
    <>
      {consentVisible && isSignedIn && (
        <div className="consent-overlay">
          <div
            className="consent-card"
            ref={consentCardRef}
            onScroll={handleConsentScroll}
          >
            <h2>OpenDementia Research Consent</h2>
            <p style={{ fontSize: 12, opacity: 0.85 }}>
              Layer A — app access / research preview (NeuroAgent). Modular study consent master
              (v0.9) is a separate IRB drafting template — not auto-enrolled here.
            </p>
            <section>
              <h3>Purpose</h3>
              <p>
                <strong>OpenDementia</strong> is a NeuroAgent open research app (OKN / MediaPipe
                pipeline) for non-commercial <strong>dementia research</strong> and education. With
                your permission, anonymized eye-movement recordings and related signals may be stored
                to improve research algorithms.
              </p>
              <p>
                <strong>Not a medical device.</strong> Not for diagnosis, treatment, or clinical
                screening. {RESEARCH_LANES.dementia.nonClaim}
              </p>
            </section>

            <section>
              <h3>What data we may collect (if you agree)</h3>
              <ul>
                <li>Eye-movement and facial video during OKN tests</li>
                <li>Device motion and timing metrics</li>
                <li>Optional demographics you provide</li>
                <li>App usage / performance metadata</li>
              </ul>
            </section>

            <section>
              <h3>How data is used</h3>
              <ul>
                <li>Internal research and algorithm development only (non-commercial research terms)</li>
                <li>Stored securely; de-identified where possible</li>
                <li>Not for clinical decision-making about any individual</li>
              </ul>
            </section>

            <section>
              <h3>Voluntary participation</h3>
              <p>
                Participation is voluntary. You may decline research storage; some features may be
                limited. You may withdraw by emailing info@neuroagentai.org.
              </p>
            </section>

            <section>
              <h3>Contact</h3>
              <p>Primary: info@neuroagentai.org</p>
              <p>Escalation: kemarearlgreen@neuroagentai.org</p>
              <p>https://neuroagentai.org · https://www.theneuroagentai.com</p>
            </section>

            <div className="consent-divider">---</div>

            <section>
              <h3>Consent</h3>
              <label className="consent-checkbox">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                />
                <span>
                  I have read and understood the information above. I agree this is a research
                  prototype only (not diagnostic). I voluntarily allow OpenDementia / NeuroAgent
                  research tools to store and use my anonymized data for non-commercial dementia
                  research and algorithm development.
                </span>
              </label>
              {!consentChecked && (
                <p className="consent-hint">Check the box to enable "Agree".</p>
              )}
              <p>(Tap "Agree" to continue or "Decline" to use the app without data sharing.)</p>
            </section>

            <div className={`consent-actions ${consentScrolledToEnd ? 'visible' : ''}`}>
              <button
                className="btn destructive consent-btn"
                onClick={() => {
                  setConsentChoice('declined')
                  setConsentVisible(false)
                  setConsentScrolledToEnd(false)
                  setConsentChecked(false)
                  void persistConsentChoice(false)
                }}
              >
                Decline
              </button>
              <button
                className="btn primary consent-btn"
                disabled={!consentChecked}
                onClick={() => {
                  setConsentChoice('accepted')
                  setConsentVisible(false)
                  setConsentScrolledToEnd(false)
                  setConsentChecked(false)
                  void persistConsentChoice(true)
                }}
              >
                Agree
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="tab-bar">
        <button
          className={`tab ${activeTab === 'test' ? 'active' : ''}`}
          onClick={() => setActiveTab('test')}
        >
          Test
        </button>
        <button
          className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
      </div>

      {activeTab === 'settings' ? (
        <div className="start-screen">
          <div className="start-card">
            <h1 className="start-heading">Settings</h1>
            <SignedOut>
              <p className="start-description">Sign in to manage your account and consent.</p>
              <SignInButton mode="modal">
                <button className="btn primary start-button">Sign in</button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <div className="settings-row">
                <UserButton appearance={{ variables: { colorPrimary: '#667eea' } }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div className="auth-email">{userEmail}</div>
                  <div className="start-description" style={{ margin: 0 }}>
                    Consent: {consentChoice === 'accepted' ? 'Accepted' : 'Not accepted'}
                  </div>
                </div>
              </div>
              <div className="settings-actions">
                <button
                  className="btn primary"
                  onClick={() => setConsentFromSettings('accepted')}
                  disabled={consentChoice === 'accepted'}
                >
                  Accept research consent
                </button>
                <button
                  className="btn destructive"
                  onClick={() => setConsentFromSettings('declined')}
                  disabled={consentChoice === 'declined'}
                >
                  Decline / withdraw consent
                </button>
              </div>
              <button
                className="btn secondary start-button"
                onClick={() => {
                  ;(window as any).__BASELINE_FEATURES__ = null
                  ;(window as any).__SESSION_TYPE__ = null
                  ;(window as any).__USER_EMAIL__ = null
                  localStorage.removeItem('hazyeyes_pending_baseline')
                  setBaselineStatus('loading')
                  setBaselineSessions([])
                  signOut().catch(console.error)
                }}
              >
                Log out
              </button>
            </SignedIn>
          </div>
        </div>
      ) : (
        <div className="start-screen">
          <div className="start-card">
            <p className="start-description" style={{ marginBottom: 4, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 11 }}>
              NeuroAgent · open research
            </p>
            <h1 className="start-heading">OpenDementia</h1>
            <p className="start-description">{RESEARCH_LANES.dementia.tagline}</p>
            <p className="start-description" style={{ fontSize: 12 }}>
              {RESEARCH_LANES.dementia.nonClaim}
            </p>

            {/* Baseline workflow routing — above auth so start button is visible in landscape */}
            {isSignedIn && consentChoice === 'accepted' && baselineStatus === 'loading' && (
              <p className="start-description">Checking calibration status...</p>
            )}

            {isSignedIn && consentChoice === 'accepted' && baselineStatus === 'error' && (
              <div style={{ padding: '12px 0' }}>
                <p className="start-description" style={{ color: '#ff6b6b' }}>
                  Could not verify calibration status. Check your connection.
                </p>
                <button className="btn secondary start-button" onClick={() => {
                  setBaselineStatus('loading')
                  setConsentChoice(null)
                  setTimeout(() => setConsentChoice('accepted'), 50)
                }}>
                  Retry
                </button>
              </div>
            )}

            {isSignedIn && consentChoice === 'accepted' && (baselineStatus === 'none' || baselineStatus === 'needs_second') && (
              <div style={{ padding: '12px 0' }}>
                {isLandscape ? (
                  <button
                    className="btn primary start-button"
                    style={{ marginBottom: '12px' }}
                    onClick={handleStartBaseline}
                    disabled={baselineStatus === 'none' && !soberConfirmed}
                  >
                    {baselineStatus === 'none' ? `Start Calibration (Test 1 of ${MIN_BASELINES})` : `Start Calibration Test ${calibrationStep + 1}`}
                  </button>
                ) : (
                  <div className="landscape-prompt" style={{ marginBottom: '12px' }}>
                    <p className="landscape-prompt__text" style={{ fontWeight: 700 }}>Turn phone to landscape</p>
                  </div>
                )}
                {baselineStatus === 'none' ? (
                  <>
                    <label className={`sober-confirm${soberConfirmed ? ' confirmed' : ''}`}>
                      <input
                        type="checkbox"
                        checked={soberConfirmed}
                        onChange={(e) => setSoberConfirmed(e.target.checked)}
                      />
                      <span>I confirm I am completely sober right now</span>
                    </label>
                    <h3 style={{ color: '#fff', margin: '0 0 8px' }}>Establish Your Baseline</h3>
                    <p className="start-description" style={{ margin: '0 0 12px' }}>
                      {MIN_BASELINES} quick 15-second tests while sober establish your personal baseline.
                      This enables accurate personalized detection.
                    </p>
                  </>
                ) : (
                  <>
                    <h3 style={{ color: '#fff', margin: '0 0 8px' }}>Calibration Test {calibrationStep + 1} of {MIN_BASELINES}</h3>
                    <p className="start-description" style={{ margin: '0 0 12px' }}>
                      {MIN_BASELINES - calibrationStep} more {MIN_BASELINES - calibrationStep === 1 ? 'test' : 'tests'} to complete your baseline.
                    </p>
                  </>
                )}
                {isLandscape ? (
                  <button
                    className="btn primary start-button"
                    onClick={handleStartBaseline}
                    disabled={baselineStatus === 'none' && !soberConfirmed}
                  >
                    {baselineStatus === 'none' ? `Start Calibration (Test 1 of ${MIN_BASELINES})` : `Start Calibration Test ${calibrationStep + 1}`}
                  </button>
                ) : (
                  <div className="landscape-prompt" style={{ marginBottom: '12px' }}>
                    <p className="landscape-prompt__text" style={{ fontWeight: 700 }}>Turn phone to landscape</p>
                  </div>
                )}
                {baselineAttempts >= 3 && (
                  <p className="start-description" style={{ margin: '12px 0 0', color: '#999', fontSize: '13px' }}>
                    Having trouble? Try better lighting, hold your head still, and follow the stripes closely.
                  </p>
                )}
              </div>
            )}

            {isSignedIn && consentChoice === 'accepted' && baselineStatus === 'exists' && (
              <>
                {isLandscape ? (
                  <button
                    id="btnStart"
                    className="btn primary start-button"
                    onClick={handleStartRegularTest}
                    disabled={!canStart}
                  >
                    Start Test
                  </button>
                ) : (
                  <div className="landscape-prompt">
                    <p className="landscape-prompt__text" style={{ fontWeight: 700 }}>Turn phone to landscape</p>
                  </div>
                )}
              </>
            )}

            <div className="auth-block">
              <SignedOut>
                <SignInButton mode="modal">
                  <button className="btn secondary start-button">
                    Sign in with email to continue
                  </button>
                </SignInButton>
                <p className="start-description">Sign in is required before starting a test.</p>
              </SignedOut>
              <SignedIn>
                <span className="auth-email-line">{userEmail}</span>
              </SignedIn>
            </div>

            {/* Show start button for users without consent yet (existing behavior) */}
            {(!isSignedIn || !consentChoice) && isLandscape && (
              <button
                id="btnStart"
                className="btn primary start-button"
                onClick={handleStartRegularTest}
                disabled={!canStart}
              >
                Start Test
              </button>
            )}
            {(!isSignedIn || !consentChoice) && !isLandscape && (
              <div className="landscape-prompt">
                <p className="landscape-prompt__text" style={{ fontWeight: 700 }}>Turn phone to landscape</p>
              </div>
            )}

            <div className="brand-footer">
              <img
                src="/hazyeyes-logo-black-transparent.png"
                alt="HazyEyes logo"
                className="brand-footer__logo"
              />
              <span className="brand-footer__text">HazyEyes</span>
            </div>

            {showA2HS && (
              <div className="a2hs-banner">
                <p>For fullscreen: tap <strong>Share</strong> <span className="a2hs-icon">{'\uFEFF\u2B06\uFE0E'}</span> then <strong>"Add to Home Screen"</strong></p>
                <button className="a2hs-dismiss" onClick={() => setShowA2HS(false)}>&times;</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export default App
