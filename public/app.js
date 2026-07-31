/* EyeBreathalyzer V3 — Landscape Close-Range Protocol
 * 15‑second OKN + on‑device eye tracking + OKN gain estimate + safety routing
 * V2 changes: landscape mode, close hold (~15cm), coarser stripes, no fixation target,
 *   "look" OKN instructions, visible calibration landmarks, longer duration
 * Notes:
 * - Uses MediaPipe Face Mesh (refineLandmarks) for iris landmarks as a web‑friendly fallback.
 * - Provides adapter hooks for OpenIris / segmentation_in_style / OpenSourceIrisRecognition if web builds are available.
 * - All processing happens on‑device in this demo.
 */

// Wrap in IIFE to prevent redeclaration errors when script is reloaded
(function() {
'use strict';

// Check if already initialized (prevents duplicate execution)
if (window.__OKN_APP_INITIALIZED__) {
  console.warn('Warning: app.js already initialized, skipping...');
  return;
}
window.__OKN_APP_INITIALIZED__ = true;

const DURATION_MS = 15_000;              // 15s — longer test for more slow phases and cleaner gain
const BASE_STIM_SPEED = 250;             // px/s reference stimulus speed at REFERENCE_WIDTH
const REFERENCE_WIDTH = 667;             // canvas width (px) of known-good calibration device
const BASE_STRIPE_WIDTH = 120;           // px — stripe width at REFERENCE_WIDTH
const BASE_STRIPE_GAP = 120;             // px — stripe gap at REFERENCE_WIDTH
let stimSpeed = BASE_STIM_SPEED;         // actual px/s — adapted to canvas width after init
let stripeWidth = BASE_STRIPE_WIDTH;     // actual px — adapted to canvas width after init
let stripeGap = BASE_STRIPE_GAP;         // actual px — adapted to canvas width after init
let stimScale = 1;                       // oknWidth / REFERENCE_WIDTH
const EYE_SMOOTH = 0.10;                 // EMA smoothing factor for eye x (reduced from 0.18)
const QUALITY_MIN_FRAC = 0.6;            // required usable fraction of frames
const QUALITY_MIN_COVERAGE = 0.10;       // minimum fraction of time covered by slow phases (recalibrated: post-fix segment builder produces 6-31% on good sessions; ref min=0.119)
const QUALITY_MIN_SEGMENTS = 6;          // minimum count of accepted slow phases for validity
const SLOW_PHASE_ACCEL_THR = 6000;      // px/s^2 threshold to reject saccades (coarse)
const FPS_TARGET = 30;
const USE_QUALITY_GATE_DEFAULT = true;

// Slow-phase segmentation thresholds — computed as functions of stimSpeed
// so they adapt when stimulus speed changes with canvas width
function oknSlowMinV() { return stimSpeed * 0.05; }   // Minimum slow-phase velocity
function oknSlowMaxV() { return stimSpeed * 1.6; }    // Maximum slow-phase velocity
function oknSlowMaxDev() { return stimSpeed * 1.0; }  // Allowable deviation from stimulus velocity
function oknSlowMaxAcc() { return stimSpeed * 8; }    // Maximum acceleration for smooth pursuit
const OKN_MIN_SEGMENT_MS = 150;                // Was 90ms — removes noisy short fragments
const OKN_MIN_SEGMENT_SAMPLES = 5;             // Was 3 — requires more data per segment
const OKN_MIN_SEGMENTS_REQUIRED = 2;          // Require at least 2 slow phases for reliable gain
const SPAN_EMA = 0.25;                        // Smoothing factor for eye corner span
const SPAN_MAX_STEP = 0.12;                   // Max fractional change in span per frame (12%)
const EYE_SELECTION_WARMUP_FRAMES = 45;       // Frames before locking single eye (~1.5s at 30fps)
const SEGMENT_BRIDGE_FRAMES = 1;              // Allowable non-slow-phase frames inside a segment
const K_GEO = 1714.1;                         // Recalibrated on correct slow-phase segments (28 post-fix recordings, TDD-validated)

// --- Frame-rate adaptive parameters ---
// At high fps (60+), frame-count-based windows and thresholds become too tight.
// These adapt to the actual device frame rate detected at test start.
let detectedFps = 30;
let adaptiveRegressionWin = 5;       // recomputed from fps (target ~170ms)
let adaptiveBridgeFrames = 1;        // recomputed from fps (target ~33ms)
let fpsDetected = false;

const TARGET_REGRESSION_WINDOW_MS = 170;
const TARGET_BRIDGE_MS = 33;
const FPS_DETECTION_SAMPLES = 30;
const MIN_USABLE_NOISE_FLOOR = 0.018; // min position-jump threshold (prevents false rejections at high fps)

function detectFpsAndAdapt(sampleArr) {
  if (fpsDetected || sampleArr.length < FPS_DETECTION_SAMPLES) return;
  const dts = [];
  for (let i = 1; i < Math.min(sampleArr.length, FPS_DETECTION_SAMPLES + 10); i++) {
    const dt = (sampleArr[i].t - sampleArr[i - 1].t) / 1000;
    if (dt > 0 && dt < 0.2) dts.push(dt);
  }
  if (dts.length < 10) return;
  dts.sort((a, b) => a - b);
  const medianDt = dts[Math.floor(dts.length / 2)];
  detectedFps = Math.round(1 / medianDt);
  adaptiveRegressionWin = Math.max(5, Math.round(TARGET_REGRESSION_WINDOW_MS / 1000 * detectedFps));
  adaptiveBridgeFrames = Math.max(1, Math.floor(TARGET_BRIDGE_MS / 1000 * detectedFps));
  fpsDetected = true;
  console.log(`🎯 Detected fps: ${detectedFps}, regressionWin: ${adaptiveRegressionWin} frames, bridgeFrames: ${adaptiveBridgeFrames} frames`);
}

// Landmarks: (MediaPipe FaceMesh canonical indices)
const L_CORNER_IN = 133, L_CORNER_OUT = 33;
const R_CORNER_IN = 263, R_CORNER_OUT = 362;
// Iris rough indices (MediaPipe FaceMesh with refineLandmarks=true)
const L_IRIS = [468,469,470,471];
const R_IRIS = [473,474,475,476]; // tolerant if some models use 472–477; we guard below.

// Eyelid landmarks for blink/PERCLOS detection (Release 5A — video pipeline)
const L_LID_UPPER = 386;  // anatomical left eye, upper eyelid
const L_LID_LOWER = 374;  // anatomical left eye, lower eyelid
const R_LID_UPPER = 159;  // anatomical right eye, upper eyelid
const R_LID_LOWER = 145;  // anatomical right eye, lower eyelid

// Head/face landmarks for motion instrumentation (Release 2C)
const NOSE_TIP_IDX = 1;
const FOREHEAD_IDX = 10;
const CHIN_IDX = 152;
const FACE_EDGE_L_IDX = 234;
const FACE_EDGE_R_IDX = 454;

// --- Feature flags (Release 3D) ---
// Read from URL params: ?richCalibration=0 disables multi-criteria gate
function _FF(name, defaultVal) {
  const params = new URLSearchParams(window.location.search);
  const v = params.get(name);
  if (v === null) return defaultVal;
  return v !== '0' && v !== 'false';
}
const FF_RICH_CALIBRATION = _FF('richCalibration', true);
const FF_OVAL_CALIBRATION = _FF('ovalCalibration', true);

// --- Simple calibration constants ---
const SIMPLE_CALIB_IRIS_TARGET = 0.06;
const SIMPLE_CALIB_IRIS_TOL = 0.01; // iris must be in [0.05, 0.07] — same as old calibration
const SIMPLE_CALIB_REQUIRED_STABLE = 8;
// Framing box inset as fraction of render rect (how much border to show)
const FRAMING_BOX_INSET = 0.08;

// --- Release 3A: Multi-criteria calibration thresholds ---
const SAFE_ZONE_X_MIN = 0.15;
const SAFE_ZONE_X_MAX = 0.85;
const SAFE_ZONE_Y_MIN = 0.10;
const SAFE_ZONE_Y_MAX = 0.90;
const YAW_LIMIT_NORM = 0.12;              // Head turn tolerance (was 0.08 — relaxed for research participants)
const PITCH_LIMIT_NORM = 0.15;             // Head tilt tolerance (was 0.10)
const MIN_EYE_SPAN_NORM = 0.035;
const NOSE_MOTION_SIGMA_MAX = 0.020;       // Phone stability tolerance (was 0.012 — too strict for handheld)
const CALIB_REQUIRED_STABLE = 10;          // Consecutive stable frames (was 15 — faster pass)
const CENTER_ZONE_X_MIN = 0.25;
const CENTER_ZONE_X_MAX = 0.75;
const CENTER_ZONE_Y_MIN = 0.25;
const CENTER_ZONE_Y_MAX = 0.75;

// UI elements
let oknCanvas, video, eyeCanvas, waveformCanvas, trackingTag, btnStart, btnStop, progressRing, timeLeftEl, overlayInstruction, mFrames, mGain, mR2, mQuality, decisionCard, decisionTag, decisionText, decisionActions, assistCard, mirrorToggle, drawLandmarksToggle, qualityGateToggle;

// Ride/Location UI
let mapWrap, uberLink, lyftLink, taxiLink, transitLink, friendPhoneIn, saveFriendBtn, btnCallFriend, btnTextFriend, btnShare, setHomeBtn, homeStatus;

// Initialize UI elements
function initUIElements() {
  // Core elements
  oknCanvas = document.getElementById('oknCanvas');
  video = document.getElementById('video');
  eyeCanvas = document.getElementById('eyeCanvas');
  waveformCanvas = document.getElementById('waveformCanvas');
  trackingTag = document.getElementById('trackingTag');
  btnStart = document.getElementById('btnStart');
  btnStop = document.getElementById('btnStop');
  progressRing = document.getElementById('progress');
  timeLeftEl = document.getElementById('timeLeft');
  overlayInstruction = document.getElementById('overlayInstruction');
  
  // Debug: log which elements were found
  console.log('🔧 UI Elements found:');
  console.log('  - video:', !!video);
  console.log('  - oknCanvas:', !!oknCanvas);
  console.log('  - eyeCanvas:', !!eyeCanvas);
  console.log('  - trackingTag:', !!trackingTag);
  console.log('  - btnStart:', !!btnStart);
  console.log('  - btnStop:', !!btnStop);
  
  // Metrics elements
  mFrames = document.getElementById('mFrames');
  mGain = document.getElementById('mGain');
  mR2 = document.getElementById('mR2');
  mQuality = document.getElementById('mQuality');
  
  // Decision elements
  decisionCard = document.getElementById('decisionCard');
  decisionTag = document.getElementById('decisionTag');
  decisionText = document.getElementById('decisionText');
  decisionActions = document.getElementById('decisionActions');
  assistCard = document.getElementById('assistCard');
 
  
  // Toggle elements
  mirrorToggle = document.getElementById('mirrorToggle');
  drawLandmarksToggle = document.getElementById('drawLandmarksToggle');
  qualityGateToggle = document.getElementById('qualityGateToggle');
  
  // Location elements
  mapWrap = document.getElementById('mapWrap');
  uberLink = document.getElementById('uberLink');
  lyftLink = document.getElementById('lyftLink');
  taxiLink = document.getElementById('taxiLink');
  transitLink = document.getElementById('transitLink');
  friendPhoneIn = document.getElementById('friendPhone');
  saveFriendBtn = document.getElementById('saveFriend');
  btnCallFriend = document.getElementById('btnCallFriend');
  btnTextFriend = document.getElementById('btnTextFriend');
  btnShare = document.getElementById('btnShare');
  setHomeBtn = document.getElementById('setHome');
  homeStatus = document.getElementById('homeStatus');
  
  // Video element will be available when React renders the camera phase
  if(!video) {
    console.log('📹 Video element not yet available - will be created by React');
  }
  
  // Initialize canvas contexts
  if(oknCanvas) oknCtx = oknCanvas.getContext('2d');
  if(eyeCanvas) eyeCtx = eyeCanvas.getContext('2d');
  if(waveformCanvas) waveCtx = waveformCanvas.getContext('2d');
  
  // Initialize progress ring
  if(progressRing) {
    ringFG = progressRing.querySelector('.fg');
    if(ringFG) {
      ringFG.style.strokeDasharray = CIRCUM;
    }
  }
  
  console.log('🔧 UI elements initialized');
}

// Progress ring setup
let ringFG;
const CIRCUM = 2*Math.PI*54;

// Canvas contexts
let oknCtx, eyeCtx, waveCtx;

let camera, faceMesh; // MediaPipe components
let mediaRecorder = null;
let recordedChunks = [];
let rafId = null;
let running = false;
let startedAt = 0;
let stimPhase = 0; // px
let lastTs = 0;

const samples = []; // {t, stimX, stimV, eyeX, eyeV, usable}
let eyeEma = 0;
let haveEma = false;
let eyeNormEma = 0;
let haveNormEma = false;
// Median filter ring buffers (Iteration 3: replaces EMA)
const medianBufNorm = [];
const medianBufPx = [];
let selectedEye = null;
let eyeSelectionCounter = 0;
let leftSpanSmooth = null;
let rightSpanSmooth = null;

// Global for tracking validation
let lastIrisSize = 0;
let lastLandmarksDetected = false;
let isCalibrating = false; // Prevent tracking tag updates during calibration
let calibratedEyeSpan = null;  // Eye span captured during distance calibration (MediaPipe normalized units)
let lastValidEyeX = null;
let lastValidTime = null;

// Global for iris position tracking (for calibration debug)
let lastEyeXNorm = null; // Normalized eye position [-1, 1]
let lastLeftIris = null; // {x, y} in normalized coordinates [0, 1]
let lastRightIris = null; // {x, y} in normalized coordinates [0, 1]
let lastLeftEyeX = null; // Normalized left eye position [-1, 1]
let lastRightEyeX = null; // Normalized right eye position [-1, 1]
let lastLeftIn = null; // Left eye inner corner
let lastLeftOut = null; // Left eye outer corner
let lastRightIn = null; // Right eye inner corner
let lastRightOut = null; // Right eye outer corner
let oknWidth = 0, oknHeight = 0;
let usableFrames = 0;

// Location tracking
let leafletMap = null, userMarker = null, watchId = null;
let lastCoords = null;
let home = JSON.parse(localStorage.getItem('oknHome')||'null');
let friendPhone = localStorage.getItem('oknFriend') || '';

// Supabase helper state
let cachedSupabaseClient = null;
const DEFAULT_SUPABASE_BUCKET = 'okn-results-v2';

function getSupportedVideoMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  const types = [
    'video/mp4',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

function getSupabaseClient() {
  if (cachedSupabaseClient) return cachedSupabaseClient;
  if (typeof window !== 'undefined' && window.__SUPABASE_CLIENT__) {
    cachedSupabaseClient = window.__SUPABASE_CLIENT__;
    return cachedSupabaseClient;
  }
  console.warn('Supabase client not available. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable uploads.');
  return null;
}

async function uploadResultsToSupabase(csvString, result, videoBlob, sidecarJson, options) {
  options = options || {};
  // FIX: Capture session_type EAGERLY before any async work.
  // Previously read lazily at row-construction time (after CSV/video uploads),
  // which races with handleFinish() resetting __SESSION_TYPE__ to 'test'.
  // Validates: only 'baseline'/'test' accepted; anything else becomes 'unknown'.
  const raw = typeof window !== 'undefined' ? window.__SESSION_TYPE__ : null;
  const sessionType = (raw === 'baseline' || raw === 'test') ? raw : 'unknown';
  console.log('Upload session_type:', sessionType, '(window.__SESSION_TYPE__=' + (raw ?? 'N/A') + ')');

  const client = getSupabaseClient();
  const config = (typeof window !== 'undefined' && window.__SUPABASE_CONFIG__) || null;
  const userEmail = (typeof window !== 'undefined' && window.__USER_EMAIL__) ? String(window.__USER_EMAIL__) : null;
  if (!client || !config || !config.url || !config.anonKey) {
    return { error: 'missing_supabase_configuration' };
  }

  const bucket = config.bucket || DEFAULT_SUPABASE_BUCKET;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const randomPart = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10);
  const objectPath = `${timestamp}-${randomPart}.csv`;

  console.log('🔗 Supabase upload start', {
    bucket,
    objectPath,
    userEmail,
    sessionType,
    hasResult: !!result,
  });

  const blob = new Blob([csvString], { type: 'text/csv' });
  const { error: uploadError } = await client
    .storage
    .from(bucket)
    .upload(objectPath, blob, { contentType: 'text/csv', upsert: false });

  if (uploadError) {
    console.warn('Supabase upload failed:', uploadError);
    return { error: uploadError.message || 'upload_failed' };
  }

  // Upload video if available
  let videoPath = null;
  if (videoBlob && videoBlob.size > 0) {
    const videoExt = videoBlob.type.includes('mp4') ? 'mp4' : 'webm';
    const videoObjectPath = `${timestamp}-${randomPart}.${videoExt}`;
    const { error: videoUploadError } = await client
      .storage
      .from('okn-videos')
      .upload(videoObjectPath, videoBlob, { contentType: videoBlob.type, upsert: false });
    if (videoUploadError) {
      console.warn('Video upload failed:', videoUploadError);
    } else {
      videoPath = videoObjectPath;
      console.log('Video uploaded:', videoPath);
    }
  }

  // Upload per-frame metadata sidecar JSON if available
  let sidecarJsonPath = null;
  if (sidecarJson) {
    const sessionId = `${timestamp}-${randomPart}`;
    sidecarJson.session_id = sessionId;
    const jsonObjectPath = `${timestamp}-${randomPart}.json`;
    const jsonBlob = new Blob([JSON.stringify(sidecarJson)], { type: 'application/json' });
    const { error: jsonUploadError } = await client
      .storage
      .from('okn-videos')
      .upload(jsonObjectPath, jsonBlob, { contentType: 'application/json', upsert: false });
    if (jsonUploadError) {
      console.warn('Sidecar JSON upload failed:', jsonUploadError);
    } else {
      sidecarJsonPath = jsonObjectPath;
      console.log('Sidecar JSON uploaded:', sidecarJsonPath);
    }
  }

  // Compute capture completeness: which research artifacts were successfully uploaded
  const artifacts = ['csv'];
  if (videoPath) artifacts.push('video');
  if (sidecarJsonPath) artifacts.push('json');
  const captureCompleteness = artifacts.join('+');

  // Compute n_usable_samples from classifier features if available
  const nUsable = result && result.classifierFeatures && typeof result.classifierFeatures.n_samples === 'number'
    ? result.classifierFeatures.n_samples : null;

  // Map decision to a human-readable prediction result
  const predictionResult = result && result.decision ? String(result.decision) : null;

  const row = {
    // v1 fields (carried forward)
    user_id: userEmail,
    tester_id: result && result.testerId ? String(result.testerId) : null,
    bac: result && typeof result.bac === 'number' && Number.isFinite(result.bac) ? result.bac : null,
    device: detectDeviceType(),
    okn_gain_auto: result && typeof result.gain === 'number' && Number.isFinite(result.gain) ? result.gain : null,
    csv_path: objectPath,
    classifier_probability: result && typeof result.classifierProbability === 'number' && Number.isFinite(result.classifierProbability) ? result.classifierProbability : null,
    prediction_result: predictionResult,
    quality_score: result && typeof result.quality === 'number' && Number.isFinite(result.quality) ? result.quality : null,
    n_usable_samples: nUsable,
    // v2 fields: multiple gain computations
    gain_raw: result && typeof result.gainRaw === 'number' && Number.isFinite(result.gainRaw) ? result.gainRaw : null,
    gain_median_raw: result && typeof result.gainMedianRaw === 'number' && Number.isFinite(result.gainMedianRaw) ? result.gainMedianRaw : null,
    gain_calibrated: result && typeof result.gainCalibrated === 'number' && Number.isFinite(result.gainCalibrated) ? result.gainCalibrated : null,
    gain_cal_median: result && typeof result.gainCalMedian === 'number' && Number.isFinite(result.gainCalMedian) ? result.gainCalMedian : null,
    theil_sen_velocity_norm: result && typeof result.theilSenVelocityNorm === 'number' && Number.isFinite(result.theilSenVelocityNorm) ? result.theilSenVelocityNorm : null,
    // v2 fields: regression quality
    r_squared: result && typeof result.r2 === 'number' && Number.isFinite(result.r2) ? result.r2 : null,
    // v2 fields: slow-phase metrics
    slow_phase_coverage: result && typeof result.slowPhaseCoverage === 'number' && Number.isFinite(result.slowPhaseCoverage) ? result.slowPhaseCoverage : null,
    slow_phase_segments: result && typeof result.slowPhaseSegments === 'number' ? result.slowPhaseSegments : null,
    slow_phase_median_velocity_norm: result && typeof result.slowPhaseMedianVelocityNorm === 'number' && Number.isFinite(result.slowPhaseMedianVelocityNorm) ? result.slowPhaseMedianVelocityNorm : null,
    slow_phase_mean_velocity_norm: result && typeof result.slowPhaseMeanVelocityNorm === 'number' && Number.isFinite(result.slowPhaseMeanVelocityNorm) ? result.slowPhaseMeanVelocityNorm : null,
    // v2 fields: calibration and stimulus
    observed_range_norm: result && typeof result.observedRangeNorm === 'number' && Number.isFinite(result.observedRangeNorm) ? result.observedRangeNorm : null,
    cal_factor: result && typeof result.calFactor === 'number' && Number.isFinite(result.calFactor) ? result.calFactor : null,
    stim_velocity_norm: result && typeof result.stimVelocityNorm === 'number' && Number.isFinite(result.stimVelocityNorm) ? result.stimVelocityNorm : null,
    // v2 fields: quality gate and eye selection
    pass_quality: result ? !!result.passQuality : null,
    selected_eye: selectedEye || null,
    // v2 fields: structured JSON
    rejection_stats: result && result.rejectionStats ? result.rejectionStats : null,
    classifier_features: result && result.classifierFeatures ? result.classifierFeatures : null,
    // Video recording path
    video_path: videoPath,
    // Sidecar JSON path (per-frame iris landmarks for tracker benchmarking)
    sidecar_json_path: sidecarJsonPath,
    // Which artifacts uploaded: 'csv', 'csv+video', 'csv+json', 'csv+video+json'
    capture_completeness: captureCompleteness,
    // Baseline workflow fields
    // Uses eagerly-captured and validated sessionType (see top of function).
    session_type: sessionType,
    ml_features: result && result.baselineRawFeatures ? {
      gaze_transition_entropy: result.baselineRawFeatures.gaze_transition_entropy,
      saccade_frequency: result.baselineRawFeatures.saccade_frequency,
      _version: 7,  // v7: 5-baseline floor model (gte+sf)
    } : null,
    baseline_gain_cal: (sessionType === 'baseline' && result && isFinite(result.gainCalMedian))
      ? result.gainCalMedian : null,
  };

  // Route to uncertain_bac_tests if self-report only
  const tableName = options.targetTable || 'okn_results_v2';
  if (options.selfReportLabel) {
    row.self_report_label = options.selfReportLabel;
  }

  const { error: insertError, data } = await client
    .from(tableName)
    .insert(row)
    .select('id,csv_path')
    .single();

  if (insertError) {
    console.warn(tableName + ' insert failed:', insertError);
    return { error: insertError.message || 'insert_failed', path: objectPath };
  }

  console.log('✅ ' + tableName + ' upload success', { id: data?.id, path: objectPath });
  return { id: data?.id ?? null, path: objectPath };
}

// Real data only - no soft loading

function resizeCanvases(){
  const view = document.querySelector('.test-camera__view');
  const target = view || oknCanvas?.parentElement || eyeCanvas?.parentElement;
  if (!target) return;

  const rect = target.getBoundingClientRect();
  const cssW = Math.max(1, Math.floor(rect.width));
  const cssH = Math.max(1, Math.floor(rect.height));
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  const resizeCanvas = (canvas) => {
    if (!canvas) return null;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.max(1, Math.floor(cssW * dpr));
    canvas.height = Math.max(1, Math.floor(cssH * dpr));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    return ctx;
  };

  const oknCtxLocal = resizeCanvas(oknCanvas);
  if (oknCtxLocal) oknCtx = oknCtxLocal;

  const eyeCtxLocal = resizeCanvas(eyeCanvas);
  if (eyeCtxLocal) eyeCtx = eyeCtxLocal;

  if (waveformCanvas) {
    const wfRect = waveformCanvas.parentElement?.getBoundingClientRect();
    const wfCssW = Math.max(1, Math.floor((wfRect?.width ?? cssW)));
    const wfCssH = Math.max(1, Math.floor((wfRect?.height ?? cssH)));
    waveformCanvas.style.width = `${wfCssW}px`;
    waveformCanvas.style.height = `${wfCssH}px`;
    waveformCanvas.width = Math.max(1, Math.floor(wfCssW * dpr));
    waveformCanvas.height = Math.max(1, Math.floor(wfCssH * dpr));
    const wfCtx = waveformCanvas.getContext('2d');
    if (wfCtx) {
      wfCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      waveCtx = wfCtx;
    }
  }

  oknWidth = cssW;
  oknHeight = cssH;

  // Adapt ALL stimulus geometry to maintain device-invariant appearance.
  // Speed, stripe width, and stripe gap all scale together so that:
  //  - visible bar count stays constant (≈ oknWidth / period, and period scales with oknWidth)
  //  - temporal frequency stays constant (speed / period = BASE_STIM_SPEED / (BASE_STRIPE_WIDTH + BASE_STRIPE_GAP))
  //  - spatial frequency stays constant (bars subtend same fraction of screen)
  if (oknWidth > 0) {
    stimScale = oknWidth / REFERENCE_WIDTH;
    stimSpeed = BASE_STIM_SPEED * stimScale;
    stripeWidth = BASE_STRIPE_WIDTH * stimScale;
    stripeGap = BASE_STRIPE_GAP * stimScale;
    const period = stripeWidth + stripeGap;
    console.log(`📐 Stimulus adapted for ${oknWidth}px canvas (scale=${stimScale.toFixed(3)}): speed=${stimSpeed.toFixed(1)} px/s, stripeW=${stripeWidth.toFixed(1)} px, stripeG=${stripeGap.toFixed(1)} px, period=${period.toFixed(1)} px, TF=${(stimSpeed / period).toFixed(3)} Hz`);
  }
}

function smoothSpan(prev, current){
  if(!isFinite(current) || current <= 0) return prev;
  if(prev == null || !isFinite(prev) || prev <= 0) return current;
  const maxUp = prev * (1 + SPAN_MAX_STEP);
  const maxDown = prev * (1 - SPAN_MAX_STEP);
  let target = current;
  if(target > maxUp) target = maxUp;
  if(target < maxDown) target = maxDown;
  return prev + SPAN_EMA * (target - prev);
}

function resetEyeSelection(){
  selectedEye = null;
  eyeSelectionCounter = 0;
  leftSpanSmooth = null;
  rightSpanSmooth = null;
}

// Stimulus drawing — drifting vertical bars
function drawStimulus(dt){
  if(!oknCtx || !oknCanvas) {
    console.log('❌ drawStimulus: oknCtx or oknCanvas not available', {oknCtx: !!oknCtx, oknCanvas: !!oknCanvas});
    return;
  }
  
  stimPhase += stimSpeed * dt; // px
  // Wrap around by total period (stripe width + gap, both scaled to canvas)
  const period = stripeWidth + stripeGap;
  stimPhase = stimPhase % period;

  // Fill canvas with light background for OKN stimulus (like working version)
  oknCtx.fillStyle = '#f6f7fb';
  oknCtx.fillRect(0,0,oknWidth,oknHeight);

  // draw stripes (stimulus moves left via -stimPhase)
  oknCtx.fillStyle = '#101318';
  const columns = Math.ceil(oknWidth/period) + 2;
  for(let i=-1;i<columns;i++){
    const x = Math.floor(-stimPhase + i*period);
    oknCtx.fillRect(x,0,stripeWidth,oknHeight);
  }

}

// Progress UI
function setProgress(frac){
  const val = Math.max(0, Math.min(1, frac));
  const offset = CIRCUM * (1 - val);
  if(ringFG) ringFG.style.strokeDashoffset = offset;
  if(timeLeftEl) timeLeftEl.textContent = (Math.max(0, (DURATION_MS*(1-val))/1000)).toFixed(1);
}

// ---------- Eye Tracking (MediaPipe Face Mesh Fallback) ----------

async function initMediaPipe(){
  // Create FaceMesh instance from global MediaPipe `FaceMesh`
  return new Promise((resolve) => {
    faceMesh = new FaceMesh({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    faceMesh.onResults(onResults);
    resolve();
  });
}

// Stop camera stream
function stopCamera(){
  console.log('🛑 Stopping camera...');
  
  // Stop MediaPipe camera if running
  if(camera) {
    try {
      camera.stop();
      camera = null;
    console.log('Info: MediaPipe camera stopped');
    } catch(e) {
      console.warn('Warning: Error stopping MediaPipe camera:', e);
    }
  }
  
  // Get fresh reference to video element since it may be recreated by React
  const videoEl = document.getElementById('video');
  
  // Stop video stream tracks
  if(videoEl && videoEl.srcObject) {
    try {
      const stream = videoEl.srcObject;
      const tracks = stream.getTracks();
      tracks.forEach(track => {
        track.stop();
        console.log('🛑 Stopped track:', track.kind, track.label);
      });
      videoEl.srcObject = null;
    console.log('Info: Video stream stopped');
    } catch(e) {
      console.warn('Warning: Error stopping video stream:', e);
    }
  }
  
  // Clean up resize handler if exists
  if(videoEl && videoEl._resizeHandler) {
    window.removeEventListener('resize', videoEl._resizeHandler);
    videoEl._resizeHandler = null;
  }
}

async function startCamera(){
  // Stop any existing camera first
  stopCamera();
  
  try {
    // More flexible camera constraints for better compatibility
    // V2: Request landscape-friendly resolution (wider than tall)
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: {ideal: 1280, min: 640},
        height: {ideal: 720, min: 480},
        frameRate: {ideal: 30, min: 15}
      },
      audio: false
    });
    
    if(!video) {
      throw new Error('Video element not found');
    }
    
    video.srcObject = stream;
    
    // Wait for video to be ready
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        console.log('📹 Video metadata loaded:', {
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          readyState: video.readyState,
          srcObject: !!video.srcObject
        });
        try{
          video.muted = true;
          video.playsInline = true;
          video.setAttribute('playsinline','');
          video.setAttribute('webkit-playsinline','');
          // Ensure visible and stacked under overlays
          video.style.opacity = '1';
          video.style.display = 'block';
          video.style.visibility = 'visible';
          video.style.zIndex = '1';
          
          // Force video dimensions to match container
          const container = video.parentElement;
          if(container) {
            const rect = container.getBoundingClientRect();
            video.style.width = rect.width + 'px';
            video.style.height = rect.height + 'px';
            console.log('📹 Forced video dimensions:', rect.width, 'x', rect.height);
            
            // Add resize handler to maintain video size
            const resizeHandler = () => {
              const newRect = container.getBoundingClientRect();
              video.style.width = newRect.width + 'px';
              video.style.height = newRect.height + 'px';
            };
            window.addEventListener('resize', resizeHandler);
            
            // Store handler for cleanup
            video._resizeHandler = resizeHandler;
          }
          const p = video.play();
          if(p && typeof p.then === 'function'){
            p.catch(err=>console.warn('Warning: video.play() blocked:', err));
          }
        }catch(err){
          console.warn('Warning: Error ensuring video playback:', err);
        }
        resolve();
      };
    });

    // MediaPipe camera util pushes frames to faceMesh
    camera = new Camera(video, {
      onFrame: async () => {
        if(faceMesh) {
          await faceMesh.send({image: video});
        }
      },
      width: video.videoWidth || 720, 
      height: video.videoHeight || 1280
    });
    await camera.start();
    
  console.log('Info: Camera started successfully');
    console.log('📹 Video element check:', {
      video: !!video,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      srcObject: !!video.srcObject,
      style: video.style.cssText,
      visible: video.offsetWidth > 0 && video.offsetHeight > 0
    });
  } catch (error) {
    console.error('❌ Camera initialization failed:', error);
    throw error;
  }
}

