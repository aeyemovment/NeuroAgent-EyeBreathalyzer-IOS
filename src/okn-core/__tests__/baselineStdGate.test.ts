import { describe, it, expect } from 'vitest';
import {
  checkBaselineStdQuality,
  type BaselineMLSession,
  type StdGateConfig,
} from '../baselineGate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default population p10 thresholds from model_artifact.json */
const DEFAULT_CONFIG: StdGateConfig = {
  min_baselines: 2,
  population_p10: {
    saccade_frequency: 0.047102611270316404,
    gaze_entropy: 0.0890453192160486,
    psd_mid: 0.0024403931749494264,
  },
};

/** Feature names in the order used by the model */
const FEATURE_NAMES = ['saccade_frequency', 'gaze_entropy', 'psd_mid'];

/** A pair of baselines with good variance (well above p10 thresholds) */
function normalPair(): BaselineMLSession[] {
  return [
    { gaze_entropy: 3.5, saccade_frequency: 1.5, psd_mid: 0.04 },
    { gaze_entropy: 4.2, saccade_frequency: 2.8, psd_mid: 0.08 },
  ];
}

// ---------------------------------------------------------------------------
// checkBaselineStdQuality
// ---------------------------------------------------------------------------

describe('checkBaselineStdQuality', () => {
  // --- Pass cases ---

  it('passes with baselines that have sufficient variance', () => {
    const result = checkBaselineStdQuality(normalPair(), FEATURE_NAMES, DEFAULT_CONFIG);
    expect(result.pass).toBe(true);
    expect(result.reason).toBe('');
  });

  it('passes when std is just above the c4-adjusted threshold', () => {
    // For n=2, c4=0.7979. gaze_entropy p10=0.0890, adjusted=0.07103
    // Need std > 0.07103. Use d=0.0510 → std(ddof=1) = sqrt(2*d^2) = 0.0721 > 0.0710
    const mid = 3.5;
    const d = 0.0510;
    const pair: BaselineMLSession[] = [
      { gaze_entropy: mid - d, saccade_frequency: 2.0, psd_mid: 0.05 },
      { gaze_entropy: mid + d, saccade_frequency: 3.0, psd_mid: 0.09 },
    ];
    const result = checkBaselineStdQuality(pair, FEATURE_NAMES, DEFAULT_CONFIG);
    expect(result.pass).toBe(true);
  });

  it('passes with 3 baselines (less aggressive c4 correction)', () => {
    // c4(3) = 0.8862 → threshold is relaxed less
    const sessions: BaselineMLSession[] = [
      { gaze_entropy: 3.4, saccade_frequency: 1.5, psd_mid: 0.04 },
      { gaze_entropy: 3.6, saccade_frequency: 2.0, psd_mid: 0.06 },
      { gaze_entropy: 3.8, saccade_frequency: 2.5, psd_mid: 0.08 },
    ];
    const result = checkBaselineStdQuality(sessions, FEATURE_NAMES, DEFAULT_CONFIG);
    expect(result.pass).toBe(true);
  });

  // --- Fail cases ---

  it('fails for Kemar scenario: gaze_entropy too similar (std=0.035 < threshold=0.071)', () => {
    const kemarBaselines: BaselineMLSession[] = [
      { gaze_entropy: 3.7247, saccade_frequency: 4.338, psd_mid: 0.03748 },
      { gaze_entropy: 3.7745, saccade_frequency: 4.664, psd_mid: 0.04818 },
    ];
    const result = checkBaselineStdQuality(kemarBaselines, FEATURE_NAMES, DEFAULT_CONFIG);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('low_variance:gaze_entropy');
  });

  it('fails with insufficient baselines (1 session)', () => {
    const single: BaselineMLSession[] = [
      { gaze_entropy: 3.5, saccade_frequency: 1.5, psd_mid: 0.04 },
    ];
    const result = checkBaselineStdQuality(single, FEATURE_NAMES, DEFAULT_CONFIG);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('insufficient_baselines');
  });

  it('fails with empty baselines array', () => {
    const result = checkBaselineStdQuality([], FEATURE_NAMES, DEFAULT_CONFIG);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('insufficient_baselines');
  });

  it('fails with identical baselines (zero variance)', () => {
    const identical: BaselineMLSession[] = [
      { gaze_entropy: 3.5, saccade_frequency: 1.5, psd_mid: 0.04 },
      { gaze_entropy: 3.5, saccade_frequency: 1.5, psd_mid: 0.04 },
    ];
    const result = checkBaselineStdQuality(identical, FEATURE_NAMES, DEFAULT_CONFIG);
    expect(result.pass).toBe(false);
    // Should fail on the first feature checked
    expect(result.reason).toMatch(/^low_variance:/);
  });

  // --- Edge cases ---

  it('skips feature absent from all sessions (old version baselines)', () => {
    // Sessions missing psd_mid entirely — should skip that feature, not fail
    const pair: BaselineMLSession[] = [
      { gaze_entropy: 3.5, saccade_frequency: 1.5 } as BaselineMLSession,
      { gaze_entropy: 4.2, saccade_frequency: 2.8 } as BaselineMLSession,
    ];
    const result = checkBaselineStdQuality(pair, FEATURE_NAMES, DEFAULT_CONFIG);
    expect(result.pass).toBe(true);
  });

  it('fails when feature present in only 1 of 2 sessions', () => {
    const pair: BaselineMLSession[] = [
      { gaze_entropy: 3.5, saccade_frequency: 1.5, psd_mid: 0.04 },
      { gaze_entropy: 4.2, saccade_frequency: 2.8 } as BaselineMLSession,
    ];
    const result = checkBaselineStdQuality(pair, FEATURE_NAMES, DEFAULT_CONFIG);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('missing_feature:psd_mid');
  });

  it('skips feature with NaN in all sessions', () => {
    const pair: BaselineMLSession[] = [
      { gaze_entropy: 3.5, saccade_frequency: 1.5, psd_mid: NaN },
      { gaze_entropy: 4.2, saccade_frequency: 2.8, psd_mid: NaN },
    ];
    const result = checkBaselineStdQuality(pair, FEATURE_NAMES, DEFAULT_CONFIG);
    // NaN filtered out → 0 valid values → skip (same as absent)
    expect(result.pass).toBe(true);
  });

  it('returns pass when no quality gate config provided', () => {
    const result = checkBaselineStdQuality(normalPair(), FEATURE_NAMES, null as any);
    expect(result.pass).toBe(true);
  });

  it('returns user-facing message for low variance failure', () => {
    const kemarBaselines: BaselineMLSession[] = [
      { gaze_entropy: 3.7247, saccade_frequency: 4.338, psd_mid: 0.03748 },
      { gaze_entropy: 3.7745, saccade_frequency: 4.664, psd_mid: 0.04818 },
    ];
    const result = checkBaselineStdQuality(kemarBaselines, FEATURE_NAMES, DEFAULT_CONFIG);
    expect(result.pass).toBe(false);
    expect(result.message).toBeTruthy();
    expect(typeof result.message).toBe('string');
    // Should be a user-friendly message, not a technical error code
    expect(result.message!.length).toBeGreaterThan(20);
  });

  // --- Purity ---

  it('is a pure function — same input always same output', () => {
    const pair = normalPair();
    const r1 = checkBaselineStdQuality(pair, FEATURE_NAMES, DEFAULT_CONFIG);
    const r2 = checkBaselineStdQuality(pair, FEATURE_NAMES, DEFAULT_CONFIG);
    expect(r1).toEqual(r2);
  });
});
