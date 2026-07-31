/**
 * Baseline Quality Gate — rejects bad sober baselines at recording time.
 *
 * Derived from forensic analysis of 84 sober sessions (2026-04-05).
 * See analysis_csvs/baseline_forensics/GATE_SPEC.md for full rationale.
 *
 * All functions are pure — no DOM, no side effects, no I/O.
 */

// ---------------------------------------------------------------------------
// Constants — from GATE_SPEC.md
// ---------------------------------------------------------------------------

export const GATE_SF_FLOOR = 0.10;
export const GATE_SF_CEILING = 5.0;
export const GATE_GTE_FLOOR = 12.0;
export const GATE_GTE_CEILING = 55.0;
export const GATE_MIN_SACCADE_COUNT = 2;
export const GATE_MIN_DURATION_S = 10.0;
export const GATE_CONSISTENCY_SF_MAX_DEV = 6.30;   // 3.0 * SF_IQR (2.10)
export const GATE_CONSISTENCY_GTE_MAX_DEV = 32.37;  // 3.0 * GTE_IQR (10.79)

/** Baseline version — bump this to invalidate all prior baselines. */
export const BASELINE_VERSION = 5;

export const GATE_MESSAGES: Record<string, string> = {
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GateCheck {
  name: string;
  pass: boolean;
  value: number;
  threshold: number;
  direction: 'low' | 'high' | 'ok';
  message: string;
}

export interface GateResult {
  pass: boolean;
  checks: GateCheck[];
  message: string | null;
}

export interface BaselineFeatures {
  gaze_transition_entropy: number;
  saccade_frequency: number;
  _saccadeEvents?: unknown[];
  _durationSec?: number;
}

/** ML features stored per baseline session (v6: gaze_entropy + saccade_frequency + psd_mid) */
export interface BaselineMLSession {
  gaze_entropy: number;
  saccade_frequency: number;
  psd_mid: number;
  _version?: number;
  [key: string]: number | undefined;
}

/** Config from model_artifact.json baseline_quality_gate */
export interface StdGateConfig {
  min_baselines: number;
  population_p10: Record<string, number>;
}

/** Result from checkBaselineStdQuality */
export interface StdGateResult {
  pass: boolean;
  reason: string;
  message: string | null;
}

// ---------------------------------------------------------------------------
// Check 1: Feature Range
// ---------------------------------------------------------------------------

export function checkFeatureRange(features: BaselineFeatures): GateCheck[] {
  const checks: GateCheck[] = [];
  const sf = features.saccade_frequency;
  const gte = features.gaze_transition_entropy;

  // SF range
  if (!isFinite(sf)) {
    checks.push({ name: 'sf_range', pass: false, value: NaN, threshold: GATE_SF_FLOOR, direction: 'low', message: GATE_MESSAGES.nan_features });
  } else if (sf < GATE_SF_FLOOR) {
    checks.push({ name: 'sf_range', pass: false, value: sf, threshold: GATE_SF_FLOOR, direction: 'low', message: GATE_MESSAGES.sf_low });
  } else if (sf > GATE_SF_CEILING) {
    checks.push({ name: 'sf_range', pass: false, value: sf, threshold: GATE_SF_CEILING, direction: 'high', message: GATE_MESSAGES.sf_high });
  } else {
    checks.push({ name: 'sf_range', pass: true, value: sf, threshold: GATE_SF_FLOOR, direction: 'ok', message: '' });
  }

  // GTE range
  if (!isFinite(gte)) {
    checks.push({ name: 'gte_range', pass: false, value: NaN, threshold: GATE_GTE_FLOOR, direction: 'low', message: GATE_MESSAGES.nan_features });
  } else if (gte < GATE_GTE_FLOOR) {
    checks.push({ name: 'gte_range', pass: false, value: gte, threshold: GATE_GTE_FLOOR, direction: 'low', message: GATE_MESSAGES.gte_low });
  } else if (gte > GATE_GTE_CEILING) {
    checks.push({ name: 'gte_range', pass: false, value: gte, threshold: GATE_GTE_CEILING, direction: 'high', message: GATE_MESSAGES.gte_high });
  } else {
    checks.push({ name: 'gte_range', pass: true, value: gte, threshold: GATE_GTE_FLOOR, direction: 'ok', message: '' });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Check 2: Signal Sanity
// ---------------------------------------------------------------------------

export function checkSignalSanity(features: BaselineFeatures): GateCheck[] {
  const checks: GateCheck[] = [];
  const saccadeCount = features._saccadeEvents?.length ?? 0;
  const duration = features._durationSec ?? 0;
  const sf = features.saccade_frequency;
  const gte = features.gaze_transition_entropy;

  // Saccade count
  checks.push({
    name: 'saccade_count',
    pass: saccadeCount >= GATE_MIN_SACCADE_COUNT,
    value: saccadeCount,
    threshold: GATE_MIN_SACCADE_COUNT,
    direction: saccadeCount >= GATE_MIN_SACCADE_COUNT ? 'ok' : 'low',
    message: saccadeCount < GATE_MIN_SACCADE_COUNT ? GATE_MESSAGES.low_saccades : '',
  });

  // Duration
  checks.push({
    name: 'duration',
    pass: duration >= GATE_MIN_DURATION_S,
    value: duration,
    threshold: GATE_MIN_DURATION_S,
    direction: duration >= GATE_MIN_DURATION_S ? 'ok' : 'low',
    message: duration < GATE_MIN_DURATION_S ? GATE_MESSAGES.short_duration : '',
  });

  // Features finite
  const bothFinite = isFinite(sf) && isFinite(gte);
  checks.push({
    name: 'finite',
    pass: bothFinite,
    value: bothFinite ? 1 : 0,
    threshold: 1,
    direction: bothFinite ? 'ok' : 'low',
    message: bothFinite ? '' : GATE_MESSAGES.nan_features,
  });

  return checks;
}

// ---------------------------------------------------------------------------
// Check 3: Consistency (multi-baseline only)
// ---------------------------------------------------------------------------

export function checkConsistency(
  features: BaselineFeatures,
  priorBaselines: BaselineFeatures[] | null,
): GateCheck[] {
  if (!priorBaselines || priorBaselines.length === 0) {
    return [];
  }

  const checks: GateCheck[] = [];

  // Mean of prior SF values
  const priorSfs = priorBaselines.map(b => b.saccade_frequency).filter(v => isFinite(v));
  if (priorSfs.length > 0) {
    const meanSf = priorSfs.reduce((a, b) => a + b, 0) / priorSfs.length;
    const devSf = Math.abs(features.saccade_frequency - meanSf);
    checks.push({
      name: 'consistency_sf',
      pass: devSf <= GATE_CONSISTENCY_SF_MAX_DEV,
      value: devSf,
      threshold: GATE_CONSISTENCY_SF_MAX_DEV,
      direction: devSf <= GATE_CONSISTENCY_SF_MAX_DEV ? 'ok' : 'high',
      message: devSf > GATE_CONSISTENCY_SF_MAX_DEV ? GATE_MESSAGES.consistency_sf : '',
    });
  }

  // Mean of prior GTE values
  const priorGtes = priorBaselines.map(b => b.gaze_transition_entropy).filter(v => isFinite(v));
  if (priorGtes.length > 0) {
    const meanGte = priorGtes.reduce((a, b) => a + b, 0) / priorGtes.length;
    const devGte = Math.abs(features.gaze_transition_entropy - meanGte);
    checks.push({
      name: 'consistency_gte',
      pass: devGte <= GATE_CONSISTENCY_GTE_MAX_DEV,
      value: devGte,
      threshold: GATE_CONSISTENCY_GTE_MAX_DEV,
      direction: devGte <= GATE_CONSISTENCY_GTE_MAX_DEV ? 'ok' : 'high',
      message: devGte > GATE_CONSISTENCY_GTE_MAX_DEV ? GATE_MESSAGES.consistency_gte : '',
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Main gate — runs all checks, returns first failure message
// ---------------------------------------------------------------------------

export function runBaselineGate(
  features: BaselineFeatures,
  priorBaselines?: BaselineFeatures[] | null,
): GateResult {
  const checks = [
    ...checkFeatureRange(features),
    ...checkSignalSanity(features),
    ...checkConsistency(features, priorBaselines ?? null),
  ];

  const firstFailure = checks.find(c => !c.pass);
  return {
    pass: !firstFailure,
    checks,
    message: firstFailure?.message ?? null,
  };
}

// ---------------------------------------------------------------------------
// Check 4: Baseline Std Quality (z-scoring readiness)
// ---------------------------------------------------------------------------
// Mirrors app.js checkBaselineStdQuality — validates that baseline sessions
// have enough variance for reliable z-score normalization.
// Must run at baseline COLLECTION time (not just test time) to give the user
// immediate feedback to redo if their baselines are too similar.

const STD_GATE_C4: Record<number, number> = { 2: 0.7979, 3: 0.8862, 4: 0.9213 };

export function checkBaselineStdQuality(
  sessions: BaselineMLSession[],
  featureNames: string[],
  config: StdGateConfig | null,
): StdGateResult {
  if (!config) return { pass: true, reason: '', message: null };

  if (!sessions || sessions.length < config.min_baselines) {
    return { pass: false, reason: 'insufficient_baselines', message: 'Need at least two calibration tests to establish a reliable baseline.' };
  }

  const n = sessions.length;
  const c4 = STD_GATE_C4[n] ?? 1.0;
  const p10 = config.population_p10 || {};

  for (const feat of featureNames) {
    const vals = sessions
      .map(s => s[feat])
      .filter((v): v is number => v != null && isFinite(v as number)) as number[];

    if (vals.length === 0) {
      // Feature absent from all sessions (old version) — skip
      continue;
    }
    if (vals.length < 2) {
      return { pass: false, reason: 'missing_feature:' + feat, message: 'One of your calibration tests had missing data. Please redo calibration.' };
    }

    // std with ddof=1 (matches pandas .std())
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / (vals.length - 1);
    const std = Math.sqrt(variance);

    const adjustedThreshold = (p10[feat] != null ? p10[feat] : 0) * c4;
    if (p10[feat] != null && std < adjustedThreshold) {
      return {
        pass: false,
        reason: 'low_variance:' + feat,
        message: 'Your two calibration tests were too similar. Please redo calibration — try to relax and blink naturally. Small differences between tests help establish your personal range.',
      };
    }
  }

  return { pass: true, reason: '', message: null };
}