// Extract iris center and normalized horizontal eye position
function irisCenter(landmarks, idxs){
  let sx=0, sy=0, n=0;
  for(const i of idxs){
    const lm = landmarks[i];
    if(!lm) continue;
    sx += lm.x; sy += lm.y; n++;
  }
  if(n===0) return null;
  return {x: sx/n, y: sy/n};
}
// Returns {norm, rawIrisX, rawEyeXNorm} or null
function normEyeX(landmarks) {
  const lIn = landmarks[L_CORNER_IN], lOut = landmarks[L_CORNER_OUT];
  const rIn = landmarks[R_CORNER_IN], rOut = landmarks[R_CORNER_OUT];
  if (!lIn || !lOut || !rIn || !rOut) return null;

  const lIris = irisCenter(landmarks, L_IRIS.filter(i => landmarks[i]));
  const rIris = irisCenter(landmarks, R_IRIS.filter(i => landmarks[i]));
  if (!lIris || !rIris) return null;

  // Log raw landmark positions (only every 30 frames to avoid spam)
  if (samples.length % 30 === 0 && running) {
    console.log('📍 RAW LANDMARKS:');
    console.log(`  Left eye: inner=${lIn.x.toFixed(4)}, outer=${lOut.x.toFixed(4)}, iris=${lIris.x.toFixed(4)}`);
    console.log(`  Right eye: inner=${rIn.x.toFixed(4)}, outer=${rOut.x.toFixed(4)}, iris=${rIris.x.toFixed(4)}`);
  }
  
  const leftSpanRaw = Math.abs(lOut.x - lIn.x);
  const rightSpanRaw = Math.abs(rOut.x - rIn.x);

  leftSpanSmooth = smoothSpan(leftSpanSmooth, leftSpanRaw);
  rightSpanSmooth = smoothSpan(rightSpanSmooth, rightSpanRaw);

  const leftSpan = leftSpanSmooth ?? leftSpanRaw;
  const rightSpan = rightSpanSmooth ?? rightSpanRaw;
  
  // Validate spans
  if (leftSpan < 0.01 || rightSpan < 0.01) return null;

  // Per-eye normalization: map iris position within eye to [-1, 1]
  const leftMin = Math.min(lOut.x, lIn.x);
  const lNorm = leftSpan > 0 ? (lIris.x - leftMin) / leftSpan : 0.5;
  const lx = (lNorm * 2 - 1);
  const lxFinal = -lx;

  const rightMin = Math.min(rOut.x, rIn.x);
  const rNorm = rightSpan > 0 ? (rIris.x - rightMin) / rightSpan : 0.5;
  const rx = (rNorm * 2 - 1);
  const rxFinal = -rx;

  const spansReady = (leftSpan > 0 && rightSpan > 0);
  if(spansReady) {
    eyeSelectionCounter++;
    if(!selectedEye && eyeSelectionCounter >= EYE_SELECTION_WARMUP_FRAMES) {
      // Eye identity convention (see src/okn-core/eyeConvention.ts):
      // 'left'/'right' = subject's ANATOMICAL eye (MediaPipe convention)
      // L_IRIS [468-471] = anatomical left, at camera-RIGHT (higher x)
      // Selection picks eye closest to frame center (x=0.5)
      // CSS scaleX(-1) is display-only — landmarks are always in camera coords
      const leftIrisCenter = Math.abs(lIris.x - 0.5);
      const rightIrisCenter = Math.abs(rIris.x - 0.5);
      if(rightIrisCenter < leftIrisCenter) {
        selectedEye = 'right';
      } else {
        selectedEye = 'left';
      }
      console.log(`👁️ Selected eye for tracking: ${selectedEye} (L dist=${leftIrisCenter.toFixed(3)}, R dist=${rightIrisCenter.toFixed(3)})`);
    }
  }

  let activeEye = selectedEye;
  if(!activeEye) {
    activeEye = (rightSpan > leftSpan) ? 'right' : 'left';
  } else {
    if(activeEye === 'left' && leftSpan < 0.01 && rightSpan >= 0.015) {
      console.warn('Warning: Left eye span collapsed; switching to right eye');
      selectedEye = 'right';
      activeEye = 'right';
    } else if(activeEye === 'right' && rightSpan < 0.01 && leftSpan >= 0.015) {
      console.warn('Warning: Right eye span collapsed; switching to left eye');
      selectedEye = 'left';
      activeEye = 'left';
    }
  }

  const result = activeEye === 'right' ? rxFinal : lxFinal;
  const irisX = activeEye === 'right' ? rIris.x : lIris.x;
  const normSpan = activeEye === 'right' ? rightSpan : leftSpan;

  // Raw iris X in MediaPipe normalized coords [0,1] (before any processing)
  const rawIrisX = irisX;
  // Normalized but un-smoothed eye position (before EMA)
  const rawEyeXNorm = result;

  // DIAGNOSTIC: Log every 30 frames
  if (samples.length % 30 === 0 && running) {
    console.log(`👁️ EYE: ${activeEye}, iris=${irisX.toFixed(4)}, span=${normSpan.toFixed(4)}, result=${result.toFixed(4)}`);
  }

  return { norm: result, rawIrisX, rawEyeXNorm, activeEye };
}



// --- Oval calibration helpers (mirrors src/okn-core/ovalCalibration.ts) ---

/** Extract eye contour info from MediaPipe landmarks for oval fit checking. */
function extractEyeContour(landmarks, cornerInIdx, cornerOutIdx) {
  const cIn = landmarks[cornerInIdx];
  const cOut = landmarks[cornerOutIdx];
  if (!cIn || !cOut) return null;
  const span = Math.abs(cIn.x - cOut.x);
  if (span < 0.005) return null; // degenerate
  return {
    center: { x: (cIn.x + cOut.x) / 2, y: (cIn.y + cOut.y) / 2 },
    span: span,
    height: Math.abs(cIn.y - cOut.y) || span / 1.6,
  };
}

/** Check if an eye center (in pixels) is inside an oval (ellipse containment). */
function checkOvalFit(eyePx, eyePy, ovalCx, ovalCy, ovalRx, ovalRy) {
  const dx = eyePx - ovalCx;
  const dy = eyePy - ovalCy;
  const norm = (dx / ovalRx) ** 2 + (dy / ovalRy) ** 2;
  return { fit: norm <= 1.0 };
}

/** Compute median of an array (for robust eye span capture). */
function medianOfArray(arr) {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function calculateIrisSize(landmarks){
  // Calculate iris size from landmarks
  const leftIris = L_IRIS.map(i => landmarks[i]).filter(Boolean);
  const rightIris = R_IRIS.map(i => landmarks[i]).filter(Boolean);
  
  if(leftIris.length < 2 || rightIris.length < 2) return 0;
  
  // Calculate width and height for each iris
  const leftWidth = Math.abs(leftIris[1].x - leftIris[3].x);
  const leftHeight = Math.abs(leftIris[0].y - leftIris[2].y);
  const rightWidth = Math.abs(rightIris[1].x - rightIris[3].x);
  const rightHeight = Math.abs(rightIris[0].y - rightIris[2].y);
  
  // Return average dimension as size metric
  return (leftWidth + leftHeight + rightWidth + rightHeight) / 4;
}

// Attach a ResizeObserver to .test-camera__view so resizeCanvases() fires
// as soon as the view is laid out — fixes blurry canvas on first render
function attachCameraViewResizeObserver() {
  // Disconnect any previous observer
  if (window.__cameraViewRO) {
    window.__cameraViewRO.disconnect();
    window.__cameraViewRO = null;
  }
  if (!window.ResizeObserver) return;
  const view = document.querySelector('.test-camera__view');
  if (!view) return;
  const ro = new ResizeObserver(() => {
    resizeCanvases();
  });
  ro.observe(view);
  window.__cameraViewRO = ro;
}

// Countdown shown after calibration passes, before test starts
function runCalibCountdown() {
  return new Promise(resolve => {
    const el = document.getElementById('calibCountdown');
    if (!el) { resolve(); return; }
    let count = 3;
    const tick = () => {
      el.textContent = count;
      el.classList.remove('hidden');
      // Restart CSS animation by forcing reflow
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
      if (count <= 1) {
        setTimeout(() => {
          el.classList.add('hidden');
          resolve();
        }, 900);
        return;
      }
      count--;
      setTimeout(tick, 1000);
    };
    tick();
  });
}

// Distance calibration step
// Release 3A: Multi-criteria calibration with coaching when FF_RICH_CALIBRATION is true
let lastCalibrationTimeoutInfo = null; // kept for result recording compatibility

async function calibrateDistance(){
  // --- Simple calibration mode (FF_OVAL_CALIBRATION) ---
  // Framing box + high-contrast text. No ovals. Distance = iris size gate.
  if (FF_OVAL_CALIBRATION) {
    return new Promise((resolve) => {
      let stableFrames = 0;
      const spanBuffer = [];
      lastCalibrationTimeoutInfo = null;
      const calibStartMs = performance.now();
      const irisMin = SIMPLE_CALIB_IRIS_TARGET - SIMPLE_CALIB_IRIS_TOL;
      const irisMax = SIMPLE_CALIB_IRIS_TARGET + SIMPLE_CALIB_IRIS_TOL;

      // Calibration state shared with drawEyeOverlay
      window.__calibState = { status: 'searching', hint: '' };

      const interval = setInterval(() => {
        if (lastLandmarksDetected && lastIrisSize > 0) {
          const landmarks = window.__lastMediaPipeLandmarks || null;
          if (!landmarks) return;

          const bothEyes = !!(lastLeftIn && lastLeftOut && lastRightIn && lastRightOut);
          const noseLm = landmarks[NOSE_TIP_IDX];
          const centered = noseLm && noseLm.x >= CENTER_ZONE_X_MIN && noseLm.x <= CENTER_ZONE_X_MAX
                                  && noseLm.y >= CENTER_ZONE_Y_MIN && noseLm.y <= CENTER_ZONE_Y_MAX;
          const distanceOk = lastIrisSize >= irisMin && lastIrisSize <= irisMax;
          const allPass = bothEyes && centered && distanceOk;

          if (allPass) {
            stableFrames++;
            const currentSpan = ((leftSpanSmooth || 0) + (rightSpanSmooth || 0)) / 2;
            if (currentSpan > 0.005) spanBuffer.push(currentSpan);

            window.__calibState = { status: 'holding', hint: '' };
            if (trackingTag) trackingTag.style.display = 'none';

            if (stableFrames >= SIMPLE_CALIB_REQUIRED_STABLE) {
              clearInterval(interval);
              console.log(`Info: Distance calibrated: iris=${lastIrisSize.toFixed(4)}`);
              calibratedEyeSpan = spanBuffer.length > 0 ? medianOfArray(spanBuffer) : null;
              if (calibratedEyeSpan !== null && calibratedEyeSpan <= 0.005) {
                console.warn('Warning: calibratedEyeSpan too small:', calibratedEyeSpan);
                calibratedEyeSpan = null;
              } else {
                console.log('Eye span captured (median of', spanBuffer.length, 'frames):', calibratedEyeSpan?.toFixed(4));
              }
              lastCalibrationTimeoutInfo = null;
              window.__calibDiagnostic = {
                passed: true,
                stableFrames,
                requiredStableFrames: SIMPLE_CALIB_REQUIRED_STABLE,
                durationMs: Math.round(performance.now() - calibStartMs),
                criteria: [
                  { criterion: 'bothEyes', pass: true },
                  { criterion: 'centered', pass: true },
                  { criterion: 'irisDistance', pass: true },
                ],
                failureCodes: [],
                failureHistory: [],
                lastNosePosition: noseLm ? { x: noseLm.x, y: noseLm.y } : null,
                lastEyeCorners: [
                  lastLeftIn ? { x: lastLeftIn.x, y: lastLeftIn.y } : null,
                  lastLeftOut ? { x: lastLeftOut.x, y: lastLeftOut.y } : null,
                  lastRightIn ? { x: lastRightIn.x, y: lastRightIn.y } : null,
                  lastRightOut ? { x: lastRightOut.x, y: lastRightOut.y } : null,
                ].filter(Boolean),
              };
              window.__calibState = null;
              resolve(true);
            }
          } else {
            if (stableFrames > 0) stableFrames = Math.max(0, stableFrames - 3);
            // Priority hints
            let hint;
            if (!bothEyes) {
              hint = 'Show both eyes';
            } else if (!centered) {
              hint = 'Center your face';
            } else if (lastIrisSize > irisMax) {
              hint = 'Move farther away';
            } else {
              hint = 'Move closer';
            }
            window.__calibState = { status: 'adjusting', hint };
            if (trackingTag) trackingTag.style.display = 'none';
          }
        } else {
          window.__calibState = { status: 'searching', hint: 'Look at camera' };
          if (trackingTag) trackingTag.style.display = 'none';
        }
      }, 100);
    });
  }

  // --- Legacy calibration modes below ---
  const TARGET = 0.06;
  const TOLERANCE = 0.01;
  const minSize = TARGET - TOLERANCE;
  const maxSize = TARGET + TOLERANCE;
  const REQUIRED_STABLE = FF_RICH_CALIBRATION ? CALIB_REQUIRED_STABLE : 20;

  let stableFrames = 0;
  let lastUpdate = 0;
  const noseHistory = []; // for motion stability check
  let lastFailingCriteria = []; // Release 3C: track what's failing
  lastCalibrationTimeoutInfo = null;
  const calibStartMs = performance.now();
  const calibFailureHistory = [];

  // Release 3A: Multi-criteria check (pure function, mirrors src/okn-core/calibrationChecks.ts)
  function checkAllCriteria(landmarks) {
    const failing = [];

    // 1. Both eyes visible
    const lIn = lastLeftIn, lOut = lastLeftOut, rIn = lastRightIn, rOut = lastRightOut;
    if (!lIn || !lOut || !rIn || !rOut) {
      failing.push({ criterion: 'bothEyes', hint: 'Face not fully detected' });
    } else {
      const leftSpan = Math.abs(lIn.x - lOut.x);
      const rightSpan = Math.abs(rOut.x - rIn.x);
      if (leftSpan < MIN_EYE_SPAN_NORM && rightSpan < MIN_EYE_SPAN_NORM) {
        failing.push({ criterion: 'bothEyes', hint: 'Both eyes too small — move closer' });
      } else if (leftSpan < MIN_EYE_SPAN_NORM) {
        failing.push({ criterion: 'bothEyes', hint: 'Left eye partially hidden' });
      } else if (rightSpan < MIN_EYE_SPAN_NORM) {
        failing.push({ criterion: 'bothEyes', hint: 'Right eye partially hidden' });
      }
    }

    // 2. Face in safe zone (using nose landmark if available, fall back to iris center)
    const noseLm = landmarks ? landmarks[NOSE_TIP_IDX] : null;
    if (noseLm) {
      const hints = [];
      if (noseLm.x < SAFE_ZONE_X_MIN) hints.push('Move left');
      if (noseLm.x > SAFE_ZONE_X_MAX) hints.push('Move right');
      if (noseLm.y < SAFE_ZONE_Y_MIN) hints.push('Move down');
      if (noseLm.y > SAFE_ZONE_Y_MAX) hints.push('Move up');
      if (hints.length) failing.push({ criterion: 'safeZone', hint: hints.join(', ') });
    }

    // 2b. Face centering (blocking — center 50% of frame)
    if (noseLm) {
      const cHints = [];
      if (noseLm.x < CENTER_ZONE_X_MIN) cHints.push('Move left');
      if (noseLm.x > CENTER_ZONE_X_MAX) cHints.push('Move right');
      if (noseLm.y < CENTER_ZONE_Y_MIN) cHints.push('Move down');
      if (noseLm.y > CENTER_ZONE_Y_MAX) cHints.push('Move up');
      if (cHints.length) failing.push({ criterion: 'faceCentering', hint: 'Center your face: ' + cHints.join(', ') });
    }

    // 3. Head pose check (yaw and pitch)
    const faceEdgeL = landmarks ? landmarks[FACE_EDGE_L_IDX] : null;
    const faceEdgeR = landmarks ? landmarks[FACE_EDGE_R_IDX] : null;
    if (noseLm && faceEdgeL && faceEdgeR) {
      const faceMidX = (faceEdgeL.x + faceEdgeR.x) / 2;
      const yawDev = noseLm.x - faceMidX;
      if (Math.abs(yawDev) > YAW_LIMIT_NORM) {
        failing.push({ criterion: 'headPose', hint: yawDev > 0 ? 'Turn head right' : 'Turn head left' });
      }
      // Pitch check
      const foreheadLm = landmarks[FOREHEAD_IDX];
      const chinLm = landmarks[CHIN_IDX];
      if (foreheadLm && chinLm) {
        const faceH = Math.abs(chinLm.y - foreheadLm.y);
        if (faceH > 0) {
          const noseFrac = (noseLm.y - foreheadLm.y) / faceH;
          const pitchDev = noseFrac - 0.6;
          if (Math.abs(pitchDev) > PITCH_LIMIT_NORM) {
            failing.push({ criterion: 'headPose', hint: pitchDev > 0 ? 'Tilt head up' : 'Tilt head down' });
          }
        }
      }
    }

    // 4. Motion stability
    if (noseLm) {
      noseHistory.push({ x: noseLm.x, y: noseLm.y });
      if (noseHistory.length > 15) noseHistory.shift();
    }
    if (noseHistory.length >= 5) {
      const recent = noseHistory.slice(-10);
      const meanX = recent.reduce((a, p) => a + p.x, 0) / recent.length;
      const varX = recent.reduce((a, p) => a + (p.x - meanX) ** 2, 0) / recent.length;
      const meanY = recent.reduce((a, p) => a + p.y, 0) / recent.length;
      const varY = recent.reduce((a, p) => a + (p.y - meanY) ** 2, 0) / recent.length;
      const maxSigma = Math.max(Math.sqrt(varX), Math.sqrt(varY));
      if (maxSigma > NOSE_MOTION_SIGMA_MAX) {
        failing.push({ criterion: 'motionStability', hint: 'Hold as steady as you can' });
      }
    } else {
      failing.push({ criterion: 'motionStability', hint: 'Stabilizing...' });
    }

    // 5. Iris size (original criterion, always checked)
    if (lastIrisSize < minSize || lastIrisSize > maxSize) {
      const tooClose = lastIrisSize > maxSize;
      failing.push({ criterion: 'irisSize', hint: tooClose ? 'Move farther' : 'Move closer' });
    }

    return failing;
  }

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const now = performance.now();
      lastUpdate = now;

      if(lastLandmarksDetected && lastIrisSize > 0){
        if(stableFrames % 10 === 0) {
          console.log(`📏 Calibration: iris size ${lastIrisSize.toFixed(4)} (target: ${TARGET}±${TOLERANCE}), stable: ${stableFrames}/${REQUIRED_STABLE}, rich=${FF_RICH_CALIBRATION}`);
        }

        if (FF_RICH_CALIBRATION) {
          // Multi-criteria calibration (Release 3A)
          const landmarks = window.__lastMediaPipeLandmarks || null;
          const failing = checkAllCriteria(landmarks);
          lastFailingCriteria = failing.map(f => f.criterion);

          if (failing.length === 0) {
            // All criteria pass — increment stable counter
            stableFrames++;
            const progress = Math.min(100, (stableFrames / REQUIRED_STABLE) * 100);
            const secondsLeft = Math.max(0, Math.ceil((REQUIRED_STABLE - stableFrames) / 10));
            if(trackingTag) {
              trackingTag.textContent = `Stable hold ${secondsLeft}s (${progress.toFixed(0)}%)`;
              trackingTag.className = 'tag ok';
            }
            // Update coaching UI elements if available
            const calText = document.getElementById('calibrationText');
            const calInstr = document.getElementById('calibrationInstruction');
            if (calText) calText.textContent = '';
            if (calInstr) calInstr.textContent = '';

            if(stableFrames >= REQUIRED_STABLE){
              clearInterval(interval);
              console.log(`Info: Distance calibrated (rich): ${lastIrisSize.toFixed(4)}`);
              calibratedEyeSpan = ((leftSpanSmooth || 0) + (rightSpanSmooth || 0)) / 2;
              if (calibratedEyeSpan <= 0.005) {
                console.warn('Warning: calibratedEyeSpan too small:', calibratedEyeSpan);
                calibratedEyeSpan = null;
              } else {
                console.log('Eye span captured at calibration:', calibratedEyeSpan.toFixed(4));
              }
              lastCalibrationTimeoutInfo = null; // success, no timeout
              // Store calibration diagnostic for SessionDiagnostic at test-end
              const calibNose = landmarks ? landmarks[NOSE_TIP_IDX] : null;
              window.__calibDiagnostic = {
                passed: true,
                stableFrames: stableFrames,
                requiredStableFrames: REQUIRED_STABLE,
                durationMs: Math.round(performance.now() - calibStartMs),
                criteria: [
                  { criterion: 'bothEyes', pass: true },
                  { criterion: 'safeZone', pass: true },
                  { criterion: 'faceCentering', pass: true },
                  { criterion: 'headPose', pass: true },
                  { criterion: 'motionStability', pass: true },
                  { criterion: 'irisSize', pass: true }
                ],
                failureCodes: [],
                failureHistory: calibFailureHistory,
                // Snapshot framing state at calibration time (landmarks overwritten during test)
                lastNosePosition: calibNose ? { x: calibNose.x, y: calibNose.y } : null,
                lastEyeCorners: [
                  lastLeftIn ? { x: lastLeftIn.x, y: lastLeftIn.y } : null,
                  lastLeftOut ? { x: lastLeftOut.x, y: lastLeftOut.y } : null,
                  lastRightIn ? { x: lastRightIn.x, y: lastRightIn.y } : null,
                  lastRightOut ? { x: lastRightOut.x, y: lastRightOut.y } : null,
                ].filter(Boolean)
              };
              resolve(true);
            }
          } else {
            // At least one criterion fails — decay counter (tolerant of occasional wobble)
            if(stableFrames > 0) stableFrames = Math.max(0, stableFrames - 3);
            // Priority-ordered: show highest-priority failing criterion
            const priorityOrder = ['bothEyes', 'safeZone', 'faceCentering', 'headPose', 'motionStability', 'irisSize'];
            failing.sort((a, b) => priorityOrder.indexOf(a.criterion) - priorityOrder.indexOf(b.criterion));
            failing.forEach(f => calibFailureHistory.push(f.criterion));
            const topFail = failing[0];

            if(trackingTag) {
              trackingTag.textContent = topFail.hint;
              trackingTag.className = 'tag warn';
            }
            // Update coaching UI
            const calText = document.getElementById('calibrationText');
            const calInstr = document.getElementById('calibrationInstruction');
            if (calText) calText.textContent = topFail.hint;
            if (calInstr && failing.length > 1) {
              calInstr.textContent = failing.slice(1).map(f => f.hint).join(' | ');
            } else if (calInstr) {
              calInstr.textContent = '';
            }
          }
        } else {
          // Original iris-size-only calibration (FF_RICH_CALIBRATION = false)
          if(lastIrisSize >= minSize && lastIrisSize <= maxSize){
            stableFrames++;
            const progress = Math.min(100, (stableFrames / REQUIRED_STABLE) * 100);
            const secondsLeft = Math.max(0, Math.ceil((REQUIRED_STABLE - stableFrames) / 10));
            if(trackingTag) {
              trackingTag.textContent = `Stable hold ${secondsLeft}s (${progress.toFixed(0)}%)`;
              trackingTag.className = 'tag ok';
            }
            if(stableFrames >= REQUIRED_STABLE){
              clearInterval(interval);
              console.log(`Info: Distance calibrated: ${lastIrisSize.toFixed(4)}`);
              calibratedEyeSpan = ((leftSpanSmooth || 0) + (rightSpanSmooth || 0)) / 2;
              if (calibratedEyeSpan <= 0.005) {
                console.warn('Warning: calibratedEyeSpan too small:', calibratedEyeSpan);
                calibratedEyeSpan = null;
              } else {
                console.log('Eye span captured at calibration:', calibratedEyeSpan.toFixed(4));
              }
              lastCalibrationTimeoutInfo = null;
              resolve(true);
            }
          } else {
            if(stableFrames > 0) stableFrames = Math.max(0, stableFrames - 3);
            const tooClose = lastIrisSize > maxSize;
            const tooFar = lastIrisSize < minSize;
            const guidance = tooClose ? 'Move farther' : tooFar ? 'Move closer' : 'Hold as steady as you can';
            if(trackingTag) {
              trackingTag.textContent = `${guidance} (iris ${lastIrisSize.toFixed(3)})`;
              trackingTag.className = 'tag warn';
            }
          }
        }
      } else {
        if(trackingTag) {
          trackingTag.textContent = 'Look at camera';
          trackingTag.className = 'tag warn';
        }
      }
    }, 100);

    // No timeout — calibration continues until user satisfies all checks
  });
}

