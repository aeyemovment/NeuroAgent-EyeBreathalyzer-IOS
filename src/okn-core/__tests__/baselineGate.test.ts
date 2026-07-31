import { describe, it, expect } from 'vitest';
import {
  runBaselineGate,
  checkFeatureRange,
  checkSignalSanity,
  checkConsistency,
  GATE_SF_FLOOR,
  GATE_SF_CEILING,
  GATE_GTE_FLOOR,
  GATE_GTE_CEILING,
  GATE_MIN_SACCADE_COUNT,
  GATE_MIN_DURATION_S,
  GATE_CONSISTENCY_SF_MAX_DEV,
  GATE_CONSISTENCY_GTE_MAX_DEV,
  BASELINE_VERSION,
  type BaselineFeatures,
  type GateResult,
} from '../baselineGate';

// Helper: normal baseline at population medians
function normalBaseline(overrides?: Partial<BaselineFeatures>): BaselineFeatures {
  return {
    gaze_transition_entropy: 33.42,
    saccade_frequency: 1.73,
    _saccadeEvents: new Array(10),
    _durationSec: 15,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Feature range checks
// ---------------------------------------------------------------------------

describe('checkFeatureRange', () => {
  it('passes normal baseline (population medians)', () => {
    const checks = checkFeatureRange(normalBaseline());
    expect(checks.every(c => c.pass)).toBe(true);
  });

  it('rejects vrshank sf=0.067 (below floor)', () => {
    const checks = checkFeatureRange(normalBaseline({ saccade_frequency: 0.067 }));
    const sfCheck = checks.find(c => c.name === 'sf_range')!;
    expect(sfCheck.pass).toBe(false);
    expect(sfCheck.direction).toBe('low');
  });

  it('passes kemar high sf=4.536 (below ceiling)', () => {
    const checks = checkFeatureRange(normalBaseline({ saccade_frequency: 4.536 }));
    const sfCheck = checks.find(c => c.name === 'sf_range')!;
    expect(sfCheck.pass).toBe(true);
  });

  it('rejects sf above ceiling', () => {
    const checks = checkFeatureRange(normalBaseline({ saccade_frequency: 5.5 }));
    const sfCheck = checks.find(c => c.name === 'sf_range')!;
    expect(sfCheck.pass).toBe(false);
    expect(sfCheck.direction).toBe('high');
  });

  it('passes kemar low gte=14.67 (above floor)', () => {
    const checks = checkFeatureRange(normalBaseline({ gaze_transition_entropy: 14.67 }));
    const gteCheck = checks.find(c => c.name === 'gte_range')!;
    expect(gteCheck.pass).toBe(true);
  });

  it('rejects gte below floor', () => {
    const checks = checkFeatureRange(normalBaseline({ gaze_transition_entropy: 10.0 }));
    const gteCheck = checks.find(c => c.name === 'gte_range')!;
    expect(gteCheck.pass).toBe(false);
    expect(gteCheck.direction).toBe('low');
  });

  it('rejects gte above ceiling', () => {
    const checks = checkFeatureRange(normalBaseline({ gaze_transition_entropy: 60.0 }));
    const gteCheck = checks.find(c => c.name === 'gte_range')!;
    expect(gteCheck.pass).toBe(false);
    expect(gteCheck.direction).toBe('high');
  });

  it('rejects NaN saccade_frequency', () => {
    const checks = checkFeatureRange(normalBaseline({ saccade_frequency: NaN }));
    const sfCheck = checks.find(c => c.name === 'sf_range')!;
    expect(sfCheck.pass).toBe(false);
  });

  it('rejects NaN gaze_transition_entropy', () => {
    const checks = checkFeatureRange(normalBaseline({ gaze_transition_entropy: NaN }));
    const gteCheck = checks.find(c => c.name === 'gte_range')!;
    expect(gteCheck.pass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Signal sanity checks
// ---------------------------------------------------------------------------

describe('checkSignalSanity', () => {
  it('passes normal recording', () => {
    const checks = checkSignalSanity(normalBaseline());
    expect(checks.every(c => c.pass)).toBe(true);
  });

  it('rejects low saccade count (1 event)', () => {
    const checks = checkSignalSanity(normalBaseline({ _saccadeEvents: [1] }));
    const c = checks.find(c => c.name === 'saccade_count')!;
    expect(c.pass).toBe(false);
  });

  it('passes exactly 2 saccades', () => {
    const checks = checkSignalSanity(normalBaseline({ _saccadeEvents: [1, 2] }));
    const c = checks.find(c => c.name === 'saccade_count')!;
    expect(c.pass).toBe(true);
  });

  it('rejects short duration (5 seconds)', () => {
    const checks = checkSignalSanity(normalBaseline({ _durationSec: 5 }));
    const c = checks.find(c => c.name === 'duration')!;
    expect(c.pass).toBe(false);
  });

  it('passes exactly 10 seconds', () => {
    const checks = checkSignalSanity(normalBaseline({ _durationSec: 10 }));
    const c = checks.find(c => c.name === 'duration')!;
    expect(c.pass).toBe(true);
  });

  it('rejects NaN features', () => {
    const checks = checkSignalSanity(normalBaseline({ saccade_frequency: NaN }));
    const c = checks.find(c => c.name === 'finite')!;
    expect(c.pass).toBe(false);
  });

  it('rejects Infinity features', () => {
    const checks = checkSignalSanity(normalBaseline({ gaze_transition_entropy: Infinity }));
    const c = checks.find(c => c.name === 'finite')!;
    expect(c.pass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Consistency checks
// ---------------------------------------------------------------------------

describe('checkConsistency', () => {
  it('skipped when no prior baselines (first baseline)', () => {
    const checks = checkConsistency(normalBaseline(), null);
    expect(checks).toHaveLength(0);
  });

  it('skipped when prior baselines array is empty', () => {
    const checks = checkConsistency(normalBaseline(), []);
    expect(checks).toHaveLength(0);
  });

  it('passes when new baseline is similar to prior', () => {
    const prior = normalBaseline({ saccade_frequency: 1.7, gaze_transition_entropy: 33.0 });
    const current = normalBaseline({ saccade_frequency: 1.5, gaze_transition_entropy: 34.0 });
    const checks = checkConsistency(current, [prior]);
    expect(checks.every(c => c.pass)).toBe(true);
  });

  it('fails when sf deviates extremely from prior', () => {
    const prior = normalBaseline({ saccade_frequency: 1.7 });
    const current = normalBaseline({ saccade_frequency: 8.5 });
    const checks = checkConsistency(current, [prior]);
    const sfCheck = checks.find(c => c.name === 'consistency_sf')!;
    expect(sfCheck.pass).toBe(false);
  });

  it('fails when gte deviates extremely from prior', () => {
    const prior = normalBaseline({ gaze_transition_entropy: 20.0 });
    const current = normalBaseline({ gaze_transition_entropy: 55.0 });
    const checks = checkConsistency(current, [prior]);
    const gteCheck = checks.find(c => c.name === 'consistency_gte')!;
    expect(gteCheck.pass).toBe(false);
  });

  it('uses mean of multiple priors', () => {
    const prior1 = normalBaseline({ saccade_frequency: 1.5 });
    const prior2 = normalBaseline({ saccade_frequency: 2.5 });
    // mean = 2.0, new = 2.3, dev = 0.3 — well within 6.30
    const current = normalBaseline({ saccade_frequency: 2.3 });
    const checks = checkConsistency(current, [prior1, prior2]);
    const sfCheck = checks.find(c => c.name === 'consistency_sf')!;
    expect(sfCheck.pass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runBaselineGate — integration
// ---------------------------------------------------------------------------

describe('runBaselineGate', () => {
  it('normal baseline passes all checks', () => {
    const result = runBaselineGate(normalBaseline());
    expect(result.pass).toBe(true);
    expect(result.message).toBeNull();
  });

  it('vrshank sf=0.067 rejected', () => {
    const result = runBaselineGate(normalBaseline({ saccade_frequency: 0.067 }));
    expect(result.pass).toBe(false);
    expect(result.message).toContain('eye movements');
  });

  it('returns first failure message', () => {
    // Both sf and gte bad — should get sf message (first check)
    const result = runBaselineGate(normalBaseline({
      saccade_frequency: 0.01,
      gaze_transition_entropy: 5.0,
    }));
    expect(result.pass).toBe(false);
    expect(result.message).toBe(result.checks.find(c => !c.pass)!.message);
  });

  it('gate result has correct schema', () => {
    const result = runBaselineGate(normalBaseline());
    expect(result).toHaveProperty('pass');
    expect(result).toHaveProperty('checks');
    expect(result).toHaveProperty('message');
    expect(Array.isArray(result.checks)).toBe(true);
    for (const check of result.checks) {
      expect(check).toHaveProperty('name');
      expect(check).toHaveProperty('pass');
      expect(check).toHaveProperty('value');
      expect(check).toHaveProperty('threshold');
      expect(check).toHaveProperty('direction');
      expect(check).toHaveProperty('message');
      expect(['low', 'high', 'ok']).toContain(check.direction);
    }
  });

  it('pure function — same input always same output', () => {
    const features = normalBaseline();
    const r1 = runBaselineGate(features);
    const r2 = runBaselineGate(features);
    expect(r1).toEqual(r2);
  });

  it('includes consistency checks when priors provided', () => {
    const prior = normalBaseline();
    const result = runBaselineGate(normalBaseline(), [prior]);
    const consistencyChecks = result.checks.filter(c => c.name.startsWith('consistency_'));
    expect(consistencyChecks.length).toBe(2);
  });

  it('omits consistency checks when no priors', () => {
    const result = runBaselineGate(normalBaseline(), null);
    const consistencyChecks = result.checks.filter(c => c.name.startsWith('consistency_'));
    expect(consistencyChecks.length).toBe(0);
  });

  it('edge: sf exactly at floor passes', () => {
    const result = runBaselineGate(normalBaseline({ saccade_frequency: GATE_SF_FLOOR }));
    const sfCheck = result.checks.find(c => c.name === 'sf_range')!;
    expect(sfCheck.pass).toBe(true);
  });

  it('edge: sf exactly at ceiling passes', () => {
    const result = runBaselineGate(normalBaseline({ saccade_frequency: GATE_SF_CEILING }));
    const sfCheck = result.checks.find(c => c.name === 'sf_range')!;
    expect(sfCheck.pass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Version constant
// ---------------------------------------------------------------------------

describe('BASELINE_VERSION', () => {
  it('is 5 (forces re-baseline for gate-validated data)', () => {
    expect(BASELINE_VERSION).toBe(5);
  });
});
