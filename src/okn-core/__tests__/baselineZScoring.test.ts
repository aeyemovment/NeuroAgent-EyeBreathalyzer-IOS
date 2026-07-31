import { describe, it, expect } from 'vitest'

function computeZScores(
  testFeatures: Record<string, number>,
  baselineSessions: Array<Record<string, number>>,
  featureNames: string[],
  populationStds?: Record<string, number>,
  floorFraction = 0.25,
): number[] {
  const n = baselineSessions.length
  if (n === 0) throw new Error('No baseline sessions')
  return featureNames.map(feat => {
    const baseVals = baselineSessions.map(s => s[feat]).filter(v => v != null && isFinite(v))
    if (baseVals.length === 0) return NaN
    const mean = baseVals.reduce((a, b) => a + b, 0) / baseVals.length
    const popStd = populationStds?.[feat]
    const floor = (popStd && isFinite(popStd) && popStd > 0) ? popStd * floorFraction : 0
    if (baseVals.length >= 2) {
      const sumSqDev = baseVals.reduce((a, v) => a + (v - mean) ** 2, 0)
      const subjectStd = Math.sqrt(sumSqDev / (baseVals.length - 1))
      const effectiveStd = Math.max(subjectStd, floor)
      if (effectiveStd > 0 && isFinite(effectiveStd)) return (testFeatures[feat] - mean) / effectiveStd
      return testFeatures[feat] - mean
    }
    if (floor > 0) return (testFeatures[feat] - mean) / floor
    return testFeatures[feat] - mean
  })
}

function winsorize(z: number, clip = 10.0): number {
  return Math.max(-clip, Math.min(clip, z))
}

const FEATURE_NAMES = ['gaze_transition_entropy', 'saccade_frequency'] as const
const POP_STDS = { gaze_transition_entropy: 6.363, saccade_frequency: 1.100 }

describe('multi-baseline z-scoring with std floor', () => {
  const sober1 = { gaze_transition_entropy: 30.17, saccade_frequency: 2.94 }
  const sober2 = { gaze_transition_entropy: 30.17, saccade_frequency: 2.73 }
  const drunk  = { gaze_transition_entropy: 25.94, saccade_frequency: 3.47 }

  describe('with 2 baselines (good spread)', () => {
    it('computes bounded sober z-scores', () => {
      const z = computeZScores(sober1, [sober1, sober2], [...FEATURE_NAMES], POP_STDS)
      for (const v of z) expect(Math.abs(v)).toBeLessThan(3.0)
    })
    it('uses ddof=1 std when above floor', () => {
      const meanSf = (sober1.saccade_frequency + sober2.saccade_frequency) / 2
      const stdSf = Math.abs(sober1.saccade_frequency - sober2.saccade_frequency) / Math.sqrt(2)
      // stdSf ≈ 0.148, floor = 1.100 * 0.25 = 0.275 → floor kicks in
      const z = computeZScores(drunk, [sober1, sober2], [...FEATURE_NAMES], POP_STDS)
      const expectedZ = (drunk.saccade_frequency - meanSf) / Math.max(stdSf, 1.100 * 0.25)
      expect(z[1]).toBeCloseTo(expectedZ, 6)
    })
    it('drunk produces non-zero z-scores', () => {
      const z = computeZScores(drunk, [sober1, sober2], [...FEATURE_NAMES], POP_STDS)
      expect(Math.max(...z.map(Math.abs))).toBeGreaterThan(0.5)
    })
  })

  describe('std floor behavior', () => {
    it('floor kicks in when subject std is tiny', () => {
      // Two near-identical baselines: std ≈ 0
      const tight1 = { gaze_transition_entropy: 30.10, saccade_frequency: 1.60 }
      const tight2 = { gaze_transition_entropy: 30.15, saccade_frequency: 1.61 }
      const test = { gaze_transition_entropy: 28.0, saccade_frequency: 1.3 }

      const zNoFloor = computeZScores(test, [tight1, tight2], [...FEATURE_NAMES])
      const zWithFloor = computeZScores(test, [tight1, tight2], [...FEATURE_NAMES], POP_STDS)

      // Without floor: GTE std ≈ 0.035 → z ≈ -60. With floor: bounded.
      expect(Math.abs(zNoFloor[0])).toBeGreaterThan(10)
      expect(Math.abs(zWithFloor[0])).toBeLessThan(5)
    })
    it('floor does not affect subjects with good spread', () => {
      const wide1 = { gaze_transition_entropy: 20.0, saccade_frequency: 1.0 }
      const wide2 = { gaze_transition_entropy: 30.0, saccade_frequency: 2.0 }
      const test = { gaze_transition_entropy: 25.0, saccade_frequency: 1.5 }

      const zNoFloor = computeZScores(test, [wide1, wide2], [...FEATURE_NAMES])
      const zWithFloor = computeZScores(test, [wide1, wide2], [...FEATURE_NAMES], POP_STDS)

      // Subject std (7.07 for GTE) > floor (1.59) → same result
      expect(zWithFloor[0]).toBeCloseTo(zNoFloor[0], 6)
    })
  })

  describe('with 1 baseline session', () => {
    it('uses floor as std when available', () => {
      const z = computeZScores(sober2, [sober1], [...FEATURE_NAMES], POP_STDS)
      const expectedGte = (sober2.gaze_transition_entropy - sober1.gaze_transition_entropy) / (6.363 * 0.25)
      expect(z[0]).toBeCloseTo(expectedGte, 4)
    })
    it('uses unscaled deviation when no pop stds', () => {
      const z = computeZScores(sober2, [sober1], [...FEATURE_NAMES])
      expect(z[1]).toBeCloseTo(sober2.saccade_frequency - sober1.saccade_frequency, 6)
    })
  })

  describe('edge cases', () => {
    it('handles zero std with floor', () => {
      const z = computeZScores(drunk, [sober1, sober1], [...FEATURE_NAMES], POP_STDS)
      // Zero subject std → floor kicks in
      const floor = 6.363 * 0.25
      const expectedGte = (drunk.gaze_transition_entropy - sober1.gaze_transition_entropy) / floor
      expect(z[0]).toBeCloseTo(expectedGte, 4)
    })
    it('NaN propagates', () => {
      const z = computeZScores({ gaze_transition_entropy: NaN, saccade_frequency: 2.0 }, [sober1, sober2], [...FEATURE_NAMES], POP_STDS)
      expect(isNaN(z[0])).toBe(true)
      expect(isFinite(z[1])).toBe(true)
    })
  })

  describe('winsorization', () => {
    it('clips to [-10, 10]', () => {
      expect(winsorize(15)).toBe(10)
      expect(winsorize(-15)).toBe(-10)
      expect(winsorize(5)).toBe(5)
    })
  })
})