// Draw landmarks & ROI overlay
function drawEyeOverlay(landmarks){
  if(!eyeCanvas || !eyeCtx) return;
  
  const w = eyeCanvas.width, h = eyeCanvas.height;
  eyeCtx.clearRect(0,0,w,h);

  // V2: Always draw landmarks during calibration so user can verify tracking
  const shouldDrawLandmarks = isCalibrating || (drawLandmarksToggle && drawLandmarksToggle.checked);
  if(!shouldDrawLandmarks) return;
  // During oval calibration, draw ovals even without landmarks (guides the user)
  if(!landmarks && !(isCalibrating && FF_OVAL_CALIBRATION)) return;

  // draw a few keypoints (corners + iris centers)
  // V2: Always mirror canvas to match CSS scaleX(-1) on <video>
  eyeCtx.save();

  // Compute video render rect for object-fit: contain alignment
  const vw = video.videoWidth||1280, vh = video.videoHeight||720;
  const containerAR = w / h;
  const videoAR = vw / vh;
  let rx = 0, ry = 0, rw = w, rh = h;
  if (vw > 0 && vh > 0 && Math.abs(containerAR - videoAR) > 0.01) {
    if (videoAR > containerAR) {
      rw = w; rh = w / videoAR; ry = (h - rh) / 2;
    } else {
      rh = h; rw = h * videoAR; rx = (w - rw) / 2;
    }
  }
  eyeCtx.translate(rx + rw, ry); eyeCtx.scale(-1, 1);
  const sx = rw, sy = rh;

  eyeCtx.lineWidth = 2;
  eyeCtx.strokeStyle = '#4da3ff';
  eyeCtx.fillStyle = '#4da3ff';

  const drawPoint = (lm, radius, color) => {
    const x = lm.x*sx; const y = lm.y*sy;
    eyeCtx.fillStyle = color || '#4da3ff';
    eyeCtx.beginPath(); eyeCtx.arc(x,y,radius||3,0,Math.PI*2); eyeCtx.fill();
  };

  // Draw eye corner landmarks (green) and iris landmarks (blue)
  // Skip during calibration to reduce visual clutter — safe zone + selected eye ring are enough
  if (!isCalibrating) {
    [L_CORNER_IN,L_CORNER_OUT,R_CORNER_IN,R_CORNER_OUT].forEach(i=>{
      if(landmarks[i]) drawPoint(landmarks[i], 4, '#3ad29f');
    });
    L_IRIS.concat(R_IRIS).forEach(i=>{ if(landmarks[i]) drawPoint(landmarks[i], 3, '#4da3ff'); });
  }

  // During calibration: draw framing box or legacy safe zone
  if(isCalibrating) {
    if (FF_OVAL_CALIBRATION) {
      // Framing box + text drawn after restore() in raw canvas space
    } else {
      // --- Legacy safe zone overlay (Release 3B) ---
      if (FF_RICH_CALIBRATION) {
        const szX1 = SAFE_ZONE_X_MIN * sx;
        const szY1 = SAFE_ZONE_Y_MIN * sy;
        const szX2 = SAFE_ZONE_X_MAX * sx;
        const szY2 = SAFE_ZONE_Y_MAX * sy;
        const noseLm = landmarks[NOSE_TIP_IDX];
        const inZone = noseLm && noseLm.x >= SAFE_ZONE_X_MIN && noseLm.x <= SAFE_ZONE_X_MAX
                              && noseLm.y >= SAFE_ZONE_Y_MIN && noseLm.y <= SAFE_ZONE_Y_MAX;
        eyeCtx.setLineDash([8, 6]);
        eyeCtx.strokeStyle = inZone ? 'rgba(58, 210, 159, 0.6)' : 'rgba(255, 204, 102, 0.6)';
        eyeCtx.lineWidth = 2;
        eyeCtx.strokeRect(szX1, szY1, szX2 - szX1, szY2 - szY1);
        eyeCtx.setLineDash([]);
      }

      // Draw eye corner-to-corner lines
      const lIn = landmarks[L_CORNER_IN], lOut = landmarks[L_CORNER_OUT];
      const rIn = landmarks[R_CORNER_IN], rOut = landmarks[R_CORNER_OUT];
      eyeCtx.strokeStyle = 'rgba(58,210,159,0.5)';
      eyeCtx.lineWidth = 1;
      if(lIn && lOut) {
        eyeCtx.beginPath(); eyeCtx.moveTo(lOut.x*sx, lOut.y*sy); eyeCtx.lineTo(lIn.x*sx, lIn.y*sy); eyeCtx.stroke();
      }
      if(rIn && rOut) {
        eyeCtx.beginPath(); eyeCtx.moveTo(rIn.x*sx, rIn.y*sy); eyeCtx.lineTo(rOut.x*sx, rOut.y*sy); eyeCtx.stroke();
      }
    }
  }

  eyeCtx.restore();

  // Draw framing box + hint text in CSS pixel coords (DPR transform is active via setTransform)
  if (isCalibrating && FF_OVAL_CALIBRATION) {
    // Work in CSS pixel coords — eyeCtx has setTransform(dpr,0,0,dpr,0,0) applied
    const pw = oknWidth, ph = oknHeight;

    // Video render rect in raw pixels
    const vw2 = video ? (video.videoWidth || 1280) : 1280;
    const vh2 = video ? (video.videoHeight || 720) : 720;
    const cAR = pw / ph, vAR = vw2 / vh2;
    let bx = 0, by = 0, bw = pw, bh = ph;
    if (vw2 > 0 && vh2 > 0 && Math.abs(cAR - vAR) > 0.01) {
      if (vAR > cAR) { bw = pw; bh = pw / vAR; by = (ph - bh) / 2; }
      else { bh = ph; bw = ph * vAR; bx = (pw - bw) / 2; }
    }
    const inset = FRAMING_BOX_INSET;
    const boxX = bx + inset * bw;
    const boxY = by + inset * bh;
    const boxW = bw * (1 - 2 * inset);
    const boxH = bh * (1 - 2 * inset);

    const cs = window.__calibState || { status: 'searching', hint: '' };
    const isGood = cs.status === 'holding';

    // Solid framing box
    eyeCtx.imageSmoothingEnabled = false;
    eyeCtx.strokeStyle = isGood ? 'rgba(58, 210, 159, 0.8)' : 'rgba(255, 255, 255, 0.45)';
    eyeCtx.lineWidth = isGood ? 2.5 : 1.5;
    eyeCtx.strokeRect(boxX, boxY, boxW, boxH);

    // Corner accents
    const cornerLen = Math.min(boxW, boxH) * 0.06;
    eyeCtx.strokeStyle = isGood ? 'rgba(58, 210, 159, 1)' : 'rgba(255, 255, 255, 0.85)';
    eyeCtx.lineWidth = 2.5;
    const corners = [
      [boxX, boxY], [boxX + boxW, boxY],
      [boxX, boxY + boxH], [boxX + boxW, boxY + boxH],
    ];
    corners.forEach(([cx, cy]) => {
      const dx = cx === boxX ? 1 : -1;
      const dy = cy === boxY ? 1 : -1;
      eyeCtx.beginPath();
      eyeCtx.moveTo(cx + dx * cornerLen, cy);
      eyeCtx.lineTo(cx, cy);
      eyeCtx.lineTo(cx, cy + dy * cornerLen);
      eyeCtx.stroke();
    });

    // Hint text — clamped so pill never exceeds 50% of box width
    if (cs.hint && cs.status !== 'holding') {
      const maxPillFrac = 0.50;
      const refSize = 24;
      eyeCtx.font = `600 ${refSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`;
      const refW = eyeCtx.measureText(cs.hint).width;
      const textRatio = refW / refSize;

      const padXR = 0.5, padYR = 0.35;
      let fontSize = Math.max(14, Math.round(boxW * 0.025));
      const maxPillW = boxW * maxPillFrac;
      if (fontSize * (textRatio + padXR * 2) > maxPillW) {
        fontSize = Math.max(10, Math.floor(maxPillW / (textRatio + padXR * 2)));
      }

      eyeCtx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`;
      eyeCtx.textAlign = 'center';
      eyeCtx.textBaseline = 'middle';
      const textX = bx + bw / 2;
      const textY = boxY + fontSize * 1.6;
      const textW = eyeCtx.measureText(cs.hint).width;
      const pillW = textW + fontSize * padXR * 2;
      const pillH = fontSize + fontSize * padYR * 2;
      const pillR = pillH / 2;
      eyeCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      eyeCtx.beginPath();
      eyeCtx.roundRect(textX - pillW / 2, textY - pillH / 2, pillW, pillH, pillR);
      eyeCtx.fill();
      eyeCtx.fillStyle = '#ffffff';
      eyeCtx.fillText(cs.hint, textX, textY);
    }
  }
}

// Called each frame by MediaPipe
let lastFrameTs = 0;
async function onResults(results) {
  let landmarks = null;
  if (results && results.multiFaceLandmarks && results.multiFaceLandmarks[0]) {
    landmarks = results.multiFaceLandmarks[0];
  }

  // Update iris size for calibration (always)
  // Store for multi-criteria calibration access (Release 3A)
  window.__lastMediaPipeLandmarks = landmarks;
  if (landmarks) {
    lastIrisSize = calculateIrisSize(landmarks);
    lastLandmarksDetected = true;
    // Track normalized eye position during calibration too
    const eyeResultCal = normEyeX(landmarks);
    if(eyeResultCal != null) lastEyeXNorm = eyeResultCal.norm;
    // Store individual iris positions for calibration overlay
    lastLeftIris = irisCenter(landmarks, L_IRIS.filter(i => landmarks[i]));
    lastRightIris = irisCenter(landmarks, R_IRIS.filter(i => landmarks[i]));
    lastLeftIn = landmarks[L_CORNER_IN] || null;
    lastLeftOut = landmarks[L_CORNER_OUT] || null;
    lastRightIn = landmarks[R_CORNER_IN] || null;
    lastRightOut = landmarks[R_CORNER_OUT] || null;
  } else {
    lastLandmarksDetected = false;
  }

  // During calibration, draw overlay (landmarks + ovals) on the eye canvas
  // Oval mode: draw ovals even without landmarks so user sees the targets
  if (isCalibrating && (landmarks || FF_OVAL_CALIBRATION)) {
    drawEyeOverlay(landmarks);
  }

  if (!running || startedAt === 0) return;

  const now = performance.now();
  const elapsed = now - startedAt;
  
  if (!lastTs) lastTs = now;
  const dt = (now - lastTs) / 1000;
  lastTs = now;

  // Draw stimulus
  drawStimulus(dt);

  // Get eye position (returns {norm, rawIrisX, rawEyeXNorm} or null)
  let eyeXNorm = null;
  let rawIrisX = null;
  let rawEyeXNorm = null;
  let sampleActiveEye = null;
  // Per-frame metadata for sidecar JSON
  let frameFaceDetected = !!(results && results.multiFaceLandmarks && results.multiFaceLandmarks[0]);
  let frameIrisLandmarks = null;
  let frameEyeCorners = null;
  let frameHeadLandmarks = null;
  let frameEyelidLandmarks = null;
  let frameStimPhase = stimPhase;
  if (landmarks) {
    const eyeResult = normEyeX(landmarks);
    if (eyeResult != null) {
      eyeXNorm = eyeResult.norm;
      rawIrisX = eyeResult.rawIrisX;
      rawEyeXNorm = eyeResult.rawEyeXNorm;
      sampleActiveEye = eyeResult.activeEye;
    }
    // Capture all 4 iris landmarks per eye (indices 468-471 left, 473-476 right)
    frameIrisLandmarks = {
      left: L_IRIS.map(i => landmarks[i] ? [landmarks[i].x, landmarks[i].y] : null),
      right: R_IRIS.map(i => landmarks[i] ? [landmarks[i].x, landmarks[i].y] : null)
    };
    // Capture eye corner positions
    frameEyeCorners = {
      leftInner: landmarks[L_CORNER_IN] ? [landmarks[L_CORNER_IN].x, landmarks[L_CORNER_IN].y] : null,
      leftOuter: landmarks[L_CORNER_OUT] ? [landmarks[L_CORNER_OUT].x, landmarks[L_CORNER_OUT].y] : null,
      rightInner: landmarks[R_CORNER_IN] ? [landmarks[R_CORNER_IN].x, landmarks[R_CORNER_IN].y] : null,
      rightOuter: landmarks[R_CORNER_OUT] ? [landmarks[R_CORNER_OUT].x, landmarks[R_CORNER_OUT].y] : null
    };
    // Release 2C: Head/face landmark instrumentation for motion contamination analysis
    frameHeadLandmarks = {
      nose: landmarks[NOSE_TIP_IDX] ? [landmarks[NOSE_TIP_IDX].x, landmarks[NOSE_TIP_IDX].y] : null,
      forehead: landmarks[FOREHEAD_IDX] ? [landmarks[FOREHEAD_IDX].x, landmarks[FOREHEAD_IDX].y] : null,
      chin: landmarks[CHIN_IDX] ? [landmarks[CHIN_IDX].x, landmarks[CHIN_IDX].y] : null,
      faceEdgeL: landmarks[FACE_EDGE_L_IDX] ? [landmarks[FACE_EDGE_L_IDX].x, landmarks[FACE_EDGE_L_IDX].y] : null,
      faceEdgeR: landmarks[FACE_EDGE_R_IDX] ? [landmarks[FACE_EDGE_R_IDX].x, landmarks[FACE_EDGE_R_IDX].y] : null
    };
    // Release 5A: Eyelid landmarks for blink/PERCLOS detection (video pipeline)
    frameEyelidLandmarks = {
      leftUpper: landmarks[L_LID_UPPER] ? [landmarks[L_LID_UPPER].x, landmarks[L_LID_UPPER].y] : null,
      leftLower: landmarks[L_LID_LOWER] ? [landmarks[L_LID_LOWER].x, landmarks[L_LID_LOWER].y] : null,
      rightUpper: landmarks[R_LID_UPPER] ? [landmarks[R_LID_UPPER].x, landmarks[R_LID_UPPER].y] : null,
      rightLower: landmarks[R_LID_LOWER] ? [landmarks[R_LID_LOWER].x, landmarks[R_LID_LOWER].y] : null
    };
  }

  // Scale to pixels AFTER getting normalized position
  const EYE_PIX_SCALE = oknWidth || 667; // match segment-level: eyeXpx = eyeXNorm * canvasWidth
  let eyeXpx = null;
  if (eyeXNorm != null && isFinite(eyeXNorm)) {
    eyeXpx = eyeXNorm * EYE_PIX_SCALE;
  }

  // --- Iteration 3: Median filter replaces EMA for position smoothing ---
  // 3-sample median filter preserves saccadic edges (step changes) while
  // removing single-frame outliers from MediaPipe jitter.
  if (eyeXNorm != null && isFinite(eyeXNorm)) {
    medianBufNorm.push(eyeXNorm);
    if (medianBufNorm.length > 3) medianBufNorm.shift();
    if (medianBufNorm.length >= 3) {
      const sorted = medianBufNorm.slice().sort((a, b) => a - b);
      eyeNormEma = sorted[1]; // median of 3
      haveNormEma = true;
    } else if (!haveNormEma) {
      eyeNormEma = eyeXNorm;
      haveNormEma = true;
    }
  }

  // DIAGNOSTIC: Log scaling (every 150 frames to reduce overhead)
  if (samples.length % 150 === 0 && samples.length > 0) {
    console.log(`SCALING: eyeXNorm=${eyeXNorm?.toFixed(4) || 'null'}, PIX_SCALE=${EYE_PIX_SCALE.toFixed(2)}, eyeXpx=${eyeXpx?.toFixed(2) || 'null'}, oknW=${oknWidth}`);
  }

  // Median filter for pixel-space position
  if (eyeXpx != null) {
    medianBufPx.push(eyeXpx);
    if (medianBufPx.length > 3) medianBufPx.shift();
    if (medianBufPx.length >= 3) {
      const sorted = medianBufPx.slice().sort((a, b) => a - b);
      eyeEma = sorted[1];
      haveEma = true;
    } else if (!haveEma) {
      eyeEma = eyeXpx;
      haveEma = true;
      lastValidEyeX = eyeXpx;
      lastValidTime = now;
    }
  }

  // --- Iteration 2 & 3: Sample-to-sample velocity (not 3-frame window) ---
  // At 30 Hz, sample-to-sample gives ~33ms window — better temporal resolution
  // for catching saccades than the old 3-frame (~100ms) approach.
  let eyeV = null;
  let eyeVNorm = null;
  if (samples.length >= 1 && haveNormEma) {
    const prev = samples[samples.length - 1];
    if (prev.usable && prev.eyeXNorm != null) {
      const dtSec = (elapsed - prev.t) / 1000;
      if (dtSec > 0) {
        eyeVNorm = (eyeNormEma - prev.eyeXNorm) / dtSec;
      }
    }
  }

  if (samples.length >= 1 && eyeEma != null) {
    const prev = samples[samples.length - 1];
    if (prev.usable && prev.eyeX != null) {
      const dtSec = (elapsed - prev.t) / 1000;
      if (dtSec > 0) {
        eyeV = (eyeEma - prev.eyeX) / dtSec;
      }
    }
  }

  // DIAGNOSTIC: Log position and velocity (every 150 frames to reduce overhead)
  if (samples.length % 150 === 0 && samples.length > 0) {
    console.log(`MOTION: eyeEma=${eyeEma?.toFixed(2) || 'null'}px, eyeV=${eyeV?.toFixed(2) || 'null'}px/s, normMedian=${eyeNormEma?.toFixed(4) || 'null'}, stimPhase=${stimPhase.toFixed(2)}`);
  }

  // Stimulus tracking
  const stimV = stimSpeed; // constant rightward (adapted to canvas width)
  const stimX = stimPhase;
  const stimVNorm = oknWidth > 0 ? stimSpeed / oknWidth : 0;
  const stimXNorm = oknWidth > 0 ? stimPhase / oknWidth : 0;

  // --- Iteration 2: Pixel-space gain per frame ---
  let gainPx = null;
  if (eyeV != null && isFinite(eyeV) && stimSpeed > 0) {
    gainPx = eyeV / stimSpeed;
  }

  // Quality gate with better saccade detection
  let usable = landmarks && haveNormEma;

  if (usable && samples.length > 2) {
    const prev = samples[samples.length - 1];
    const posJumpNorm = Math.abs(eyeNormEma - (prev.eyeXNorm ?? eyeNormEma));
    const expectedMoveNorm = Math.abs(stimVNorm * dt);

    // Use the LARGER of expected movement * 3 or the noise floor.
    // At high fps, expectedMoveNorm * 3 drops below MediaPipe jitter (~0.005-0.008/frame),
    // causing ~38% of frames to be falsely rejected.
    const jumpThreshold = Math.max(expectedMoveNorm * 3, MIN_USABLE_NOISE_FLOOR);
    if (posJumpNorm > jumpThreshold) {
      usable = false;
    }

    // Velocity check: also apply noise floor (convert to velocity: noise_floor / dt)
    if (eyeVNorm != null) {
      const velThreshold = Math.max(stimVNorm * 5, MIN_USABLE_NOISE_FLOOR / Math.max(dt, 0.001));
      if (Math.abs(eyeVNorm) > velThreshold) {
        usable = false;
      }
    }
  }

  samples.push({
    t: elapsed,
    stimX,
    stimV,
    stimXNorm,
    stimVNorm,
    eyeX: eyeEma ?? prevOr(0),
    eyeXNorm: haveNormEma ? eyeNormEma : (samples.length ? samples[samples.length-1].eyeXNorm : eyeXNorm ?? 0),
    eyeV: eyeV ?? 0,
    eyeVNorm: eyeVNorm ?? 0,
    rawIrisX: rawIrisX,
    rawEyeXNorm: rawEyeXNorm,
    gainPx: gainPx,
    canvasWidth: oknWidth || (samples.length ? samples[samples.length-1].canvasWidth : oknWidth || 1),
    usable,
    slowPhaseSegId: 0,
    selectedEye: sampleActiveEye,
    faceDetected: frameFaceDetected,
    irisLandmarks: frameIrisLandmarks,
    eyeCorners: frameEyeCorners,
    headLandmarks: frameHeadLandmarks,
    eyelidLandmarks: frameEyelidLandmarks,
    stimPhase: frameStimPhase
  });
  
  if (!fpsDetected) detectFpsAndAdapt(samples);
  if (usable) usableFrames++;

  // Release 4B: Live quality indicator — update trackingTag color every 15 frames
  if (trackingTag && samples.length > 1 && samples.length % 15 === 0) {
    const usableFrac = usableFrames / samples.length;
    if (usableFrac > 0.8) {
      trackingTag.className = 'tag ok';
    } else if (usableFrac > 0.6) {
      trackingTag.className = 'tag warn';
    } else {
      trackingTag.className = 'tag bad';
    }
  }

  drawEyeOverlay(landmarks);
  drawWaveform();

  if (mFrames) mFrames.textContent = samples.length.toString();

  setProgress(elapsed / DURATION_MS);
  if (elapsed >= DURATION_MS) {
    stopTest();
  }
}



function prevOr(v){ return samples.length? samples[samples.length-1].eyeX : v; }

function drawWaveform(){
  if(!waveformCanvas || !waveCtx) return;

  const w = waveformCanvas.width, h = waveformCanvas.height;
  waveCtx.clearRect(0,0,w,h);

  const N = samples.length;
  if(N<2) return;

  // Time axis
  const T = Math.max(DURATION_MS, samples[N-1].t) / 1000;
  const scaleX = w / T;

  // Auto-scale Y axis based on actual eye position range
  let minEye = Infinity, maxEye = -Infinity;
  for(let i=0;i<N;i++){
    const s = samples[i];
    if(s.usable && s.eyeXNorm != null && isFinite(s.eyeXNorm)){
      if(s.eyeXNorm < minEye) minEye = s.eyeXNorm;
      if(s.eyeXNorm > maxEye) maxEye = s.eyeXNorm;
    }
  }
  if(!isFinite(minEye) || !isFinite(maxEye) || maxEye - minEye < 0.001) return;

  const eyeRange = maxEye - minEye;
  const eyeMid = (maxEye + minEye) / 2;
  const margin = 0.15; // 15% margin top/bottom
  const scaleY = (h * (1 - 2 * margin)) / eyeRange;
  const yMid = h / 2;

  // Center axis
  waveCtx.strokeStyle = '#1a2230';
  waveCtx.lineWidth = 1;
  waveCtx.beginPath();
  waveCtx.moveTo(0, yMid); waveCtx.lineTo(w, yMid);
  waveCtx.stroke();

  // Draw slow-phase segments as highlighted background
  waveCtx.fillStyle = 'rgba(77, 163, 255, 0.08)';
  for(let i=0;i<N;i++){
    if(samples[i].slowPhaseSegId > 0){
      const segStart = i;
      const segId = samples[i].slowPhaseSegId;
      while(i < N && samples[i].slowPhaseSegId === segId) i++;
      const segEnd = i - 1;
      const x1 = (samples[segStart].t / 1000) * scaleX;
      const x2 = (samples[segEnd].t / 1000) * scaleX;
      waveCtx.fillRect(x1, 0, x2 - x1, h);
      i--; // counteract loop increment
    }
  }

  // Eye position trace — blue for slow phase, gray for non-tracking
  waveCtx.lineWidth = 2;
  let prevX = null, prevY = null;
  let prevInSlow = false;
  for(let i=0;i<N;i++){
    const s = samples[i];
    if(!s.usable || s.eyeXNorm == null || !isFinite(s.eyeXNorm)){
      prevX = null; prevY = null;
      continue;
    }

    const t = s.t/1000;
    const x = t * scaleX;
    const y = yMid - (s.eyeXNorm - eyeMid) * scaleY;
    const inSlowPhase = s.slowPhaseSegId > 0;

    if(prevX !== null){
      waveCtx.strokeStyle = inSlowPhase ? '#4da3ff' : '#556677';
      waveCtx.beginPath();
      waveCtx.moveTo(prevX, prevY);
      waveCtx.lineTo(x, y);
      waveCtx.stroke();
    }

    prevX = x; prevY = y; prevInSlow = inSlowPhase;
  }

  // Stimulus position overlay (gold dashed, wrapping sawtooth)
  waveCtx.strokeStyle = 'rgba(255, 211, 122, 0.5)';
  waveCtx.setLineDash([4,4]);
  waveCtx.lineWidth = 1;
  waveCtx.beginPath();
  let stimAccum = 0;
  for(let i=0;i<N;i++){
    const s = samples[i];
    const t = s.t/1000;
    const x = t * scaleX;
    if(i > 0){
      const dt = (s.t - samples[i-1].t) / 1000;
      stimAccum += (s.stimVNorm || 0) * dt;
    }
    // Wrap stimulus to match eye range for visual comparison
    const stimWrapped = eyeRange > 0 ? ((stimAccum % eyeRange) + eyeRange) % eyeRange : 0;
    const y = yMid - (stimWrapped - eyeRange/2) * scaleY;
    if(i===0) waveCtx.moveTo(x,y); else waveCtx.lineTo(x,y);
  }
  waveCtx.setLineDash([]);
  waveCtx.stroke();
}

// ---------- Test control ----------
async function startTest(){
  if(running) return;
  
  // CRITICAL: DO NOT set running = true or startedAt yet - wait until after calibration
  
  // Re-initialize UI elements to get fresh references (React may have recreated elements)
  initUIElements();

  // Double-check video element directly from DOM (initUIElements may have stale reference)
  if(!video) {
    video = document.getElementById('video');
  }

  resetEyeSelection();

  // Ensure video element is available
  if(!video) {
    console.error('❌ Video element still not available after React rendering');
    // Retry once after a short delay — React may still be committing DOM updates
    await new Promise(resolve => setTimeout(resolve, 200));
    initUIElements();
    if(!video) video = document.getElementById('video');
    if(!video) {
      console.error('❌ Video element not found after retry — aborting');
      return;
    }
    console.log('✅ Video element found on retry');
  }
  
  // Reset startedAt to ensure timer doesn't run during calibration
  startedAt = 0;
  running = false;
  calibratedEyeSpan = null;
  
  await ensureEngines();
  
  // STEP 1: Distance calibration
  // IMPORTANT: Keep running = false and startedAt = 0 during calibration
  console.log('📏 Starting distance calibration...');
  isCalibrating = true;
  attachCameraViewResizeObserver();
  running = false; // Ensure running is false during calibration
  startedAt = 0; // Explicitly reset to prevent timer from running
  
  const calibrated = await calibrateDistance();
  isCalibrating = false;
  
  if(!calibrated){
    console.log('❌ Distance calibration failed');
    if(trackingTag) {
      trackingTag.textContent = 'Calibration failed - try again';
      trackingTag.className = 'tag bad';
    }
    if(btnStart) btnStart.disabled = false;
    startedAt = 0; // Reset again if calibration was cancelled
    return;
  }
  
  console.log('Info: Distance calibrated, starting test');

  // Show 3-2-1 countdown so user knows they're locked in
  if (trackingTag) { trackingTag.textContent = 'Hold still…'; trackingTag.className = 'tag ok'; }
  await runCalibCountdown();
  if (trackingTag) trackingTag.style.display = 'none';

  // STEP 2: Start the actual OKN test
  // NOW we set running = true and startedAt - timer will start counting from here
  running = true;
  
  if(overlayInstruction) overlayInstruction.classList.add('hidden');
  if(decisionCard) decisionCard.classList.add('hidden');
  if(assistCard) assistCard.classList.add('hidden');
  if(progressRing) progressRing.classList.remove('hidden');
  if(btnStart) btnStart.disabled = true; 
  if(btnStop) btnStop.disabled = false;

  // Reset all test data before starting timer
  samples.length = 0; usableFrames = 0; haveEma=false;
  medianBufNorm.length = 0; medianBufPx.length = 0;
  lastTs = 0; lastFrameTs=0; stimPhase = 0;
  fpsDetected = false; detectedFps = 30; adaptiveRegressionWin = 5; adaptiveBridgeFrames = 1;
  
  // Set startedAt NOW - timer will start counting from this moment
  startedAt = performance.now();
  setProgress(0);

  // Start video recording if MediaRecorder is available
  recordedChunks = [];
  const videoEl = document.getElementById('video');
  if (videoEl && videoEl.srcObject && typeof MediaRecorder !== 'undefined') {
    const mimeType = getSupportedVideoMimeType();
    if (mimeType) {
      try {
        mediaRecorder = new MediaRecorder(videoEl.srcObject, { mimeType });
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) recordedChunks.push(e.data);
        };
        mediaRecorder.onerror = (e) => {
          console.warn('MediaRecorder error:', e.error);
          mediaRecorder = null;
          recordedChunks = [];
        };
        mediaRecorder.start(1000); // collect chunks every 1s
        console.log('Recording started:', mimeType);
      } catch (e) {
        console.warn('MediaRecorder failed to start:', e);
        mediaRecorder = null;
      }
    } else {
      console.warn('No supported video MIME type found');
    }
  }

  // Ensure canvases are properly sized
  resizeCanvases();
  
  if(trackingTag) {
    trackingTag.textContent = 'Starting…';
    trackingTag.className = 'tag';
  }

  setTimeout(()=>{ 
    if(overlayInstruction) overlayInstruction.classList.add('hidden');
  }, 3000);
}

async function stopTest(){
  running = false;
  if(btnStart) btnStart.disabled = false;
  if(btnStop) btnStop.disabled = true;
  if(progressRing) progressRing.classList.add('hidden');
  setProgress(1);

  // Stop video recording BEFORE stopping camera (recorder needs live stream)
  let videoBlob = null;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    const capturedMimeType = mediaRecorder.mimeType || 'video/webm';
    videoBlob = await Promise.race([
      new Promise((resolve) => {
        mediaRecorder.onstop = () => {
          const blob = new Blob(recordedChunks, { type: capturedMimeType });
          recordedChunks = [];
          console.log('Video recording stopped, blob size:', blob.size);
          resolve(blob);
        };
        mediaRecorder.stop();
      }),
      new Promise((resolve) => setTimeout(() => {
        console.warn('MediaRecorder stop timed out after 5s');
        recordedChunks = [];
        resolve(null);
      }, 5000))
    ]);
    mediaRecorder = null;
  }

  // Stop camera immediately to free GPU/CPU — MediaPipe inference is heavy
  stopCamera();

  await classifierPromise;
  if (!classifierArtifact) {
    console.error(
      `❌ Classifier artifact unavailable after awaiting load. Check ${MODEL_ARTIFACT_URL} is reachable.`
    );
  }
  console.log('🤖 Classifier artifact ready before analysis?', !!classifierArtifact);

  // Analyze
  const result = analyzeOKN(samples);
  // Skip showDecision DOM manipulation — React renders the results UI

  // Notify React layer (App.tsx) that the test has completed so it can render results
  try{
    // Build CSV for external plotting
    const csv = buildCsv(samples);
    const detail = {
      oknGain: result && isFinite(result.gain) ? result.gain : NaN,
      oknGainRaw: result && isFinite(result.gainRaw) ? result.gainRaw : NaN,
      rSquared: result && isFinite(result.r2) ? result.r2 : NaN,
      quality: result ? result.quality : 0,
      passQuality: result ? !!result.passQuality : false,
      decision: result ? result.decision : 'insufficient',
      label: result ? result.label : 'Insufficient data',
      text: result ? result.detail : 'Not enough data',
      slowPhaseCoverage: result && typeof result.slowPhaseCoverage === 'number' ? result.slowPhaseCoverage : 0,
      slowPhaseSegments: result && typeof result.slowPhaseSegments === 'number' ? result.slowPhaseSegments : 0,
      slowPhaseMedianVelocityNormRaw: result && typeof result.slowPhaseMedianVelocityNormRaw === 'number' ? result.slowPhaseMedianVelocityNormRaw : NaN,
      slowPhaseMedianVelocityNorm: result && typeof result.slowPhaseMedianVelocityNorm === 'number' ? result.slowPhaseMedianVelocityNorm : NaN,
      slowPhaseMedianVelocityPx: result && typeof result.slowPhaseMedianVelocityPx === 'number' ? result.slowPhaseMedianVelocityPx : NaN,
      slowPhaseMeanVelocityNormRaw: result && typeof result.slowPhaseMeanVelocityNormRaw === 'number' ? result.slowPhaseMeanVelocityNormRaw : NaN,
      slowPhaseMeanVelocityNorm: result && typeof result.slowPhaseMeanVelocityNorm === 'number' ? result.slowPhaseMeanVelocityNorm : NaN,
      slowPhaseMeanVelocityPx: result && typeof result.slowPhaseMeanVelocityPx === 'number' ? result.slowPhaseMeanVelocityPx : NaN,
      slowPhaseVelocitiesNorm: result && Array.isArray(result.slowPhaseVelocitiesNorm) ? result.slowPhaseVelocitiesNorm : [],
      slowPhaseVelocitiesPx: result && Array.isArray(result.slowPhaseVelocitiesPx) ? result.slowPhaseVelocitiesPx : [],
      rejectionStats: result && result.rejectionStats ? result.rejectionStats : null,
      calibrationBoost: result && typeof result.calibrationBoost === 'number' ? result.calibrationBoost : 1,
      observedRangeNorm: result && typeof result.observedRangeNorm === 'number' ? result.observedRangeNorm : 0,
      stimVelocityNorm: result && typeof result.stimVelocityNorm === 'number' ? result.stimVelocityNorm : (oknWidth > 0 ? stimSpeed / oknWidth : NaN),
      classifierProbability: result && typeof result.classifierProbability === 'number' ? result.classifierProbability : NaN,
      classifierFeatures: result && result.classifierFeatures ? result.classifierFeatures : null,
      baselineRawFeatures: result && result.baselineRawFeatures ? result.baselineRawFeatures : null,
      segmentation: result && result.segmentation ? result.segmentation : null,
      calibration: lastCalibrationTimeoutInfo || { passed: true },
      retryReason: result && result.retryReason ? result.retryReason : null,
      selectedEye: selectedEye || null,
      csv,
      supabaseCsvPath: null,
      supabaseRowId: null
    };

    // --- Build SessionDiagnostic (Stream 4: wires diagnostics.ts schema into app.js) ---
    const calibDiag = window.__calibDiagnostic || {
      passed: true, stableFrames: 0, requiredStableFrames: 0, durationMs: 0,
      criteria: [], failureCodes: [], failureHistory: [],
      lastNosePosition: null, lastEyeCorners: []
    };

    // Quality diagnostic from analyzeOKN result
    const qUsableFraction = result ? result.quality : 0;
    const qSegmentCount = result && result.segmentation ? result.segmentation.acceptedSegments : 0;
    const qPhaseCoverage = result && typeof result.slowPhaseCoverage === 'number' ? result.slowPhaseCoverage : 0;
    const qGainCal = result && isFinite(result.gainCalMedian) ? result.gainCalMedian : null;
    const qR2 = result && isFinite(result.r2) ? result.r2 : null;
    const qPass = result ? !!result.passQuality : false;

    // Derive quality failure codes
    const qualityFailureCodes = [];
    if (qUsableFraction < 0.6) qualityFailureCodes.push('LOW_USABLE_FRAMES');
    if (qSegmentCount < 6) qualityFailureCodes.push('INSUFFICIENT_SEGMENTS');
    if (qPhaseCoverage < 0.10) qualityFailureCodes.push('LOW_PHASE_COVERAGE');

    const testQualityDiag = {
      qualityPass: qPass,
      usableFraction: qUsableFraction,
      segmentCount: qSegmentCount,
      phaseCoverage: qPhaseCoverage,
      detectedFps: detectedFps,
      selectedEye: selectedEye || null,
      gainCal: qGainCal,
      rSquared: qR2,
      failureCodes: qualityFailureCodes
    };

    // Framing geometry from calibration-time landmarks (per code review: use saved snapshots)
    const diagNose = calibDiag.lastNosePosition;
    const diagEyeCorners = calibDiag.lastEyeCorners || [];
    const diagCenterOffset = diagNose
      ? Math.sqrt((diagNose.x - 0.5) ** 2 + (diagNose.y - 0.5) ** 2)
      : null;
    let diagMinEyeEdgeMargin = 0; // 0 for empty corners (matches diagnostics.ts convention)
    if (diagEyeCorners.length > 0) {
      let minM = Infinity;
      for (const c of diagEyeCorners) {
        minM = Math.min(minM, c.x, 1 - c.x, c.y, 1 - c.y);
      }
      diagMinEyeEdgeMargin = isFinite(minM) ? minM : 0;
    }

    // Video/container dimensions (read from sidecar device info for safety after stopCamera)
    const diagVideoW = video ? video.videoWidth || 0 : 0;
    const diagVideoH = video ? video.videoHeight || 0 : 0;
    const diagContainerW = oknWidth || 0;
    const diagContainerH = oknHeight || 0;
    const diagContainerAR = diagContainerH > 0 ? diagContainerW / diagContainerH : 1;
    const diagVideoAR = diagVideoH > 0 ? diagVideoW / diagVideoH : 1;
    let diagCropActive = false;
    let diagVideoRenderRect = { x: 0, y: 0, w: diagContainerW, h: diagContainerH };
    if (diagVideoW > 0 && diagVideoH > 0 && Math.abs(diagContainerAR - diagVideoAR) > 0.01) {
      diagCropActive = true;
      if (diagVideoAR > diagContainerAR) {
        const rh = diagContainerW / diagVideoAR;
        diagVideoRenderRect = { x: 0, y: (diagContainerH - rh) / 2, w: diagContainerW, h: rh };
      } else {
        const rw = diagContainerH * diagVideoAR;
        diagVideoRenderRect = { x: (diagContainerW - rw) / 2, y: 0, w: rw, h: diagContainerH };
      }
    }

    const framingGeometry = {
      nosePosition: diagNose,
      centerOffset: diagCenterOffset,
      minEyeEdgeMargin: diagMinEyeEdgeMargin,
      cropActive: diagCropActive,
      videoRenderRect: diagVideoRenderRect
    };

    const transformMetadata = {
      mirrored: true,
      selectedEye: selectedEye || null,
      objectFit: 'contain',
      videoResolution: { w: diagVideoW, h: diagVideoH },
      containerSize: { w: diagContainerW, h: diagContainerH }
    };

    // Build summary
    const allFailureCodes = [...calibDiag.failureCodes, ...qualityFailureCodes];
    let diagSummaryParts = [];
    if (!calibDiag.passed) {
      const calHints = calibDiag.criteria.filter(c => !c.pass && c.hint).map(c => c.hint);
      diagSummaryParts.push('Calibration failed: ' + (calHints.length ? calHints.join('; ') : 'unknown'));
    }
    if (!qPass) {
      const qIssues = [];
      if (qUsableFraction < 0.6) qIssues.push(`usable frames ${(qUsableFraction * 100).toFixed(0)}% < 60%`);
      if (qSegmentCount < 6) qIssues.push(`${qSegmentCount} segments < 6`);
      if (qPhaseCoverage < 0.10) qIssues.push(`phase coverage ${(qPhaseCoverage * 100).toFixed(0)}% < 10%`);
      diagSummaryParts.push('Low quality: ' + (qIssues.length ? qIssues.join(', ') : 'quality check failed'));
    }
    const diagSummary = diagSummaryParts.length ? diagSummaryParts.join('. ') : 'All checks passed';

    const sessionDiagnostic = {
      version: 2,
      timestamp: new Date().toISOString(),
      calibration: {
        passed: calibDiag.passed,
        stableFrames: calibDiag.stableFrames,
        requiredStableFrames: calibDiag.requiredStableFrames,
        durationMs: calibDiag.durationMs,
        criteria: calibDiag.criteria,
        failureCodes: calibDiag.failureCodes,
        failureHistory: calibDiag.failureHistory
      },
      testQuality: testQualityDiag,
      framing: framingGeometry,
      transform: transformMetadata,
      summary: diagSummary,
      failureCodes: allFailureCodes
    };

    detail.diagnostics = sessionDiagnostic;

    // Build per-frame metadata sidecar JSON
    const sidecarJson = {
      version: 3,
      session_id: null, // populated by upload function from its timestamp-uuid
      coordinateSpace: {
        convention_version: '1.0',
        camera_space: 'mediapipe_face_mesh_normalized_0_1',
        eye_normalized_space: 'negated_within_eye_span',
        anatomical_labels: true,
        css_mirror_display_only: true,
        leftward_tracking_slope: 'negative'
      },
      device: {
        userAgent: navigator.userAgent,
        screenWidth: oknWidth,
        screenHeight: oknHeight,
        pixelRatio: window.devicePixelRatio || 1,
        cameraResolution: video ? [video.videoWidth, video.videoHeight] : [0, 0]
      },
      stimulus: {
        baseStripeWidth_px: BASE_STRIPE_WIDTH,
        baseStripeGap_px: BASE_STRIPE_GAP,
        baseSpeed_pxs: BASE_STIM_SPEED,
        referenceWidth: REFERENCE_WIDTH,
        scaleFactor: stimScale,
        actualStripeWidth_px: stripeWidth,
        actualStripeGap_px: stripeGap,
        actualPeriod_px: stripeWidth + stripeGap,
        actualSpeed_pxs: stimSpeed,
        temporalFrequency_Hz: stimSpeed / (stripeWidth + stripeGap),
        duration_ms: DURATION_MS
      },
      processing: {
        fpsDetected: detectedFps,
        regressionWindow: adaptiveRegressionWin,
        bridgeFrames: adaptiveBridgeFrames,
        k_geo: K_GEO
      },
      // Release 3C: Calibration outcome instrumentation
      calibration: lastCalibrationTimeoutInfo || { passed: true },
      segmentation: result && result.segmentation ? result.segmentation : null,
      diagnostics: sessionDiagnostic,
      frames: samples.map(s => ({
        t_ms: s.t,
        stimPhase: s.stimPhase ?? null,
        detected: s.faceDetected ?? false,
        irisL: s.irisLandmarks ? s.irisLandmarks.left : null,
        irisR: s.irisLandmarks ? s.irisLandmarks.right : null,
        cornerL_in: s.eyeCorners ? s.eyeCorners.leftInner : null,
        cornerL_out: s.eyeCorners ? s.eyeCorners.leftOuter : null,
        cornerR_in: s.eyeCorners ? s.eyeCorners.rightInner : null,
        cornerR_out: s.eyeCorners ? s.eyeCorners.rightOuter : null,
        // Release 2C: Head/face landmarks for motion contamination analysis
        nose: s.headLandmarks ? s.headLandmarks.nose : null,
        forehead: s.headLandmarks ? s.headLandmarks.forehead : null,
        chin: s.headLandmarks ? s.headLandmarks.chin : null,
        faceEdgeL: s.headLandmarks ? s.headLandmarks.faceEdgeL : null,
        faceEdgeR: s.headLandmarks ? s.headLandmarks.faceEdgeR : null,
        // Release 2C: Pre-filter eye position for offline analysis
        rawEyeXNorm: s.rawEyeXNorm ?? null,
        // Release 5A: Eyelid landmarks for blink/PERCLOS detection
        lidL_upper: s.eyelidLandmarks ? s.eyelidLandmarks.leftUpper : null,
        lidL_lower: s.eyelidLandmarks ? s.eyelidLandmarks.leftLower : null,
        lidR_upper: s.eyelidLandmarks ? s.eyelidLandmarks.rightUpper : null,
        lidR_lower: s.eyelidLandmarks ? s.eyelidLandmarks.rightLower : null
      }))
    };

    // Dispatch test-complete immediately (non-blocking — don't delay results display)
    window.dispatchEvent(new CustomEvent('test-complete', { detail }));

    // Stash upload data — upload deferred until research metadata submit
    window.__pendingUpload = { csv, result, videoBlob, sidecarJson, detail };
    window.dispatchEvent(new CustomEvent('upload-state-change', {
      detail: { phase: 'awaiting_bac' }
    }));
  }catch(e){
    console.warn('Warning: Failed to dispatch test-complete event:', e);
  }
}

// Reset function to clean up state when returning to start
function resetTest(){
  console.log('🔄 resetTest() called');
  
  // Stop test state
  running = false;
  isCalibrating = false;
  startedAt = 0;
  delete window.__calibDiagnostic;

  // Clean up any leftover recording
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch(e) { /* ignore */ }
  }
  mediaRecorder = null;
  recordedChunks = [];

  // Reset all test data
  samples.length = 0;
  usableFrames = 0;
  haveEma = false;
  haveNormEma = false;
  resetEyeSelection();
  lastTs = 0;
  lastFrameTs = 0;
  stimPhase = 0;
  eyeEma = 0;
  eyeNormEma = 0;
  medianBufNorm.length = 0;
  medianBufPx.length = 0;
  fpsDetected = false; detectedFps = 30; adaptiveRegressionWin = 5; adaptiveBridgeFrames = 1;
  
  // Reset iris tracking (keep lastIrisSize and lastLandmarksDetected for calibration)
  // Note: These are kept so calibration can still work on next test
  
  // Reset UI elements
  if(btnStart) btnStart.disabled = false;
  if(btnStop) btnStop.disabled = true;
  if(progressRing) progressRing.classList.add('hidden');
  if(trackingTag) {
    trackingTag.textContent = 'Ready';
    trackingTag.className = 'tag';
  }
  
  // Stop camera since React will unmount the video element
  // This ensures clean restart on next test
  stopCamera();
  
  console.log('Info: Test state reset, camera stopped');
}

// Expose reset function globally for React component
window.resetTest = resetTest;

async function ensureEngines(){
  console.log('🔧 ensureEngines() called');
  
  // Check if MediaPipe is available - no fallbacks
  if(!window.FaceMesh) {
    throw new Error('MediaPipe FaceMesh not available. This is required for real eye tracking.');
  }
  
  // Initialize MediaPipe - this is the only real implementation
  console.log('🔧 Initializing MediaPipe...');
  await initMediaPipe();
  console.log('Info: MediaPipe initialized');
  
  // Check if video element is available
  if(!video) {
    throw new Error('Video element not found. Please ensure the camera phase is rendered.');
  }

  // Check if camera is already running
  if(video.srcObject && camera){
    console.log('📹 Camera already running, reusing existing stream');
    // Make sure video is playing
    if(video.paused){
      video.play().catch(e => console.warn('Warning: Video play failed:', e));
    }
    if(trackingTag) {
      trackingTag.textContent = 'Tracking…';
      trackingTag.className = 'tag ok';
    }
    return;
  }

  // Start camera
  console.log('📹 Starting camera...');
  try{
    await startCamera();
    console.log('Info: Camera started successfully');
    if(trackingTag) {
      trackingTag.textContent = 'Tracking…';
      trackingTag.className = 'tag ok';
    }
  }catch(e){
    console.error('❌ Camera failed:', e);
    if(trackingTag) {
      trackingTag.textContent = 'Camera error';
      trackingTag.className = 'tag bad';
    }

    // More specific error messages
    let errorMessage = "Unable to access camera. ";
    if(e.name === 'NotAllowedError') {
      errorMessage += "Please allow camera permission and reload the page.";
    } else if(e.name === 'NotFoundError') {
      errorMessage += "No camera found. Please connect a camera and reload.";
    } else if(e.name === 'NotReadableError') {
      errorMessage += "Camera is being used by another application. Please close other apps and reload.";
    } else {
      errorMessage += "Please check your camera and reload the page.";
    }

    alert(errorMessage);
    throw e;
  }
}

// ---------- Analysis ----------

function median(values) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function theilSenSlope(pairs) {
  if (!pairs || pairs.length < 2) return NaN;
  const slopes = [];
  for (let i = 0; i < pairs.length; i++) {
    const [x1, y1] = pairs[i];
    if (!isFinite(x1) || !isFinite(y1)) continue;
    for (let j = i + 1; j < pairs.length; j++) {
      const [x2, y2] = pairs[j];
      if (!isFinite(x2) || !isFinite(y2)) continue;
      const dx = x2 - x1;
      if (Math.abs(dx) < 1e-6) continue;
      slopes.push((y2 - y1) / dx);
    }
  }
  return slopes.length ? median(slopes) : NaN;
}

const NUM_EPS = 1e-9;

function sum(values) {
  return values.reduce((acc, v) => acc + v, 0);
}

function mean(values) {
  if (!values.length) return NaN;
  return sum(values) / values.length;
}

function variance(values, meanValue = mean(values)) {
  if (!values.length) return NaN;
  let acc = 0;
  for (const v of values) {
    const diff = v - meanValue;
    acc += diff * diff;
  }
  return acc / values.length;
}

function std(values, meanValue = mean(values)) {
  const v = variance(values, meanValue);
  return isFinite(v) ? Math.sqrt(Math.max(v, 0)) : NaN;
}

function rms(values) {
  if (!values.length) return NaN;
  const acc = values.reduce((s, v) => s + v * v, 0);
  return Math.sqrt(acc / values.length);
}

function percentile(values, p) {
  if (!values.length) return NaN;
  if (p <= 0) return Math.min(...values);
  if (p >= 100) return Math.max(...values);
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function iqr(values) {
  if (!values.length) return NaN;
  return percentile(values, 75) - percentile(values, 25);
}

function mad(values) {
  if (!values.length) return NaN;
  const med = median(values);
  const deviations = values.map((v) => Math.abs(v - med));
  const madRaw = median(deviations);
  return madRaw * 1.4826;
}

function meanAbsolute(values) {
  if (!values.length) return NaN;
  const acc = values.reduce((s, v) => s + Math.abs(v), 0);
  return acc / values.length;
}

function correlation(x, y) {
  const n = Math.min(x.length, y.length);
  if (!n) return NaN;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = y[i];
    if (!isFinite(xi) || !isFinite(yi)) continue;
    sumX += xi;
    sumY += yi;
    sumXY += xi * yi;
    sumXX += xi * xi;
    sumYY += yi * yi;
  }
  const denomX = sumXX - (sumX * sumX) / n;
  const denomY = sumYY - (sumY * sumY) / n;
  const denom = Math.sqrt(Math.max(denomX, 0) * Math.max(denomY, 0));
  if (denom <= NUM_EPS) return NaN;
  const num = sumXY - (sumX * sumY) / n;
  return num / denom;
}

function movingAverage(values, windowSize) {
  if (windowSize <= 1 || windowSize >= values.length) return [...values];
  const result = new Array(values.length);
  const half = Math.floor(windowSize / 2);
  for (let i = 0; i < values.length; i++) {
    let acc = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      const idx = Math.min(values.length - 1, Math.max(0, j));
      acc += values[idx];
      count++;
    }
    result[i] = acc / count;
  }
  return result;
}

function smoothVelocity(values, fs) {
  if (!values.length) return [];
  if (!isFinite(fs) || fs <= 0) return [...values];
  let window = Math.max(5, Math.round(fs * 0.2));
  if (window % 2 === 0) window += 1;
  window = Math.min(window, values.length - (values.length % 2 === 0 ? 1 : 0));
  if (window < 5) return [...values];
  return movingAverage(values, window);
}

function zeroCrossingRate(values, durationSec) {
  if (values.length < 2 || !isFinite(durationSec) || durationSec <= 0) return NaN;
  let changes = 0;
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const curr = values[i];
    if (!isFinite(prev) || !isFinite(curr)) continue;
    if (Math.sign(prev) !== Math.sign(curr)) changes++;
  }
  return changes / durationSec;
}

function computeCrossCorrelation(eyeV, stimV, fs) {
  const n = Math.min(eyeV.length, stimV.length);
  if (!n) return { value: NaN, lagMs: NaN };
  const meanEye = mean(eyeV);
  const meanStim = mean(stimV);
  const stdEye = std(eyeV, meanEye);
  const stdStim = std(stimV, meanStim);
  if (!isFinite(stdEye) || stdEye <= NUM_EPS || !isFinite(stdStim) || stdStim <= NUM_EPS) {
    return { value: NaN, lagMs: NaN };
  }
  const maxLag = Math.min(n - 1, Math.max(1, Math.round((fs || 30) * 0.5)));
  let bestVal = -Infinity;
  let bestLag = 0;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let acc = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const j = i + lag;
      if (j < 0 || j >= n) continue;
      acc += (eyeV[i] - meanEye) * (stimV[j] - meanStim);
      count++;
    }
    if (!count) continue;
    const corr = acc / (count * stdEye * stdStim);
    if (corr > bestVal) {
      bestVal = corr;
      bestLag = lag;
    }
  }
  const lagMs = isFinite(fs) && fs > 0 ? (bestLag / fs) * 1000 : NaN;
  return {
    value: isFinite(bestVal) ? Math.max(-1, Math.min(1, bestVal)) : NaN,
    lagMs,
  };
}

function peakRateHz(values, times) {
  if (values.length < 3 || times.length < 2) return NaN;
  const duration = times[times.length - 1] - times[0];
  if (!isFinite(duration) || duration <= 0) return NaN;
  const med = median(values);
  const madVal = mad(values);
  const threshold = Math.max(3 * (isFinite(madVal) ? madVal : std(values) || 0), 1e-3);
  const absVals = values.map((v) => Math.abs(v));
  let peaks = 0;
  for (let i = 1; i < absVals.length - 1; i++) {
    if (absVals[i] > threshold && absVals[i] >= absVals[i - 1] && absVals[i] >= absVals[i + 1]) {
      peaks++;
    }
  }
  return peaks / duration;
}

function computeBandPowers(values, fs) {
  const n = values.length;
  if (!isFinite(fs) || fs <= 0 || n < 16) {
    return {
      psd_low: NaN,
      psd_mid: NaN,
      psd_high: NaN,
      psd_low_high_ratio: NaN,
      psd_entropy: NaN,
    };
  }
  const meanVal = mean(values);
  const maxK = Math.floor(n / 2);
  const freq = [];
  const power = [];
  for (let k = 0; k <= maxK; k++) {
    let real = 0;
    let imag = 0;
    for (let t = 0; t < n; t++) {
      const angle = (2 * Math.PI * k * t) / n;
      const centered = values[t] - meanVal;
      real += centered * Math.cos(angle);
      imag -= centered * Math.sin(angle);
    }
    const p = (real * real + imag * imag) / (n * fs);
    freq.push((k * fs) / n);
    power.push(p);
  }
  const totalPower = power.reduce((acc, val) => acc + val, 0);
  const bandPower = (lo, hi) => {
    let acc = 0;
    for (let i = 0; i < freq.length; i++) {
      if (freq[i] >= lo && freq[i] < hi) {
        acc += power[i];
      }
    }
    return acc;
  };
  const low = bandPower(0, 1);
  const mid = bandPower(1, 3);
  const high = bandPower(3, 8);
  const total = totalPower > 0 ? totalPower : NUM_EPS;
  let entropy = NaN;
  const positivePower = power.filter((p) => p > 0);
  if (positivePower.length) {
    const totalPos = positivePower.reduce((acc, val) => acc + val, 0);
    let ent = 0;
    for (const p of positivePower) {
      const prob = p / totalPos;
      if (prob > 0) ent -= prob * Math.log2(prob);
    }
    entropy = positivePower.length > 1 ? ent / Math.log2(positivePower.length) : 0;
  }
  return {
    psd_low: low / total,
    psd_mid: mid / total,
    psd_high: high / total,
    psd_low_high_ratio: high > 0 ? low / high : NaN,
    psd_entropy: entropy,
  };
}

function computeBandPowersWelch(values, fs) {
  // Welch's method: Hann window, 50% overlap, segment averaging.
  // Matches scipy.signal.welch defaults used in Python training pipeline.
  const n = values.length;
  let nperseg = Math.min(128, Math.floor(n / 2));
  if (nperseg % 2 !== 0) nperseg--; // force even for consistent frequency binning
  if (nperseg < 16 || n < 16 || !isFinite(fs) || fs <= 0) {
    return { psd_low: NaN, psd_mid: NaN, psd_high: NaN };
  }
  const noverlap = Math.floor(nperseg / 2);
  // Hann window
  const hann = new Float64Array(nperseg);
  let winSumSq = 0;
  for (let i = 0; i < nperseg; i++) {
    hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (nperseg - 1)));
    winSumSq += hann[i] * hann[i];
  }
  const nFreqs = Math.floor(nperseg / 2) + 1;
  const step = nperseg - noverlap;
  const avgPsd = new Float64Array(nFreqs);
  let nSegments = 0;
  for (let pos = 0; pos + nperseg <= n; pos += step) {
    // Subtract segment mean and apply window
    let segMean = 0;
    for (let i = 0; i < nperseg; i++) segMean += values[pos + i];
    segMean /= nperseg;
    const windowed = new Float64Array(nperseg);
    for (let i = 0; i < nperseg; i++) windowed[i] = (values[pos + i] - segMean) * hann[i];
    // DFT for positive frequencies
    for (let k = 0; k < nFreqs; k++) {
      let re = 0, im = 0;
      for (let t = 0; t < nperseg; t++) {
        const angle = 2 * Math.PI * k * t / nperseg;
        re += windowed[t] * Math.cos(angle);
        im -= windowed[t] * Math.sin(angle);
      }
      let p = (re * re + im * im) / (fs * winSumSq);
      // Double non-DC, non-Nyquist bins (one-sided spectrum)
      if (k > 0 && (nperseg % 2 !== 0 || k < nFreqs - 1)) p *= 2;
      avgPsd[k] += p;
    }
    nSegments++;
  }
  if (nSegments === 0) return { psd_low: NaN, psd_mid: NaN, psd_high: NaN };
  let totalPower = 0;
  for (let k = 0; k < nFreqs; k++) {
    avgPsd[k] /= nSegments;
    totalPower += avgPsd[k];
  }
  if (totalPower < 1e-12) return { psd_low: NaN, psd_mid: NaN, psd_high: NaN };
  const bandPower = (lo, hi) => {
    let acc = 0;
    for (let k = 0; k < nFreqs; k++) {
      const f = k * fs / nperseg;
      if (f >= lo && f < hi) acc += avgPsd[k];
    }
    return acc / totalPower;
  };
  return { psd_low: bandPower(0, 1), psd_mid: bandPower(1, 3), psd_high: bandPower(3, 8) };
}

function detectDeviceType() {
  // Detect device type from user agent and screen size
  if (typeof navigator === 'undefined') return 'phone'; // fallback

  const ua = navigator.userAgent.toLowerCase();
  const width = typeof window !== 'undefined' ? window.innerWidth : 0;

  // Check for phone/mobile first — iOS UA contains "mac" which would false-positive as laptop
  const isMobile = /iphone|ipod|android.*mobile|windows phone|blackberry|opera mini|iemobile/.test(ua);
  if (isMobile) return 'phone';

  // Check for tablet indicators
  const isTablet = /tablet|ipad|playbook|silk|(android(?!.*mobile))/.test(ua) ||
                   (width >= 600 && width < 1024);
  if (isTablet) return 'tablet';

  // Everything else is laptop/desktop
  return 'laptop';
}

function computeClassifierFeatures(samples, oknGainRaw = NaN) {
  const usable = samples.filter((s) => s && s.usable && isFinite(s.eyeV) && isFinite(s.stimV));
  if (usable.length < 8) {
    console.warn('⚠️ Not enough usable samples for classifier features');
    return null;
  }
  const times = usable.map((s) => s.t / 1000);
  const durationSec = times[times.length - 1] - times[0];
  const dt = [];
  for (let i = 1; i < times.length; i++) {
    const diff = times[i] - times[i - 1];
    if (diff > 0) dt.push(diff);
  }
  const samplingRate = dt.length ? 1 / median(dt) : NaN;

  // Normalize velocities by current stimulus speed so features are in gain units
  // (dimensionless: 1.0 = tracking perfectly at stimulus speed).
  // This matches training normalization (training CSVs had stimV_px = 220 divided
  // by detected stim speed in build_windowed_dataset.py), making features
  // invariant to stimulus speed changes between training and inference.
  const speedNorm = stimSpeed > 0 ? stimSpeed : 1;
  const eyeV = usable.map((s) => (s.eyeV ?? 0) / speedNorm);
  const stimV = usable.map(() => 1.0); // stimV / stimSpeed = 1.0 always
  const eyeX = usable.map((s) => s.eyeX ?? 0);
  const stimVNorm = usable.map((s) => {
    if (isFinite(s.stimVNorm)) return s.stimVNorm;
    const width = s.canvasWidth || oknWidth || 1;
    return width > 0 ? (s.stimV ?? 0) / width : 0;
  });

  const diffV = eyeV.map((v, i) => v - (stimV[i] ?? 0));
  const absEyeV = eyeV.map((v) => Math.abs(v));
  const absStimV = stimV.map((v) => Math.abs(v));
  const diffVAbs = diffV.map((v) => Math.abs(v));

  const corrEyeStim = correlation(eyeV, stimV);
  const smoothEye = smoothVelocity(eyeV, samplingRate);
  const corrSmoothEye = correlation(smoothEye, stimV);
  const xcorr = computeCrossCorrelation(eyeV, stimV, samplingRate);
  const bandPowers = computeBandPowers(eyeV, samplingRate);
  const peakRate = peakRateHz(eyeV, times);
  const zeroCross = zeroCrossingRate(eyeV, durationSec);

  // Detect device type and create one-hot features
  const deviceType = detectDeviceType();
  const deviceLaptop = deviceType === 'laptop' ? 1 : 0;
  const devicePhone = deviceType === 'phone' ? 1 : 0;
  const deviceTablet = deviceType === 'tablet' ? 1 : 0;

  // Use provided gain or compute fallback
  const oknGainAuto = isFinite(oknGainRaw) ? oknGainRaw : 
                      (meanAbsolute(stimV) > NUM_EPS ? meanAbsolute(eyeV) / meanAbsolute(stimV) : NaN);

  const featureMap = {
    duration_s: isFinite(durationSec) ? durationSec : NaN,
    sampling_rate_hz: isFinite(samplingRate) ? samplingRate : NaN,
    n_samples: usable.length,
    usable_fraction: usable.length / Math.max(1, samples.length),
    eye_v_mean: mean(eyeV),
    eye_v_std: std(eyeV),
    eye_v_rms: rms(eyeV),
    eye_v_median: median(eyeV),
    eye_v_mad: mad(eyeV),
    eye_v_iqr: iqr(eyeV),
    eye_v_abs_mean: meanAbsolute(eyeV),
    eye_v_abs_p90: percentile(absEyeV, 90),
    eye_v_abs_p95: percentile(absEyeV, 95),
    eye_v_abs_max: Math.max(...absEyeV),
    stim_v_mean: mean(stimV),
    stim_v_std: std(stimV),
    eye_x_mean: mean(eyeX),
    eye_x_std: std(eyeX),
    eye_x_iqr: iqr(eyeX),
    eye_x_abs_max: Math.max(...eyeX.map((v) => Math.abs(v))),
    eye_x_range: Math.max(...eyeX) - Math.min(...eyeX),
    mag_ratio_mean: meanAbsolute(eyeV) / (meanAbsolute(stimV) + NUM_EPS),
    mag_ratio_med: median(absEyeV) / (median(absStimV) + NUM_EPS),
    diff_v_mean: mean(diffV),
    diff_v_std: std(diffV),
    diff_v_abs_mean: meanAbsolute(diffV),
    diff_v_abs_p90: percentile(diffVAbs, 90),
    corr_eye_stim: corrEyeStim,
    sign_agreement: eyeV.length ? eyeV.reduce((acc, v, i) => acc + (Math.sign(v) === Math.sign(stimV[i] ?? 0) ? 1 : 0), 0) / eyeV.length : NaN,
    xcorr_max: xcorr.value,
    xcorr_lag_ms: xcorr.lagMs,
    corr_smooth_eye_stim: corrSmoothEye,
    frac_eye_gt_stim_margin: eyeV.length ? eyeV.reduce((acc, v, i) => acc + (Math.abs(v) > Math.abs(stimV[i] ?? 0) + 30 ? 1 : 0), 0) / eyeV.length : NaN,
    peak_rate_hz: peakRate,
    zero_cross_rate_hz: zeroCross,
    psd_low: bandPowers.psd_low,
    psd_mid: bandPowers.psd_mid,
    psd_high: bandPowers.psd_high,
    psd_low_high_ratio: bandPowers.psd_low_high_ratio,
    psd_entropy: bandPowers.psd_entropy,
    okn_gain_auto: oknGainAuto,
    device_laptop: deviceLaptop,
    device_phone: devicePhone,
    device_tablet: deviceTablet,
  };

  return {
    featureMap,
    featureVector: classifierArtifact && Array.isArray(classifierArtifact.feature_names)
      ? classifierArtifact.feature_names.map((name) => {
          const val = featureMap[name];
          return Number.isFinite(val) ? val : 0;
        })
      : [],
  };
}

function evaluateTreeProbability(tree, featureVector) {
  if (!tree || !featureVector.length) return 0;
  let node = 0;
  while (tree.children_left[node] !== -1 && tree.children_left[node] != null) {
    const featureIdx = tree.feature[node];
    const threshold = tree.threshold[node];
    let goLeft = true;
    if (featureIdx !== -2) {
      const featureValue = featureVector[featureIdx] ?? 0;
      goLeft = featureValue <= threshold;
    }
    node = goLeft ? tree.children_left[node] : tree.children_right[node];
    if (node === -1 || node == null) break;
  }
  if (node === -1 || node == null) return 0;
  const values = tree.value[node];
  if (!Array.isArray(values)) return 0;
  const total = values.reduce((acc, val) => acc + val, 0);
  if (total <= 0) return 0;
  const positive = values[classifierPositiveIndex] ?? values[values.length - 1];
  return positive / total;
}

// ---------------------------------------------------------------------------
// Logistic Regression inference (bac008_full and similar artifacts)
// artifact must contain: coef, intercept, scaler_mean, scaler_scale, feature_names
// ---------------------------------------------------------------------------
function predictLogReg(featureResult) {
  const artifact = classifierArtifact;
  let featureVector = featureResult.featureVector;
  if (!featureVector || !featureVector.length) {
    if (Array.isArray(artifact.feature_names) && featureResult.featureMap) {
      featureVector = artifact.feature_names.map((name) => {
        const val = featureResult.featureMap[name];
        return Number.isFinite(val) ? val : 0;
      });
    } else {
      console.warn('⚠️ predictLogReg: cannot build featureVector');
      return null;
    }
  }
  const coef       = artifact.coef;
  const intercept  = artifact.intercept;
  const mu         = artifact.scaler_mean;
  const sigma      = artifact.scaler_scale;
  if (!Array.isArray(coef) || coef.length !== featureVector.length) {
    console.warn('⚠️ predictLogReg: coef length mismatch', coef && coef.length, featureVector.length);
    return null;
  }
  // Standardize then dot-product
  let logit = intercept;
  for (let i = 0; i < coef.length; i++) {
    const z = (featureVector[i] - mu[i]) / sigma[i];
    logit += coef[i] * z;
  }
  const probability = 1 / (1 + Math.exp(-logit));
  const threshold   = typeof artifact.optimal_threshold === 'number' ? artifact.optimal_threshold : 0.5;
  return { probability, impaired: probability >= threshold, featureMap: featureResult.featureMap };
}

// Windowed prediction: split samples into 3-second windows (50% overlap),
// run predictLogReg on each, return session-level average probability.
function predictWindowedLogReg(samples, oknGainRaw) {
  const artifact   = classifierArtifact;
  const windowS    = typeof artifact.window_s === 'number' ? artifact.window_s : 3.0;
  const overlap    = typeof artifact.window_overlap === 'number' ? artifact.window_overlap : 0.5;
  const usable     = samples.filter((s) => s && s.usable && isFinite(s.eyeV) && isFinite(s.stimV));
  if (!usable.length) return null;

  // Estimate sampling rate
  const times = usable.map((s) => s.t / 1000);
  const dt = [];
  for (let i = 1; i < times.length; i++) { const d = times[i] - times[i - 1]; if (d > 0) dt.push(d); }
  const fs           = dt.length ? 1 / median(dt) : 30;
  const windowFrames = Math.round(windowS * fs);
  const stepFrames   = Math.max(1, Math.round(windowFrames * (1 - overlap)));
  const minFrames    = Math.round(windowFrames * 0.5);

  const windowProbs = [];
  let lastFeatureMap = null;

  for (let start = 0; start + minFrames <= usable.length; start += stepFrames) {
    const win = usable.slice(start, start + windowFrames);
    if (win.length < minFrames) break;
    const featureResult = computeClassifierFeatures(win, oknGainRaw);
    if (!featureResult) continue;
    const pred = predictLogReg(featureResult);
    if (pred && isFinite(pred.probability)) {
      windowProbs.push(pred.probability);
      lastFeatureMap = featureResult.featureMap;
    }
  }

  // Fallback: whole session as a single window
  if (!windowProbs.length) {
    const featureResult = computeClassifierFeatures(usable, oknGainRaw);
    if (!featureResult) return null;
    return predictLogReg(featureResult);
  }

  const sessionProb = windowProbs.reduce((a, b) => a + b, 0) / windowProbs.length;
  const threshold   = typeof artifact.optimal_threshold === 'number' ? artifact.optimal_threshold : 0.5;
  console.log(`🔬 Windowed LogReg: ${windowProbs.length} windows, probs=[${windowProbs.map((p) => p.toFixed(3)).join(', ')}], session=${sessionProb.toFixed(3)}, threshold=${threshold}`);
  return { probability: sessionProb, impaired: sessionProb >= threshold, featureMap: lastFeatureMap, windowProbabilities: windowProbs };
}

function predictClassifier(featureResult) {
  if (!classifierArtifact || !featureResult) {
    console.warn(
      '⚠️ predictClassifier: missing artifact or featureResult ' +
        JSON.stringify({
          hasArtifact: !!classifierArtifact,
          hasFeatureResult: !!featureResult,
        })
    );
    return null;
  }

  // Dispatch to logistic regression path
  if (classifierArtifact.model_type === 'logistic_regression') {
    return predictLogReg(featureResult);
  }

  const trees = classifierArtifact.trees || [];
  if (!trees.length) {
    console.warn('⚠️ predictClassifier: no trees in artifact');
    return null;
  }
  
  // Build featureVector lazily if it's empty or not available
  let featureVector = featureResult.featureVector;
  if (!featureVector || featureVector.length === 0) {
    if (Array.isArray(classifierArtifact.feature_names) && featureResult.featureMap) {
      featureVector = classifierArtifact.feature_names.map((name) => {
        const val = featureResult.featureMap[name];
        return Number.isFinite(val) ? val : 0;
      });
      console.log('🔧 Built featureVector lazily with', featureVector.length, 'features');
    } else {
      console.warn(
        '⚠️ predictClassifier: cannot build featureVector ' +
          JSON.stringify({
            hasFeatureNames: Array.isArray(classifierArtifact.feature_names),
            hasFeatureMap: !!featureResult.featureMap,
          })
      );
      return null;
    }
  }
  
  if (!featureVector.length) {
    console.warn('⚠️ predictClassifier: empty featureVector');
    return null;
  }
  
  let probSum = 0;
  for (const tree of trees) {
    probSum += evaluateTreeProbability(tree, featureVector);
  }
  const probability = probSum / trees.length;
  // Threshold read from model artifact at load time (artifact.optimal_threshold)
  // Set during training — do NOT hardcode here. Falls back to 0.5 if artifact not loaded.
  const threshold = (classifierArtifact && typeof classifierArtifact.optimal_threshold === 'number')
    ? classifierArtifact.optimal_threshold
    : 0.5;
  return {
    probability,
    impaired: probability >= threshold,
    featureMap: featureResult.featureMap,
  };
}

function calculateSlowPhaseMetrics(segment, samples) {
  const segSamples = [];
  for (let idx = segment.startIndex; idx <= segment.endIndex; idx++) {
    const sample = samples[idx];
    if (!sample.usable || sample.eyeXNorm == null) continue;
    segSamples.push(sample);
  }

  if (segSamples.length < OKN_MIN_SEGMENT_SAMPLES) {
    return null;
  }

  const t0 = segSamples[0].t;
  const n = segSamples.length;

  let canvasWidthSum = 0;
  let stimVNormSum = 0;
  let minEyeNorm = Infinity;
  let maxEyeNorm = -Infinity;

  let sumT = 0;
  let sumY = 0;
  let sumTT = 0;
  let sumTY = 0;

  for (const sample of segSamples) {
    const tSec = (sample.t - t0) / 1000;
    const y = sample.eyeXNorm;
    sumT += tSec;
    sumY += y;
    sumTT += tSec * tSec;
    sumTY += tSec * y;
    if (sample.canvasWidth) canvasWidthSum += sample.canvasWidth;
    if (sample.stimVNorm != null) stimVNormSum += sample.stimVNorm;
    if (y < minEyeNorm) minEyeNorm = y;
    if (y > maxEyeNorm) maxEyeNorm = y;
  }

  const denom = n * sumTT - sumT * sumT;
  if (Math.abs(denom) < 1e-6) {
    return null;
  }

  const slopeNorm = (n * sumTY - sumT * sumY) / denom; // normalized units per second
  const interceptNorm = (sumY - slopeNorm * sumT) / n;

  let sse = 0;
  let sst = 0;
  const meanY = sumY / n;

  for (const sample of segSamples) {
    const tSec = (sample.t - t0) / 1000;
    const y = sample.eyeXNorm;
    const fitted = interceptNorm + slopeNorm * tSec;
    sse += Math.pow(y - fitted, 2);
    sst += Math.pow(y - meanY, 2);
  }

  const durationSec = (segSamples[segSamples.length - 1].t - segSamples[0].t) / 1000;
  const avgCanvasWidth = canvasWidthSum > 0 ? canvasWidthSum / n : oknWidth || 1;
  const avgStimVNorm = stimVNormSum > 0 ? stimVNormSum / n : (oknWidth > 0 ? stimSpeed / oknWidth : 0);

  const slopePx = slopeNorm * avgCanvasWidth;
  const gainPx = stimSpeed > 0 ? slopePx / stimSpeed : NaN;
  const r2 = sst > 1e-10 ? Math.max(0, 1 - sse / sst) : 0;

  return {
    slopeNorm,
    slopePx,
    gainPx,
    r2,
    interceptNorm,
    sse,
    sst,
    durationSec,
    sampleCount: n,
    startTimeSec: segSamples[0].t / 1000,
    canvasWidth: avgCanvasWidth,
    stimVNorm: avgStimVNorm,
    minEyeNorm,
    maxEyeNorm
  };
}

// Release 4A: Compute priority-ordered retry reason when quality gate fails
function computeRetryReason(coverage, quality, segmentCount, rangeNorm) {
  if (coverage < QUALITY_MIN_COVERAGE)
    return 'Not enough smooth eye tracking detected. Follow the moving bars closely.';
  if (quality < QUALITY_MIN_FRAC)
    return 'Too much movement or tracking loss. Hold phone and head still.';
  if (segmentCount < QUALITY_MIN_SEGMENTS)
    return 'Not enough tracking segments. Try following the bars for the full test.';
  if (rangeNorm < 0.04)
    return 'Very little eye movement detected. Make sure you can see and follow the stripes.';
  return null;
}

function analyzeOKN(samples) {
  console.log('🔍 ANALYZING OKN -', samples.length, 'total samples');

  if (!samples.length) {
    console.warn('❌ No samples collected');
    return {
      gain: NaN,
      r2: NaN,
      quality: 0,
      passQuality: false,
      decision: 'insufficient',
      label: 'No data',
      color: 'warn',
      detail: 'No eye tracking data was captured. Please retry the test.',
      retryReason: 'No eye tracking data was captured. Please retry the test.',
      slowPhaseCoverage: 0
    };
  }

  // Discard first 500ms of samples (MediaPipe settling + median filter warmup)
  const TRANSIENT_DISCARD_MS = 500;
  let transientDiscardCount = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].t < TRANSIENT_DISCARD_MS) {
      samples[i].usable = false;
      transientDiscardCount++;
    }
  }
  console.log(`Transient discard: marked ${transientDiscardCount} samples unusable (first ${TRANSIENT_DISCARD_MS}ms)`);

  const postTransientCount = samples.filter(s => s.usable && s.eyeX != null).length;
  if (postTransientCount < 30) {
    console.warn('Not enough samples after transient discard');
    return {
      gain: NaN, gainRaw: NaN, gainMedianRaw: NaN, gainCalibrated: NaN,
      theilSenVelocityNorm: NaN, r2: NaN, quality: 0, passQuality: false,
      decision: 'insufficient', label: 'Insufficient data', color: 'warn',
      detail: 'Not enough data after discarding initial transient.',
      retryReason: 'Not enough tracking data captured. Make sure your face is visible to the camera.',
      slowPhaseCoverage: 0, slowPhaseSegments: 0,
      slowPhaseMedianVelocityNormRaw: NaN, slowPhaseMedianVelocityNorm: NaN,
      slowPhaseMedianVelocityPx: NaN, slowPhaseMeanVelocityNormRaw: NaN,
      slowPhaseMeanVelocityNorm: NaN, slowPhaseMeanVelocityPx: NaN,
      slowPhaseVelocitiesNorm: [], slowPhaseVelocitiesPx: [],
      rejectionStats: {lowVelocity:0, highVelocity:0, highDeviation:0, highAcceleration:0, unusableSample:0},
      observedRangeNorm: 0, calibrationBoost: 1,
      gainCalMedian: NaN, calFactor: NaN,
      stimVelocityNorm: NaN, classifierProbability: NaN, classifierFeatures: null,
    };
  }

  const usableCount = samples.filter(s => s.usable && s.eyeX != null).length;
  const quality = usableCount / Math.max(1, samples.length - 1);

  console.log(`📊 Usable samples: ${usableCount}/${samples.length} (${(quality * 100).toFixed(1)}%)`);

  const usableVelocitiesPx = samples.filter(s => s.usable && typeof s.eyeV === 'number' && isFinite(s.eyeV)).map(s => s.eyeV);
  if (usableVelocitiesPx.length) {
    const posCount = usableVelocitiesPx.filter(v => v > 0).length;
    const negCount = usableVelocitiesPx.length - posCount;
    const meanVel = usableVelocitiesPx.reduce((a, b) => a + b, 0) / usableVelocitiesPx.length;
    const absMean = usableVelocitiesPx.reduce((a, b) => a + Math.abs(b), 0) / usableVelocitiesPx.length;
    const maxVel = Math.max(...usableVelocitiesPx);
    const minVel = Math.min(...usableVelocitiesPx);
    console.log(`📊 Eye velocity distribution (usable px/s): mean=${meanVel.toFixed(1)}, |mean|=${absMean.toFixed(1)}, range=[${minVel.toFixed(1)}, ${maxVel.toFixed(1)}], pos=${posCount}, neg=${negCount}`);
  }

  const usableVelocitiesNorm = samples.filter(s => s.usable && typeof s.eyeVNorm === 'number' && isFinite(s.eyeVNorm)).map(s => s.eyeVNorm);
  if (usableVelocitiesNorm.length) {
    const meanVelNorm = usableVelocitiesNorm.reduce((a, b) => a + b, 0) / usableVelocitiesNorm.length;
    const absMeanNorm = usableVelocitiesNorm.reduce((a, b) => a + Math.abs(b), 0) / usableVelocitiesNorm.length;
    const maxVelNorm = Math.max(...usableVelocitiesNorm);
    const minVelNorm = Math.min(...usableVelocitiesNorm);
    console.log(`📊 Eye velocity distribution (usable norm units/s): mean=${meanVelNorm.toFixed(4)}, |mean|=${absMeanNorm.toFixed(4)}, range=[${minVelNorm.toFixed(4)}, ${maxVelNorm.toFixed(4)}]`);
  }

  const { segments, rejectionStats, totalWindows } = segmentOKN(samples);
  console.log(`📊 Detected slow-phase segments: ${segments.length}`);
  console.log('📊 Slow-phase rejection stats:', rejectionStats);

  const slowPhaseMetrics = [];
  const pooledVelPairs = [];
  const pooledPosPairs = [];
  let pooledStimSum = 0;
  let pooledStimCount = 0;
  let sseTotal = 0;
  let sstTotal = 0;
  let slowPhaseDurationSec = 0;
  let slowPhaseSampleCount = 0;
  const slopeSignDistribution = { negative: 0, positive: 0 };

  segments.forEach((segment, index) => {
    const metrics = calculateSlowPhaseMetrics(segment, samples);
    if (!metrics) return;
    const minVelNorm = oknSlowMinV() / Math.max(metrics.canvasWidth || oknWidth || 1, 1);
    const maxVelNorm = oknSlowMaxV() / Math.max(metrics.canvasWidth || oknWidth || 1, 1);
    if (metrics.slopeNorm >= 0) {
      rejectionStats.lowVelocity++;
      return;
    }
    if (Math.abs(metrics.slopeNorm) < minVelNorm * 0.5) {
      rejectionStats.lowVelocity++;
      return;
    }
    if (Math.abs(metrics.slopeNorm) > maxVelNorm) {
      rejectionStats.highVelocity++;
      return;
    }

    slowPhaseMetrics.push({ ...metrics, index });
    if (metrics.slopeNorm < 0) slopeSignDistribution.negative++;
    else slopeSignDistribution.positive++;
    // Tag samples within this slow-phase segment with a segment id (index+1)
    for (let idx = segment.startIndex; idx <= segment.endIndex; idx++) {
      if (samples[idx]) samples[idx].slowPhaseSegId = index + 1;
    }
    const segStartTime = samples[segment.startIndex]?.t ?? 0;
    for (let idx = segment.startIndex; idx <= segment.endIndex; idx++) {
      const sample = samples[idx];
      if (!sample || !sample.usable) continue;
      const canvasWidth = sample.canvasWidth || oknWidth || 1;
      const stimNorm = sample.stimVNorm != null ? sample.stimVNorm : (canvasWidth > 0 ? stimSpeed / canvasWidth : 0);
      if (isFinite(stimNorm) && isFinite(sample.eyeVNorm)) {
        pooledVelPairs.push([stimNorm, sample.eyeVNorm]);
        pooledStimSum += stimNorm;
        pooledStimCount++;
      }
      const tSec = (sample.t - segStartTime) / 1000;
      if (isFinite(tSec) && isFinite(sample.eyeXNorm)) {
        pooledPosPairs.push([tSec, sample.eyeXNorm]);
      }
    }
    sseTotal += metrics.sse;
    sstTotal += metrics.sst;
    slowPhaseDurationSec += metrics.durationSec;
    slowPhaseSampleCount += metrics.sampleCount;
  });

  const slowPhaseVelocitiesNorm = slowPhaseMetrics.map(m => m.slopeNorm);
  const slowPhaseVelocitiesPx = slowPhaseMetrics.map(m => m.slopePx);

  // --- Population-level geometric gain correction ---
  // K_GEO (1714.1) recalibrated on correct slow-phase segments from 28 post-fix recordings.
  // gainCal = |slopeNorm| × K_GEO / stimSpeed (device-independent)
  const K_GAIN = K_GEO / stimSpeed;
  let calFactor = K_GAIN;
  console.log(`Geometric correction: K_GEO=${K_GEO}, K_GAIN=${K_GAIN.toFixed(4)}, eyeSpanCal=${calibratedEyeSpan ? calibratedEyeSpan.toFixed(4) : 'null'}`);

  slowPhaseMetrics.forEach((m, i) => {
    m.gainCal = isFinite(m.slopeNorm) ? Math.abs(m.slopeNorm) * K_GAIN : NaN;
  });

  // Tag per-sample gainCal using segment-level gain
  const segGainCalMap = new Map();
  slowPhaseMetrics.forEach((m, i) => {
    segGainCalMap.set(i + 1, m.gainCal);
  });
  for (const s of samples) {
    if (s.slowPhaseSegId > 0) {
      const segGain = segGainCalMap.get(s.slowPhaseSegId);
      if (segGain != null && isFinite(segGain)) {
        s.gainCal = segGain;
      }
    }
  }

  const gainCalMedian = median(slowPhaseMetrics.map(m => m.gainCal).filter(v => isFinite(v)));

  slowPhaseMetrics.forEach((metrics, i) => {
    const calStr = isFinite(metrics.gainCal) ? `, gainCal=${metrics.gainCal.toFixed(3)}` : '';
    console.log(`   Slow phase ${i + 1}: ${(metrics.durationSec * 1000).toFixed(0)}ms, R2=${metrics.r2.toFixed(2)}, slopeNorm=${metrics.slopeNorm.toFixed(4)} (~${metrics.slopePx.toFixed(1)} px/s${calStr})`);
  });

  const totalDurationSec = samples[samples.length - 1].t / 1000;
  const slowPhaseCoverage = totalDurationSec > 0 ? slowPhaseDurationSec / totalDurationSec : 0;

  console.log(`📊 Slow-phase coverage: ${(slowPhaseCoverage * 100).toFixed(1)}% of test (${slowPhaseSampleCount} samples)`);

  const hasEnoughSegments = slowPhaseVelocitiesNorm.length >= QUALITY_MIN_SEGMENTS;
  let passQuality = quality >= QUALITY_MIN_FRAC && hasEnoughSegments && slowPhaseCoverage >= QUALITY_MIN_COVERAGE;

  if (!hasEnoughSegments) {
    console.warn(`Warning: Only ${slowPhaseVelocitiesNorm.length} slow phases detected (< ${QUALITY_MIN_SEGMENTS}).`);
  }
  if (slowPhaseCoverage < QUALITY_MIN_COVERAGE) {
    console.warn(`Warning: Slow-phase coverage ${(slowPhaseCoverage * 100).toFixed(1)}% below required ${(QUALITY_MIN_COVERAGE * 100).toFixed(1)}%.`);
  }

  if (!slowPhaseVelocitiesNorm.length) {
    console.warn('❌ No valid slow-phase segments detected');
    if (mGain) mGain.textContent = '—';
    if (mR2) mR2.textContent = '—';
    if (mQuality) mQuality.textContent = (quality * 100).toFixed(0) + '%';

    const featureData = computeClassifierFeatures(samples, NaN); // Pass NaN when gain not available yet
    let classifierProbability = 1;
    let decision = 'likely';
    let label = 'Elevated research pattern';
    let color = 'bad';
    let detail = 'Eye movement was minimal, so the system could not run a full OKN analysis. Result defaults to elevated research pattern for safety.';

    if (classifierArtifact && featureData) {
      const prediction = predictClassifier(featureData);
      if (prediction) {
        console.log(`Classifier research probability (ignored due to minimal movement): ${(prediction.probability * 100).toFixed(2)}%`);
        console.table(prediction.featureMap);
      }
    }

    return {
      gain: NaN,
      gainRaw: NaN,
      gainMedianRaw: NaN,
      gainCalibrated: NaN,
      theilSenVelocityNorm: NaN,
      r2: NaN,
      quality,
      passQuality: false,
      decision,
      label,
      color,
      detail,
      retryReason: computeRetryReason(slowPhaseCoverage, quality, 0, 0),
      slowPhaseCoverage,
      slowPhaseSegments: 0,
      slowPhaseMedianVelocityNormRaw: NaN,
      slowPhaseMedianVelocityNorm: NaN,
      slowPhaseMedianVelocityPx: NaN,
      slowPhaseMeanVelocityNormRaw: NaN,
      slowPhaseMeanVelocityNorm: NaN,
      slowPhaseMeanVelocityPx: NaN,
      slowPhaseVelocitiesNorm: [],
      slowPhaseVelocitiesPx: [],
      rejectionStats,
      observedRangeNorm: 0,
      calibrationBoost: 1,
      gainCalMedian: NaN,
      calFactor: NaN,
      stimVelocityNorm: oknWidth > 0 ? stimSpeed / oknWidth : NaN,
      classifierProbability,
      classifierFeatures: featureData ? featureData.featureMap : null,
      segmentation: {
        totalWindows,
        rejectionStats: { ...rejectionStats },
        acceptedSegments: 0,
        slopeSignDistribution: { ...slopeSignDistribution },
        coverageFraction: slowPhaseCoverage,
        gainCalMedian: NaN,
        gainCalCV: NaN,
      },
    };
  }

  const medianVelocityNormRaw = median(slowPhaseVelocitiesNorm);
  const meanVelocityNormRaw = slowPhaseVelocitiesNorm.reduce((a, b) => a + b, 0) / slowPhaseVelocitiesNorm.length;
  const minVelocityNormRaw = Math.min(...slowPhaseVelocitiesNorm);
  const maxVelocityNormRaw = Math.max(...slowPhaseVelocitiesNorm);

  const avgCanvasWidth = slowPhaseMetrics.length ? slowPhaseMetrics.reduce((acc, m) => acc + m.canvasWidth, 0) / slowPhaseMetrics.length : oknWidth || 1;
  const avgStimVelNorm = slowPhaseMetrics.length ? slowPhaseMetrics.reduce((acc, m) => acc + (m.stimVNorm ?? 0), 0) / slowPhaseMetrics.length : (oknWidth > 0 ? stimSpeed / oknWidth : stimSpeed / avgCanvasWidth);

  let minEyeNorm = Infinity;
  let maxEyeNorm = -Infinity;
  slowPhaseMetrics.forEach(m => {
    if (m.minEyeNorm < minEyeNorm) minEyeNorm = m.minEyeNorm;
    if (m.maxEyeNorm > maxEyeNorm) maxEyeNorm = m.maxEyeNorm;
  });
  const observedRangeNorm = (minEyeNorm === Infinity || maxEyeNorm === -Infinity) ? 0 : (maxEyeNorm - minEyeNorm);

  const pooledStimVelNorm = pooledStimCount > 0 ? pooledStimSum / pooledStimCount : avgStimVelNorm;
  let pooledSlopeNorm = theilSenSlope(pooledVelPairs);
  if (!isFinite(pooledSlopeNorm)) {
    pooledSlopeNorm = theilSenSlope(pooledPosPairs);
  }
  if (!isFinite(pooledSlopeNorm)) {
    pooledSlopeNorm = medianVelocityNormRaw;
  }
  const theilSenVelocityNorm = pooledSlopeNorm;

  if (observedRangeNorm < 0.04) {
    console.warn(`Warning: Slow-phase range (${observedRangeNorm.toFixed(4)}) too small. Results may be unreliable.`);
    passQuality = false;
  }

  // No calibrationBoost — using eye-span geometric correction instead
  const calibrationBoost = 1;

  const medianVelocityNorm = median(slowPhaseVelocitiesNorm);
  const meanVelocityNorm = slowPhaseVelocitiesNorm.reduce((a, b) => a + b, 0) / slowPhaseVelocitiesNorm.length;

  const medianVelocityPx = medianVelocityNorm * avgCanvasWidth;
  const meanVelocityPx = meanVelocityNorm * avgCanvasWidth;

  console.log(`📊 Slow-phase velocities (normalized units/s): raw median=${medianVelocityNormRaw.toFixed(4)}, mean=${meanVelocityNormRaw.toFixed(4)}, range=[${minVelocityNormRaw.toFixed(4)}, ${maxVelocityNormRaw.toFixed(4)}]`);
  console.log(`📊 Eye-span correction: calibratedEyeSpan=${calibratedEyeSpan ? calibratedEyeSpan.toFixed(4) : 'null'}, gainCalMedian=${isFinite(gainCalMedian) ? gainCalMedian.toFixed(3) : 'NaN'}`);
  console.log(`📊 Slow-phase velocities (px/s): median=${medianVelocityPx.toFixed(1)}, mean=${meanVelocityPx.toFixed(1)}`);

  const gainRaw = pooledStimVelNorm > 0 ? pooledSlopeNorm / pooledStimVelNorm : NaN;
  const gainMedianRaw = avgStimVelNorm > 0 ? medianVelocityNormRaw / avgStimVelNorm : NaN;
  const gainCalibrated = isFinite(gainRaw) ? gainRaw * calibrationBoost : NaN;
  const r2 = sstTotal > 0 ? Math.max(0, Math.min(1, 1 - (sseTotal / sstTotal))) : 0;

  console.log(`📊 Theil-Sen pooled slope: ${theilSenVelocityNorm.toFixed(4)} units/s (stim avg ${pooledStimVelNorm.toFixed(4)})`);
  console.log(`📊 OKN Gain (reported): raw=${isFinite(gainRaw) ? gainRaw.toFixed(3) : 'NaN'} calibrated=${isFinite(gainCalibrated) ? gainCalibrated.toFixed(3) : 'NaN'} medianRaw=${isFinite(gainMedianRaw) ? gainMedianRaw.toFixed(3) : 'NaN'}`);
  console.log(`📊 Eye-span gain (gainCal): median=${isFinite(gainCalMedian) ? gainCalMedian.toFixed(3) : 'NaN'}, calFactor=${isFinite(calFactor) ? calFactor.toFixed(4) : 'NaN'}`);
  console.log(`📊 Slow-phase regression R²: ${r2.toFixed(4)}`);

  // Primary gain: eye-span-corrected median (if available), else raw
  const gainToReport = isFinite(gainCalMedian) ? gainCalMedian : (isFinite(gainRaw) ? gainRaw : gainMedianRaw);

  // Classifier dispatch: catboost_baseline (z-scored) > logistic_regression (windowed) > RF (session-level)
  const isCatBoostBaseline = classifierArtifact && classifierArtifact.model_type === 'catboost_baseline';
  const isLogReg = classifierArtifact && classifierArtifact.model_type === 'logistic_regression';
  const classifierFeatureResult = (isLogReg || isCatBoostBaseline) ? null : computeClassifierFeatures(samples, gainToReport);
  console.log('🔍 Classifier mode:', isCatBoostBaseline ? 'catboost_baseline (z-scored)' : isLogReg ? 'logistic_regression (windowed)' : 'random_forest (session-level)', {
    hasArtifact: !!classifierArtifact,
    hasBaseline: !!(typeof window !== 'undefined' && window.__BASELINE_FEATURES__),
    featureMapKeys: classifierFeatureResult ? Object.keys(classifierFeatureResult.featureMap || {}).length : 'n/a',
  });
  let classifierProbability = NaN;
  let decision = 'insufficient';
  let label = 'Classifier unavailable';
  let color = 'warn';
  let detail = 'Classifier artefact not yet loaded. See console for raw metrics.';

  // Compute baseline features for all model types (used in upload + validation)
  const baselineRawFeatures = computeBaselineFeatures(samples);

  if (classifierArtifact) {
    let prediction = null;

    if (isCatBoostBaseline) {
      // C2-alt CatBoost: requires research baseline for z-scoring
      const hasBaseline = typeof window !== 'undefined' && window.__BASELINE_FEATURES__;
      if (hasBaseline) {
        prediction = predictCatBoostBaseline(samples);
      } else {
        console.error('❌ CatBoost baseline: no baseline sessions loaded. Cannot classify.', JSON.stringify({
          error: 'no_baseline_loaded',
          hasArtifact: !!classifierArtifact,
        }));
      }
    } else if (isLogReg) {
      prediction = predictWindowedLogReg(samples, gainToReport);
    } else {
      prediction = classifierFeatureResult ? predictClassifier(classifierFeatureResult) : null;
    }

    if (prediction) {
      classifierProbability = prediction.probability;
      console.log(`Classifier research probability: ${(classifierProbability * 100).toFixed(2)}%`);
      if (prediction.featureMap) console.table(prediction.featureMap);
      // Binary classification: elevated vs baseline-range research pattern
      if (prediction.impaired) {
        decision = 'likely';
        label = 'Elevated research pattern';
        color = 'bad';
        detail = 'Research signal: elevated eye-movement pattern. Not a diagnosis. Not alcohol-related.';
      } else {
        decision = 'unlikely';
        label = 'Baseline-range research pattern';
        color = 'ok';
        detail = 'Eye tracking is consistent with your research baseline.';
      }
    } else {
      // No fallback — log structured error for debugging
      const errorContext = {
        error: 'classifier_prediction_null',
        hasFeatureResult: !!classifierFeatureResult,
        hasArtifact: !!classifierArtifact,
        isCatBoostBaseline,
        hasBaseline: !!(typeof window !== 'undefined' && window.__BASELINE_FEATURES__),
        baselineCount: Array.isArray(window.__BASELINE_FEATURES__) ? window.__BASELINE_FEATURES__.length : 0,
        gainToReport: isFinite(gainToReport) ? gainToReport : null,
      };
      console.error('❌ Classifier prediction returned null. No fallback.', JSON.stringify(errorContext));
      decision = 'insufficient';
      label = 'Test Error';
      color = 'warn';
      detail = 'Classifier could not run. Please ensure you have completed calibration.';
    }
  } else {
    // No fallback — log structured error for debugging
    console.error('❌ Classifier artifact not loaded. No fallback.', JSON.stringify({
      error: 'artifact_not_loaded',
      modelUrl: MODEL_ARTIFACT_URL,
    }));
    decision = 'insufficient';
    label = 'Test Error';
    color = 'warn';
    detail = 'Classifier model not loaded. Please check your connection and retry.';
  }

  const minimalMovement = !isFinite(observedRangeNorm) ? false : observedRangeNorm < 0.02;
  if (minimalMovement) {
    console.log('Detected minimal eye movement; defaulting to elevated research pattern for investigator review.');
    classifierProbability = 1;
    decision = 'likely';
    label = 'Elevated research pattern';
    color = 'bad';
    detail = 'Eye movement stayed steady throughout the assessment. Result defaults to elevated research pattern for investigator review.';
  }

  if (mGain) mGain.textContent = '—';
  if (mR2) mR2.textContent = '—';
  if (mQuality) mQuality.textContent = (quality * 100).toFixed(0) + '%';

  // Release 4A: Compute specific retry reason when quality gate fails
  const retryReason = passQuality ? null : computeRetryReason(
    slowPhaseCoverage, quality, slowPhaseVelocitiesNorm.length, observedRangeNorm
  );

  return {
    gain: gainToReport,
    gainRaw,
    gainMedianRaw,
    gainCalibrated,
    theilSenVelocityNorm,
    r2,
    quality,
    passQuality,
    decision,
    label,
    color,
    detail,
    retryReason,
    slowPhaseCoverage,
    slowPhaseSegments: slowPhaseVelocitiesNorm.length,
    slowPhaseMedianVelocityNormRaw: medianVelocityNormRaw,
    slowPhaseMedianVelocityNorm: medianVelocityNorm,
    slowPhaseMedianVelocityPx: medianVelocityPx,
    slowPhaseMeanVelocityNormRaw: meanVelocityNormRaw,
    slowPhaseMeanVelocityNorm: meanVelocityNorm,
    slowPhaseMeanVelocityPx: meanVelocityPx,
    slowPhaseVelocitiesNorm,
    slowPhaseVelocitiesPx,
    rejectionStats,
    observedRangeNorm,
    calibrationBoost,
    gainCalMedian,
    calFactor,
    stimVelocityNorm: avgStimVelNorm,
    classifierProbability,
    classifierFeatures: classifierFeatureResult ? classifierFeatureResult.featureMap : null,
    baselineRawFeatures: baselineRawFeatures || null,
    segmentation: (() => {
      const gains = slowPhaseMetrics.map(m => m.gainCal).filter(v => isFinite(v));
      const gcMedian = gainCalMedian;
      let gcCV = NaN;
      if (gains.length >= 2 && isFinite(gcMedian) && gcMedian !== 0) {
        const mean = gains.reduce((a, b) => a + b, 0) / gains.length;
        const variance = gains.reduce((a, v) => a + (v - mean) ** 2, 0) / gains.length;
        gcCV = Math.sqrt(variance) / Math.abs(mean);
      }
      return {
        totalWindows,
        rejectionStats: { ...rejectionStats },
        acceptedSegments: slowPhaseMetrics.length,
        slopeSignDistribution: { ...slopeSignDistribution },
        coverageFraction: slowPhaseCoverage,
        gainCalMedian: gcMedian,
        gainCalCV: gcCV,
      };
    })(),
  };
}

// Export waveform data for plotting (Python only)
function exportWaveformData(samples, stimV, eyeV, gain, r2) {
  // Create time series data
  const timeData = [];
  for(let i = 1; i < samples.length; i++) {
    const s = samples[i];
    if(!s.usable) continue;
    timeData.push({
      time: s.t / 1000,
      stimV: s.stimV,
      eyeV: s.eyeV,
      eyeX: s.eyeX
    });
  }
  
  const timeArray = timeData.map(d => d.time);
  const eyeVArray = timeData.map(d => d.eyeV);
  const stimVArray = timeData.map(d => d.stimV);
  const eyeXArray = timeData.map(d => d.eyeX);
  
  // Calculate stimulus position (integrate velocity)
  const stimXArray = [];
  let stimX = 0;
  for(let i = 0; i < timeArray.length; i++) {
    if(i > 0) {
      const dt = timeArray[i] - timeArray[i-1];
      stimX += stimVArray[i] * dt;
    }
    stimXArray.push(stimX);
  }
  
  // Python plotting code with position graphs
  console.log('\n📄 Python plotting code (Position Analysis):');
  const pythonCode = `import matplotlib.pyplot as plt
import numpy as np

time = [${timeArray.map(t => t.toFixed(3)).join(', ')}]
eyeV = [${eyeVArray.map(v => v.toFixed(2)).join(', ')}]
stimV = [${stimVArray.map(v => v.toFixed(2)).join(', ')}]
eyeX = [${eyeXArray.map(x => x.toFixed(2)).join(', ')}]
stimX = [${stimXArray.map(x => x.toFixed(2)).join(', ')}]

# Create figure with 3 subplots: Position (main), Velocity, and Zoomed Position
fig = plt.figure(figsize=(16, 12))
gs = fig.add_gridspec(3, 1, height_ratios=[2, 1, 1])

# Plot 1: Eye Position vs Stimulus Position (MAIN - shows tracking)
ax1 = fig.add_subplot(gs[0, 0])
ax1.plot(time, eyeX, 'b-', label='Eye Position (px)', linewidth=2, alpha=0.8)
ax1.plot(time, stimX, 'r--', label='Stimulus Position (px)', linewidth=2, alpha=0.6)
ax1.axhline(y=0, color='k', linestyle='-', linewidth=0.5, alpha=0.3)
ax1.set_xlabel('Time (seconds)', fontsize=12)
ax1.set_ylabel('Position (px)', fontsize=12)
ax1.set_title(f'IRIS POSITION TRACKING\\nGain: ${gain.toFixed(4)}, R²: ${r2.toFixed(4)}, Mean Eye Velocity: ${(eyeVArray.reduce((a,b)=>a+b,0)/eyeVArray.length).toFixed(1)} px/s', fontsize=14, fontweight='bold')
ax1.legend(fontsize=11)
ax1.grid(True, alpha=0.3)
ax1.set_xlim([0, max(time)])

# Plot 2: Velocity vs Time
ax2 = fig.add_subplot(gs[1, 0])
ax2.plot(time, eyeV, 'b-', label='Eye Velocity', linewidth=1.5, alpha=0.7)
ax2.plot(time, stimV, 'r--', label='Stimulus Velocity', linewidth=1.5, alpha=0.6)
ax2.axhline(y=0, color='k', linestyle='-', linewidth=0.5, alpha=0.3)
ax2.set_xlabel('Time (seconds)', fontsize=11)
ax2.set_ylabel('Velocity (px/s)', fontsize=11)
ax2.set_title('Velocity Analysis', fontsize=12)
ax2.legend(fontsize=10)
ax2.grid(True, alpha=0.3)
ax2.set_xlim([0, max(time)])

# Plot 3: Zoomed Position (first 2 seconds)
ax3 = fig.add_subplot(gs[2, 0])
zoom_end = min(2.0, max(time))
zoom_mask = [t <= zoom_end for t in time]
ax3.plot([t for i, t in enumerate(time) if zoom_mask[i]], 
         [x for i, x in enumerate(eyeX) if zoom_mask[i]], 
         'b-', label='Eye Position', linewidth=2, alpha=0.8)
ax3.plot([t for i, t in enumerate(time) if zoom_mask[i]], 
         [x for i, x in enumerate(stimX) if zoom_mask[i]], 
         'r--', label='Stimulus Position', linewidth=2, alpha=0.6)
ax3.axhline(y=0, color='k', linestyle='-', linewidth=0.5, alpha=0.3)
ax3.set_xlabel('Time (seconds)', fontsize=11)
ax3.set_ylabel('Position (px)', fontsize=11)
ax3.set_title(f'Zoomed View (0-{zoom_end}s)', fontsize=12)
ax3.legend(fontsize=10)
ax3.grid(True, alpha=0.3)

plt.tight_layout()
plt.show()

# Print statistics
print(f"Eye Position Stats:")
print(f"  Min: {min(eyeX):.2f} px")
print(f"  Max: {max(eyeX):.2f} px")
print(f"  Range: {max(eyeX) - min(eyeX):.2f} px")
print(f"  Mean: {np.mean(eyeX):.2f} px")
print(f"\\nStimulus Position Stats:")
print(f"  Min: {min(stimX):.2f} px")
print(f"  Max: {max(stimX):.2f} px")
print(f"  Range: {max(stimX) - min(stimX):.2f} px")
print(f"\\nEye Velocity Stats:")
print(f"  Mean: {np.mean(eyeV):.2f} px/s")
print(f"  Std Dev: {np.std(eyeV):.2f} px/s")
print(f"  Positive: {sum(1 for v in eyeV if v > 0)} ({sum(1 for v in eyeV if v > 0)/len(eyeV)*100:.1f}%)")
print(f"  Negative: {sum(1 for v in eyeV if v < 0)} ({sum(1 for v in eyeV if v < 0)/len(eyeV)*100:.1f}%)")`;
  
  console.log(pythonCode);
}

function buildCsv(samples){
  const header = ['time_s','eyeXNorm','eyeVNorm','eyeX_px','eyeV_px','stimXNorm','stimVNorm','stimV_px','usable','slowPhaseSegId','rawIrisX','rawEyeXNorm','gainPx','gainCal','eyeSpanCal','selectedEye'];
  const lines = [header.join(',')];
  for(const s of samples){
    const row = [
      (s.t/1000).toFixed(3),
      s.eyeXNorm!=null? s.eyeXNorm.toFixed(6):'',
      s.eyeVNorm!=null? s.eyeVNorm.toFixed(6):'',
      s.eyeX!=null? s.eyeX.toFixed(2):'',
      s.eyeV!=null? s.eyeV.toFixed(2):'',
      s.stimXNorm!=null? s.stimXNorm.toFixed(6):'',
      s.stimVNorm!=null? s.stimVNorm.toFixed(6):'',
      s.stimV!=null? s.stimV.toFixed(2):'',
      s.usable? '1':'0',
      s.slowPhaseSegId? String(s.slowPhaseSegId) : '0',
      s.rawIrisX!=null? s.rawIrisX.toFixed(6):'',
      s.rawEyeXNorm!=null? s.rawEyeXNorm.toFixed(6):'',
      s.gainPx!=null? s.gainPx.toFixed(4):'',
      s.gainCal!=null? s.gainCal.toFixed(4):'',
      calibratedEyeSpan!=null? calibratedEyeSpan.toFixed(6):'',
      s.selectedEye || ''
    ];
    lines.push(row.join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

// ---------- Decision & Assistance ----------
function showDecision(res){
  if(decisionCard) decisionCard.classList.remove('hidden');
  if(decisionTag) {
    decisionTag.textContent = res.label;
    decisionTag.className = 'tag ' + (res.color==='ok' ? 'ok' : res.color==='bad' ? 'bad' : 'warn');
  }
  if(decisionText) decisionText.textContent = res.detail;

  if(decisionActions) {
    decisionActions.innerHTML = '';
    const actions = [];

    const goSafe = document.createElement('button');
    goSafe.className = 'btn primary';
    goSafe.textContent = 'Get home safely';
    goSafe.onclick = () => { 
      if(assistCard) assistCard.classList.remove('hidden'); 
      initLocationAndLinks(); 
    };
    // Release 4A: Show specific retry reason if quality gate failed
    if (res.retryReason && !res.passQuality) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = res.retryReason;
      decisionActions.appendChild(hint);
    }

    const retry = document.createElement('button');
    retry.className = 'btn';
    retry.textContent = 'Retry test';
    retry.onclick = () => { startTest(); };

    if(res.decision==='likely' || res.decision==='possible'){
      // Auto prompt safe navigation and start location tracking (demo)
      if(assistCard) assistCard.classList.remove('hidden');
      initLocationAndLinks();
      actions.push(goSafe, retry);
    }else if(res.decision==='unlikely'){
      // research disclaimer (no EtOH / driving messaging)
      const disclaimer = document.createElement('div');
      disclaimer.className = 'hint';
      disclaimer.textContent = "Research prototype only — not a medical diagnosis. Not for alcohol or driving decisions.";
      decisionActions.appendChild(disclaimer);
      actions.push(goSafe, retry);
    }else{
      actions.push(retry);
    }
    actions.forEach(el => decisionActions.appendChild(el));
  }
}

// ---------- Location & Ride options ----------

async function initLocationAndLinks(){
  if(leafletMap) return; // already initialized
  if(!mapWrap) return; // no map element

  leafletMap = L.map(mapWrap, {zoomControl:false, attributionControl:false}).setView([0,0], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(leafletMap);
  userMarker = L.marker([0,0]).addTo(leafletMap);

  if('geolocation' in navigator){
    watchId = navigator.geolocation.watchPosition(onPos, err => {
      console.warn(err);
      alert('Location permission denied or unavailable.');
    }, {enableHighAccuracy:true, maximumAge: 2_000, timeout: 10_000});
  }else{
    alert("Geolocation is not supported in this browser.");
  }

  updateFriendFromStorage();
}

function onPos(pos){
  const {latitude, longitude} = pos.coords;
  lastCoords = {lat: latitude, lng: longitude, ts: Date.now()};
  userMarker.setLatLng([latitude, longitude]);
  leafletMap.setView([latitude, longitude], leafletMap.getZoom()||15);

  // Build ride links
  buildRideLinks(latitude, longitude);

  // Simulated friend update text
  updateShareTexts();
  checkHomeArrival();
}

function buildRideLinks(lat, lng){
  const pickup = `${lat},${lng}`;
  if(uberLink) uberLink.href = `https://m.uber.com/ul/?action=setPickup&pickup=my_location`;
  if(lyftLink) lyftLink.href = `https://ride.lyft.com/`; // web fallback
  if(taxiLink) taxiLink.href = `https://www.google.com/maps/search/?api=1&query=taxi&query_place_id=&center=${lat}%2C${lng}`;
  if(transitLink) transitLink.href = `https://www.google.com/maps/search/?api=1&query=public%20transit&center=${lat}%2C${lng}`;
}

function updateFriendFromStorage(){
  friendPhone = localStorage.getItem('oknFriend')||'';
  if(friendPhoneIn) friendPhoneIn.value = friendPhone;
  updateShareTexts();
}

function updateShareTexts(){
  if(!lastCoords) return;
  const locStr = `lat=${lastCoords.lat.toFixed(5)}, lng=${lastCoords.lng.toFixed(5)}`;
  const url = `https://maps.google.com/?q=${lastCoords.lat},${lastCoords.lng}`;
  if(btnCallFriend) btnCallFriend.href = friendPhone ? `tel:${friendPhone}` : '#';
  if(btnTextFriend) {
    btnTextFriend.onclick = ()=>{
      const body = encodeURIComponent(`I'm not driving. Here's my live location (refresh as I move): ${url}`);
      const sms = friendPhone ? `sms:${friendPhone}?&body=${body}` : `sms:?&body=${body}`;
      window.location.href = sms;
    };
  }
  if(btnShare) {
    btnShare.onclick = async ()=>{
      const text = `Sharing my location: ${url}`;
      try{
        if(navigator.share){
          await navigator.share({title:'My location', text, url});
        }else{
          await navigator.clipboard.writeText(`${text}\n${url}`);
          alert('Location copied to clipboard.');
        }
      }catch(e){ console.warn(e); }
    };
  }
}

function checkHomeArrival(){
  if(!home || !lastCoords) return;
  const d = haversine(lastCoords.lat, lastCoords.lng, home.lat, home.lng);
  if(d < 0.05){ // <50m
    if(watchId!=null){
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if(homeStatus) homeStatus.textContent = 'Arrived home — live updates paused.';
  }else{
    if(homeStatus) homeStatus.textContent = `Distance to home: ${(d).toFixed(2)} km`;
  }
}

function haversine(lat1, lon1, lat2, lon2){
  const R=6371, toRad = (x)=>x*Math.PI/180;
  const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * (2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// ---------- Wire up UI ----------
// Initialize UI elements first
initUIElements();

if(btnStart) btnStart.onclick = startTest;
if(btnStop) btnStop.onclick = stopTest;

// Service worker registration removed - not essential for real functionality

// Mirror toggle affects only video via CSS; ensure class toggles
if(mirrorToggle) {
  mirrorToggle.addEventListener('change', ()=>{
    if(video && mirrorToggle) video.style.transform = mirrorToggle.checked ? 'scaleX(-1)' : 'scaleX(1)';
  });
}

// Real initialization only when test is started - no early priming

// Expose functions to window for React app to call
window.startTest = startTest;
window.resetTest = resetTest;

// Listen for deferred upload trigger (research metadata submit)
window.addEventListener('upload-with-bac', function(e) {
  const pending = window.__pendingUpload;
  if (!pending) {
    console.warn('upload-with-bac fired but no pending upload data');
    return;
  }
  const bac = e.detail && e.detail.bac != null ? e.detail.bac : null;
  const selfReportLabel = e.detail && e.detail.selfReportLabel ? e.detail.selfReportLabel : null;
  const targetTable = e.detail && e.detail.targetTable ? e.detail.targetTable : null;

  // Inject optional schema field into the result object for upload
  if (bac !== null && pending.result) {
    pending.result.bac = bac;
  }

  window.dispatchEvent(new CustomEvent('upload-state-change', {
    detail: { phase: 'uploading' }
  }));

  // Build upload options (routes to uncertain_bac_tests if self-report only)
  const uploadOptions = {};
  if (targetTable === 'uncertain_bac_tests' && selfReportLabel) {
    uploadOptions.targetTable = 'uncertain_bac_tests';
    uploadOptions.selfReportLabel = selfReportLabel;
  }

  uploadResultsToSupabase(pending.csv, pending.result, pending.videoBlob, pending.sidecarJson, uploadOptions).then(function(uploadResult) {
    if (uploadResult.error) {
      console.warn('Supabase v2 upload failed:', uploadResult.error);
      window.dispatchEvent(new CustomEvent('upload-state-change', {
        detail: { phase: 'failed', error: uploadResult.error }
      }));
    } else {
      console.log('Supabase v2 upload success:', uploadResult.id);
      pending.detail.supabaseCsvPath = uploadResult.path || null;
      pending.detail.supabaseRowId = uploadResult.id || null;
      window.dispatchEvent(new CustomEvent('upload-state-change', {
        detail: { phase: 'complete', supabaseRowId: uploadResult.id, csvPath: uploadResult.path }
      }));
    }
    window.__pendingUpload = null;
  }).catch(function(err) {
    console.warn('Supabase v2 upload error:', err);
    window.dispatchEvent(new CustomEvent('upload-state-change', {
      detail: { phase: 'failed', error: err.message }
    }));
  });
});

// =====================================================================
// BASELINE CLASSIFIER — C2-alt CatBoost (3 z-scored features)
// Threshold 0.7406 needs recalibration at N>=30 (CI wide at N=8).
// Single-session baseline uses unscaled deviation; >=3 sessions recommended.
// accel_kurtosis: pursuit dynamics feature (research pipeline),
// producing jerky acceleration with heavy tails (high kurtosis).
// =====================================================================

// --- Phase detector: port of phase_detector_tdd.py detect_phases() ---
// Reference: analysis_csvs/device_invariance/phase_detector_tdd.py
// DO NOT use existing segmentOKN() — it has 3 known inverted bugs.

function detectSaccadeEvents(samples, opts) {
  const ONSET_THRESH = (opts && opts.onsetThresh) || 1.5;     // norm/s
  const OFFSET_VEL = (opts && opts.offsetVel) || 0.05;        // norm/s
  const SMOOTH_W = (opts && opts.smoothWindow) || 5;           // frames
  const MAX_BACK = (opts && opts.maxBackScan) || 10;           // frames
  const MERGE_GAP = 2;                                         // frames

  const n = samples.length;
  if (n < 3) return [];

  // Build time and eye arrays from samples
  // Use eyeXNorm (3-sample median filtered) from ALL frames, regardless of usable flag.
  // Python detect_phases() reads ALL CSV rows with finite eyeXNorm — it does NOT check
  // the usable column. The usable flag gates segment analysis in segmentOKN(), not phase
  // detection. Filtering by usable creates gaps that suppress saccade velocity peaks
  // (82 peaks > 1.5 on all frames vs 2 on usable-only in parity test).
  const t = new Float64Array(n);
  const eye = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = (samples[i].t || 0) / 1000;  // ms -> s
    eye[i] = (samples[i].eyeXNorm != null && isFinite(samples[i].eyeXNorm))
      ? samples[i].eyeXNorm : NaN;
  }

  // Step 1: Instantaneous velocity
  const velInst = new Float64Array(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    const dt = t[i] - t[i - 1];
    if (dt > 0 && isFinite(eye[i]) && isFinite(eye[i - 1])) {
      velInst[i] = (eye[i] - eye[i - 1]) / dt;
    }
  }

  // Step 3: Find saccade peak groups (vel > onset threshold)
  const peakGroups = [];
  let startG = -1;
  for (let i = 0; i < n; i++) {
    if (isFinite(velInst[i]) && velInst[i] > ONSET_THRESH) {
      if (startG < 0) startG = i;
    } else {
      if (startG >= 0) {
        peakGroups.push([startG, i - 1]);
        startG = -1;
      }
    }
  }
  if (startG >= 0) peakGroups.push([startG, n - 1]);

  // Step 4: Expand each peak group to full saccade
  const expanded = [];
  for (const g of peakGroups) {
    // Find peak velocity frame within group
    let pkIdx = g[0];
    let pkVal = velInst[g[0]];
    for (let i = g[0] + 1; i <= g[1]; i++) {
      if (isFinite(velInst[i]) && velInst[i] > pkVal) {
        pkVal = velInst[i];
        pkIdx = i;
      }
    }

    // Onset: scan backward while eye is non-increasing
    let j = pkIdx - 1;
    let backCount = 0;
    while (j >= 0 && backCount < MAX_BACK) {
      if (isFinite(eye[j]) && isFinite(eye[j + 1]) && eye[j] <= eye[j + 1]) {
        j--;
        backCount++;
      } else {
        break;
      }
    }
    const onset = j + 1;

    // Offset: scan forward while velocity > offset threshold
    let k = pkIdx + 1;
    while (k < n && isFinite(velInst[k]) && velInst[k] > OFFSET_VEL) {
      k++;
    }
    const offset = k - 1;

    expanded.push([onset, offset]);
  }

  // Step 5: Merge overlapping/adjacent saccade events
  if (expanded.length === 0) return [];
  const merged = [[expanded[0][0], expanded[0][1]]];
  for (let i = 1; i < expanded.length; i++) {
    const [s, e] = expanded[i];
    if (s <= merged[merged.length - 1][1] + MERGE_GAP) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    } else {
      merged.push([s, e]);
    }
  }

  return merged;
}

// --- Feature extractors: match Python reference implementations ---

function baselineGazeEntropy(samples, nBins) {
  // Reference: makowski_features.py:71-98
  // Use eyeXNorm (median-filtered) — matches Python training data from CSV
  nBins = nBins || 20;
  // Use ALL frames with finite eyeXNorm (Python ignores usable flag)
  const valid = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.eyeXNorm != null && isFinite(s.eyeXNorm)) {
      valid.push(s.eyeXNorm);
    }
  }
  if (valid.length < 10) return NaN;

  let minV = valid[0], maxV = valid[0];
  for (let i = 1; i < valid.length; i++) {
    if (valid[i] < minV) minV = valid[i];
    if (valid[i] > maxV) maxV = valid[i];
  }
  const range = maxV - minV;
  if (range < 1e-10) return 0;

  const counts = new Array(nBins).fill(0);
  for (let i = 0; i < valid.length; i++) {
    let bin = Math.floor((valid[i] - minV) / (range + 1e-10) * nBins);
    if (bin < 0) bin = 0;
    if (bin >= nBins) bin = nBins - 1;
    counts[bin]++;
  }

  let entropy = 0;
  for (let i = 0; i < nBins; i++) {
    if (counts[i] > 0) {
      const p = counts[i] / valid.length;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

function baselineGazeTransitionEntropy(samples, nBins) {
  // Reference: makowski_features.py:100-110 (group_m_gaze_entropy, transition entropy)
  // Entropy of bin-to-bin transition matrix of eye position.
  // Uses ALL frames with finite eyeXNorm (Python ignores usable flag).
  nBins = nBins || 20;
  const valid = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.eyeXNorm != null && isFinite(s.eyeXNorm)) {
      valid.push(s.eyeXNorm);
    }
  }
  if (valid.length < 10) return NaN;

  let minV = valid[0], maxV = valid[0];
  for (let i = 1; i < valid.length; i++) {
    if (valid[i] < minV) minV = valid[i];
    if (valid[i] > maxV) maxV = valid[i];
  }
  const range = maxV - minV;
  if (range < 1e-10) return 0;

  // Bin each sample
  const binIndices = new Array(valid.length);
  for (let i = 0; i < valid.length; i++) {
    let bin = Math.floor((valid[i] - minV) / (range + 1e-10) * nBins);
    if (bin < 0) bin = 0;
    if (bin >= nBins) bin = nBins - 1;
    binIndices[i] = bin;
  }

  // Build transition matrix: transitions[from][to] = count
  const transitions = [];
  for (let i = 0; i < nBins; i++) {
    transitions.push(new Float64Array(nBins));
  }
  for (let i = 0; i < binIndices.length - 1; i++) {
    transitions[binIndices[i]][binIndices[i + 1]]++;
  }

  // Normalize rows and compute entropy of each row's distribution
  // Then sum all non-zero transition probabilities' entropy contributions
  // (matches Python: trans_probs_flat = trans_probs[trans_probs > 0]; -sum(p * log2(p)))
  let entropy = 0;
  for (let from = 0; from < nBins; from++) {
    let rowSum = 0;
    for (let to = 0; to < nBins; to++) rowSum += transitions[from][to];
    if (rowSum === 0) continue;
    for (let to = 0; to < nBins; to++) {
      const p = transitions[from][to] / rowSum;
      if (p > 0) entropy -= p * Math.log2(p);
    }
  }

  return entropy;
}

function computeBaselineFeatures(samples) {
  // Compute the 3 C2 features from raw samples:
  // saccade_frequency, gaze_entropy, psd_mid
  const saccEvents = detectSaccadeEvents(samples);
  const firstT = samples[0] ? samples[0].t : 0;
  const lastT = samples[samples.length - 1] ? samples[samples.length - 1].t : 0;
  const durationSec = (lastT - firstT) / 1000;

  // psd_mid: Welch PSD of eye velocity in 1-3 Hz band (matches Python training pipeline)
  const eyeXVals = [];
  const tVals = [];
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].eyeXNorm != null && isFinite(samples[i].eyeXNorm)) {
      eyeXVals.push(samples[i].eyeXNorm);
      tVals.push(samples[i].t / 1000); // convert ms to seconds
    }
  }
  let psdMid = NaN;
  if (eyeXVals.length >= 65) {
    // Compute velocity (derivative of position); need >=64 velocity samples to match Python gate
    const vel = [];
    for (let i = 1; i < eyeXVals.length; i++) {
      const dt = tVals[i] - tVals[i - 1];
      vel.push(dt > 0 ? (eyeXVals[i] - eyeXVals[i - 1]) / dt : 0);
    }
    // Estimate sampling rate from median dt
    const dts = [];
    for (let i = 1; i < tVals.length; i++) dts.push(tVals[i] - tVals[i - 1]);
    dts.sort((a, b) => a - b);
    const medianDt = dts[Math.floor(dts.length / 2)];
    const fs = medianDt > 0 ? 1.0 / medianDt : 30;
    const welch = computeBandPowersWelch(vel, fs);
    psdMid = welch.psd_mid;
  }

  const features = {
    gaze_entropy: baselineGazeEntropy(samples),
    gaze_transition_entropy: baselineGazeTransitionEntropy(samples),  // kept for baseline quality gate
    saccade_frequency: durationSec > 0 ? saccEvents.length / durationSec : 0,
    psd_mid: psdMid,
    _saccadeEvents: saccEvents,
    _durationSec: durationSec,
  };
  return features;
}

// --- CatBoost oblivious tree evaluator ---

function evaluateObliviousTree(tree, features) {
  // CatBoost oblivious trees: at each level, same feature+threshold for all nodes.
  // Leaf index = binary number from split decisions.
  let leafIndex = 0;
  for (let level = 0; level < tree.splits.length; level++) {
    const split = tree.splits[level];
    if (features[split.feature_index] > split.threshold) {
      leafIndex |= (1 << level);
    }
  }
  return tree.leaf_values[leafIndex];
}

function predictCatBoostEnsemble(artifact, zFeatures) {
  const scale = typeof artifact.scale === 'number' ? artifact.scale : 1.0;
  const bias = typeof artifact.bias === 'number' ? artifact.bias : 0.0;
  let rawScore = bias;
  for (const tree of artifact.trees) {
    rawScore += scale * evaluateObliviousTree(tree, zFeatures);
  }
  // Sigmoid
  return 1.0 / (1.0 + Math.exp(-rawScore));
}

function predictCatBoostBaseline(samples) {
  // Full pipeline: extract features -> z-score -> classify
  const artifact = classifierArtifact;
  // __BASELINE_FEATURES__ is now an array of session feature objects (1 or more)
  let baselineSessions = (typeof window !== 'undefined') ? window.__BASELINE_FEATURES__ : null;
  if (!artifact || artifact.model_type !== 'catboost_baseline') return null;
  if (!baselineSessions || (!Array.isArray(baselineSessions) && typeof baselineSessions !== 'object')) return null;

  // Legacy support: if it's a single object (not array), wrap it
  if (!Array.isArray(baselineSessions)) {
    baselineSessions = [baselineSessions];
  }
  if (baselineSessions.length === 0) return null;

  return predictCatBoostBaselineWithSessions(artifact, samples, baselineSessions);
}

function predictCatBoostBaselineWithSessions(artifact, samples, baselineSessions) {
  const rawFeatures = computeBaselineFeatures(samples);

  // Check all features are finite
  for (const key of artifact.raw_feature_names) {
    if (!isFinite(rawFeatures[key])) {
      console.warn('predictCatBoostBaseline: NaN feature', key, rawFeatures[key]);
      return null;
    }
  }

  // Z-score against baseline sessions with std floor.
  // Matches normalization.py normalize_std_floor() exactly:
  //   effective_std = max(subject_std, population_std * floor_fraction)
  //   z = (value - subject_mean) / effective_std
  // The floor prevents back-to-back baseline std inflation (tiny std → huge z-scores).
  const floorFraction = artifact.floor_fraction ?? 0.25;
  const popStds = artifact.sober_population_stds || {};
  const zFeatures = [];
  for (const rawName of artifact.raw_feature_names) {
    const testVal = rawFeatures[rawName];
    const baseVals = baselineSessions
      .map(s => s[rawName])
      .filter(v => v != null && isFinite(v));

    if (baseVals.length === 0) {
      console.warn('predictCatBoostBaseline: no valid baseline values for', rawName);
      return null;
    }

    const mean = baseVals.reduce((a, b) => a + b, 0) / baseVals.length;
    const popStd = popStds[rawName];
    const floor = (popStd && isFinite(popStd) && popStd > 0) ? popStd * floorFraction : 0;
    let zsub;

    if (baseVals.length >= 2) {
      // Multi-baseline: std-normalized (ddof=1, matches pandas .std())
      const sumSqDev = baseVals.reduce((a, v) => a + (v - mean) ** 2, 0);
      const subjectStd = Math.sqrt(sumSqDev / (baseVals.length - 1));

      // Apply floor: effective_std = max(subject_std, pop_std * floor_fraction)
      const effectiveStd = Math.max(subjectStd, floor);

      if (effectiveStd > 0 && isFinite(effectiveStd)) {
        zsub = (testVal - mean) / effectiveStd;
      } else {
        zsub = testVal - mean;
      }
    } else {
      // Single baseline: use floor as std if available, else unscaled deviation
      if (floor > 0) {
        zsub = (testVal - mean) / floor;
      } else {
        zsub = testVal - mean;
      }
    }

    // Winsorize to [-10, 10] to match Python training pipeline (winsorize_zsub(clip=10.0))
    zsub = Math.max(-10.0, Math.min(10.0, zsub));
    zFeatures.push(zsub);
  }

  const probability = predictCatBoostEnsemble(artifact, zFeatures);
  const threshold = artifact.optimal_threshold;

  const impaired = probability >= threshold;

  // Log all features dynamically from artifact
  const logFeatures = {};
  for (const name of artifact.raw_feature_names) logFeatures[name] = rawFeatures[name];
  console.log('CatBoost baseline prediction:', {
    rawFeatures: logFeatures,
    nBaselines: baselineSessions.length,
    zMethod: baselineSessions.length >= 2 ? `std-floor (floor=${floorFraction})` : (floor > 0 ? 'single-baseline (pop_std floor)' : 'unscaled deviation'),
    zFeatures,
    probability,
    threshold,
    impaired,
  });

  return {
    probability,
    impaired,
    featureMap: rawFeatures,
    zFeatures,
  };
}

// --- Baseline std quality gate (inference-time) ---
// Checks that baseline sessions have sufficient variance for z-scoring.
// If baselines are too similar (pathological std), z-scores are unreliable.

function checkBaselineStdQuality(baselineSessions, artifact) {
  const gate = artifact.baseline_quality_gate;
  if (!gate) return { pass: true, reason: '' };
  if (!baselineSessions || baselineSessions.length < gate.min_baselines) {
    return { pass: false, reason: 'insufficient_baselines' };
  }
  const p10 = gate.population_p10 || {};
  const n = baselineSessions.length;
  // Small-sample correction: ddof=1 std from 2 samples underestimates true std.
  // c4(N=2) = sqrt(2/pi) ≈ 0.798. We relax the threshold by this factor so
  // legitimate 2-baseline pairs pass while pathological near-identical pairs still fail.
  // For N>=5 the correction is negligible (<5%), so we only apply it for N<5.
  const c4 = n === 2 ? 0.7979 : n === 3 ? 0.8862 : n === 4 ? 0.9213 : 1.0;
  for (const feat of artifact.raw_feature_names) {
    const vals = baselineSessions.map(s => s[feat]).filter(v => v != null && isFinite(v));
    if (vals.length === 0) {
      // Feature absent from all baselines — likely old version sessions. Skip rather than fail.
      console.warn('⚠️ Baseline std gate: feature', feat, 'absent from stored baselines (old version?)');
      continue;
    }
    if (vals.length < 2) return { pass: false, reason: 'missing_feature:' + feat };
    // std with ddof=1 (matches pandas .std())
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, v) => a + (v - m) ** 2, 0) / (vals.length - 1);
    const std = Math.sqrt(variance);
    // Apply small-sample correction: threshold * c4
    const adjustedThreshold = (p10[feat] != null ? p10[feat] : 0) * c4;
    if (p10[feat] != null && std < adjustedThreshold) {
      console.warn('⚠️ Baseline std gate: feature', feat, 'std=', std.toFixed(6), '< adjusted threshold=', adjustedThreshold.toFixed(6), '(c4=', c4.toFixed(4), ', raw p10=', p10[feat].toFixed(6), ')');
      return { pass: false, reason: 'low_variance:' + feat };
    }
  }
  return { pass: true, reason: '' };
}

// --- Baseline Quality Gate ---
// Derived from 84 baseline research sessions (2026-04-05 analysis)
// See analysis_csvs/baseline_forensics/GATE_SPEC.md for rationale
const GATE_SF_FLOOR = 0.10;
const GATE_SF_CEILING = 5.0;
const GATE_GTE_FLOOR = 12.0;
const GATE_GTE_CEILING = 55.0;
const GATE_MIN_SACCADE_COUNT = 2;
const GATE_MIN_DURATION_S = 10.0;
const GATE_CONSISTENCY_SF_MAX_DEV = 6.30;   // 3.0 * SF_IQR (2.10)
const GATE_CONSISTENCY_GTE_MAX_DEV = 32.37; // 3.0 * GTE_IQR (10.79)

const GATE_MESSAGES = {
  sf_low: "Very few eye movements detected. Make sure you're actively following the moving stripes with your eyes.",
  sf_high: "Unusually rapid eye movements detected. Keep your head still and follow the stripes smoothly.",
  gte_low: "Eye movement pattern too uniform. Ensure the stimulus is visible and follow the moving stripes.",
  gte_high: "Eye movement pattern unusually variable. Retry in a well-lit environment with your phone stable.",
  low_saccades: "Too few eye movement resets detected. Position your phone 30-40cm from your face and follow the stripes.",
  short_duration: "Recording was too short. Please complete the full calibration.",
  nan_features: "Could not compute eye tracking features. Retry with better lighting and ensure your face is fully visible.",
  consistency_sf: "Saccade rate differs significantly from your previous baselines. Retry in similar conditions to your earlier recordings.",
  consistency_gte: "Eye pattern differs significantly from your previous baselines. Retry in similar conditions to your earlier recordings.",
};

function runBaselineGateJS(features, priorBaselines) {
  const checks = [];
  const sf = features.saccade_frequency;
  const gte = features.gaze_transition_entropy;

  // Check 1: Feature range
  if (!isFinite(sf) || sf < GATE_SF_FLOOR) {
    checks.push({ name: 'sf_range', pass: false, message: !isFinite(sf) ? GATE_MESSAGES.nan_features : GATE_MESSAGES.sf_low });
  } else if (sf > GATE_SF_CEILING) {
    checks.push({ name: 'sf_range', pass: false, message: GATE_MESSAGES.sf_high });
  } else {
    checks.push({ name: 'sf_range', pass: true, message: '' });
  }

  if (!isFinite(gte) || gte < GATE_GTE_FLOOR) {
    checks.push({ name: 'gte_range', pass: false, message: !isFinite(gte) ? GATE_MESSAGES.nan_features : GATE_MESSAGES.gte_low });
  } else if (gte > GATE_GTE_CEILING) {
    checks.push({ name: 'gte_range', pass: false, message: GATE_MESSAGES.gte_high });
  } else {
    checks.push({ name: 'gte_range', pass: true, message: '' });
  }

  // Check 2: Signal sanity
  var saccadeCount = (features._saccadeEvents || []).length;
  var duration = features._durationSec || 0;

  checks.push({
    name: 'saccade_count',
    pass: saccadeCount >= GATE_MIN_SACCADE_COUNT,
    message: saccadeCount < GATE_MIN_SACCADE_COUNT ? GATE_MESSAGES.low_saccades : '',
  });
  checks.push({
    name: 'duration',
    pass: duration >= GATE_MIN_DURATION_S,
    message: duration < GATE_MIN_DURATION_S ? GATE_MESSAGES.short_duration : '',
  });
  checks.push({
    name: 'finite',
    pass: isFinite(sf) && isFinite(gte),
    message: !(isFinite(sf) && isFinite(gte)) ? GATE_MESSAGES.nan_features : '',
  });

  // Check 3: Consistency (multi-baseline only)
  if (priorBaselines && Array.isArray(priorBaselines) && priorBaselines.length > 0) {
    var priorSfs = priorBaselines.map(function(b) { return b.saccade_frequency; }).filter(isFinite);
    if (priorSfs.length > 0) {
      var meanSf = priorSfs.reduce(function(a, b) { return a + b; }, 0) / priorSfs.length;
      var devSf = Math.abs(sf - meanSf);
      checks.push({
        name: 'consistency_sf',
        pass: devSf <= GATE_CONSISTENCY_SF_MAX_DEV,
        message: devSf > GATE_CONSISTENCY_SF_MAX_DEV ? GATE_MESSAGES.consistency_sf : '',
      });
    }
    var priorGtes = priorBaselines.map(function(b) { return b.gaze_transition_entropy; }).filter(isFinite);
    if (priorGtes.length > 0) {
      var meanGte = priorGtes.reduce(function(a, b) { return a + b; }, 0) / priorGtes.length;
      var devGte = Math.abs(gte - meanGte);
      checks.push({
        name: 'consistency_gte',
        pass: devGte <= GATE_CONSISTENCY_GTE_MAX_DEV,
        message: devGte > GATE_CONSISTENCY_GTE_MAX_DEV ? GATE_MESSAGES.consistency_gte : '',
      });
    }
  }

  var firstFailure = checks.find(function(c) { return !c.pass; });
  return {
    pass: !firstFailure,
    checks: checks,
    message: firstFailure ? firstFailure.message : null,
  };
}

// =====================================================================
// END BASELINE CLASSIFIER
// =====================================================================

let classifierArtifact = null;
let classifierPositiveIndex = 1;
let MODEL_ARTIFACT_URL = 'model_artifact.json';

function sanitizeModelArtifactText(text) {
  // Replace invalid JSON tokens (NaN, Infinity) with null so JSON.parse succeeds
  return text
    .replace(/\bNaN\b/g, 'null')
    .replace(/\b-Infinity\b/g, 'null')
    .replace(/\bInfinity\b/g, 'null');
}

function getModelArtifactUrl() {
  // Always resolve relative to app root so nested routes/capacitor don't break fetching
  try {
    const base = window.location.origin;
    return new URL('model_artifact.json', base).toString();
  } catch (err) {
    console.warn('⚠️ Could not resolve model artifact URL, falling back to relative path.', err);
    return 'model_artifact.json';
  }
}

MODEL_ARTIFACT_URL = getModelArtifactUrl();

const classifierPromise = fetch(MODEL_ARTIFACT_URL)
  .then((response) => {
    if (!response.ok) {
      throw new Error(`Failed to load model_artifact.json: ${response.status}`);
    }
    return response.text();
  })
  .then((rawText) => {
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      console.warn('⚠️ Raw model_artifact.json contains invalid numbers; applying sanitization.');
      const sanitized = sanitizeModelArtifactText(rawText);
      parsed = JSON.parse(sanitized);
    }
    return parsed;
  })
  .then((artifact) => {
    classifierArtifact = artifact;
    // Expose artifact to React layer for baseline std quality gate at collection time
    if (typeof window !== 'undefined') window.__CLASSIFIER_ARTIFACT__ = artifact;
    if (Array.isArray(artifact.class_labels)) {
      const posIdx = artifact.class_labels.indexOf(1);
      classifierPositiveIndex = posIdx >= 0 ? posIdx : artifact.class_labels.length - 1;
    }
    console.log('🤖 OKN classifier loaded', {
      url: MODEL_ARTIFACT_URL,
      nEstimators: artifact.n_estimators,
      features: artifact.feature_names,
      metrics: artifact.training_metrics,
    });
    return classifierArtifact;
  })
  .catch((err) => {
    console.error(`❌ Failed to load classifier artefact from ${MODEL_ARTIFACT_URL}:`, err);
    return null;
  });

// --- Iteration 4: Sliding-window regression for slow-phase detection ---
// Stimulus moves LEFT (drawStimulus uses -stimPhase). Slow phases have negative
// slope (eye tracks leftward stimulus). Saccadic resets are sharp positive jumps.
// We use a sliding window of REGRESSION_WIN frames and look for negative slope
// with R² > threshold. A saccade is detected as a large positive position jump.
const REGRESSION_WIN = 5;         // 5 frames ≈ 167ms at 30 Hz
const REGRESSION_MIN_R2 = 0.80;  // Window-level R² threshold for slow-phase detection
const SACCADE_DROP_NORM = 0.02;  // Negative position change threshold for saccade detection

function windowRegression(samples, startIdx, endIdx) {
  // Linear regression of eyeXNorm vs time for samples[startIdx..endIdx]
  let n = 0, sumT = 0, sumY = 0, sumTT = 0, sumTY = 0;
  const t0 = samples[startIdx].t;
  for (let i = startIdx; i <= endIdx; i++) {
    const s = samples[i];
    if (!s.usable || s.eyeXNorm == null) continue;
    const t = (s.t - t0) / 1000;
    const y = s.eyeXNorm;
    sumT += t; sumY += y; sumTT += t * t; sumTY += t * y;
    n++;
  }
  // Require at least 50% of the window to have usable data (min 3)
  const minUsableInWindow = Math.max(3, Math.ceil((endIdx - startIdx + 1) * 0.5));
  if (n < minUsableInWindow) return null;
  const denom = n * sumTT - sumT * sumT;
  if (Math.abs(denom) < 1e-10) return null;
  const slope = (n * sumTY - sumT * sumY) / denom;
  const meanY = sumY / n;
  let sse = 0, sst = 0;
  const intercept = (sumY - slope * sumT) / n;
  for (let i = startIdx; i <= endIdx; i++) {
    const s = samples[i];
    if (!s.usable || s.eyeXNorm == null) continue;
    const t = (s.t - t0) / 1000;
    const fitted = intercept + slope * t;
    sse += (s.eyeXNorm - fitted) ** 2;
    sst += (s.eyeXNorm - meanY) ** 2;
  }
  const r2 = sst > 1e-10 ? Math.max(0, 1 - sse / sst) : 0;
  return { slope, r2, n };
}

function segmentOKN(samples) {
  // Ensure fps is detected before segmentation
  if (!fpsDetected) detectFpsAndAdapt(samples);

  const regWin = adaptiveRegressionWin; // ~170ms at any fps
  const segments = [];
  const rejectionStats = {
    lowVelocity: 0,
    highVelocity: 0,
    highDeviation: 0,
    highAcceleration: 0,
    unusableSample: 0,
  };

  // Phase 1: Label each sample as "slow-phase candidate" using sliding window regression
  const isSlowPhaseCandidate = new Array(samples.length).fill(false);
  let totalWindows = 0;

  for (let i = 0; i <= samples.length - regWin; i++) {
    const result = windowRegression(samples, i, i + regWin - 1);
    if (!result) continue;
    totalWindows++;
    const { slope: slopeNorm, r2 } = result;

    const canvasWidth = samples[i].canvasWidth || oknWidth || 1;
    const slopePx = slopeNorm * canvasWidth;

    const minVelPx = oknSlowMinV();
    const maxVelPx = oknSlowMaxV();

    if (slopeNorm < 0 && r2 >= REGRESSION_MIN_R2 && Math.abs(slopePx) >= minVelPx && Math.abs(slopePx) <= maxVelPx) {
      for (let j = i; j < i + regWin; j++) {
        isSlowPhaseCandidate[j] = true;
      }
    } else {
      if (slopeNorm >= 0 || Math.abs(slopePx) < minVelPx) rejectionStats.lowVelocity++;
      else if (Math.abs(slopePx) > maxVelPx) rejectionStats.highVelocity++;
      else if (r2 < REGRESSION_MIN_R2) rejectionStats.highDeviation++;
    }
  }

  // Phase 2: Also check for saccades (sharp negative position changes)
  for (let i = 1; i < samples.length; i++) {
    if (!samples[i].usable || samples[i].eyeXNorm == null) continue;
    if (!samples[i-1].usable || samples[i-1].eyeXNorm == null) continue;
    const posChange = samples[i].eyeXNorm - samples[i-1].eyeXNorm;
    // Saccadic reset = large positive jump (eye snaps back against leftward stimulus direction)
    if (posChange > SACCADE_DROP_NORM) {
      isSlowPhaseCandidate[i] = false;
    }
  }

  // Phase 3: Group consecutive slow-phase candidates into segments
  let startIndex = null;
  let lastIndex = null;
  let gapFrames = 0;

  const finalizeSegment = () => {
    if (startIndex === null || lastIndex === null) return;
    const durationMs = samples[lastIndex].t - samples[startIndex].t;
    const sampleCount = lastIndex - startIndex + 1;
    if (durationMs >= OKN_MIN_SEGMENT_MS && sampleCount >= OKN_MIN_SEGMENT_SAMPLES) {
      segments.push({ startIndex, endIndex: lastIndex, durationMs, sampleCount });
    }
    startIndex = null;
    lastIndex = null;
    gapFrames = 0;
  };

  // Bridge over short gaps of BOTH non-candidate and unusable frames.
  // Previously, ANY unusable frame immediately killed the current segment.
  // Now we allow bridging up to adaptiveBridgeFrames of gap.
  for (let i = 0; i < samples.length; i++) {
    if (!samples[i].usable) {
      rejectionStats.unusableSample++;
      if (startIndex !== null) {
        gapFrames++;
        if (gapFrames <= adaptiveBridgeFrames) {
          continue; // bridge over this unusable frame
        }
      }
      finalizeSegment();
      continue;
    }

    if (isSlowPhaseCandidate[i]) {
      if (startIndex === null) {
        startIndex = i;
      }
      lastIndex = i;
      gapFrames = 0;
    } else {
      if (startIndex !== null) {
        gapFrames++;
        if (gapFrames <= adaptiveBridgeFrames) {
          continue;
        }
      }
      finalizeSegment();
    }
  }

  finalizeSegment();
  return { segments, rejectionStats, totalWindows };
}

})(); // End IIFE