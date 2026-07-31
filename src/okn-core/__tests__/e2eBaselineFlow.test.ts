import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const artifactPath = resolve(__dirname, '../../../public/model_artifact.json')
const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))

function evaluateObliviousTree(tree: any, features: number[]): number {
  let leafIndex = 0
  for (let level = 0; level < tree.splits.length; level++) {
    const split = tree.splits[level]
    if (features[split.feature_index] > split.threshold) {
      leafIndex |= (1 << level)
    }
  }
  return tree.leaf_values[leafIndex]
}

function predictEnsemble(trees: any[], features: number[], scale: number, bias: number): number {
  let rawScore = bias
  for (const tree of trees) {
    rawScore += scale * evaluateObliviousTree(tree, features)
  }
  return 1.0 / (1.0 + Math.exp(-rawScore))
}

function computeZScoresWithFloor(
  testFeatures: Record<string, number>,
  baselineSessions: Array<Record<string, number>>,
  featureNames: string[],
  populationStds: Record<string, number>,
  floorFraction: number,
): number[] {
  return featureNames.map(feat => {
    const baseVals = baselineSessions.map(s => s[feat]).filter(v => v != null && isFinite(v))
    if (baseVals.length === 0) return NaN
    const mean = baseVals.reduce((a, b) => a + b, 0) / baseVals.length
    const popStd = populationStds[feat]
    const floor = (popStd && isFinite(popStd) && popStd > 0) ? popStd * floorFraction : 0
    if (baseVals.length >= 2) {
      const sumSqDev = baseVals.reduce((a, v) => a + (v - mean) ** 2, 0)
      const subjectStd = Math.sqrt(sumSqDev / (baseVals.length - 1))
      const effectiveStd = Math.max(subjectStd, floor)
      if (effectiveStd > 0 && isFinite(effectiveStd)) {
        return Math.max(-10, Math.min(10, (testFeatures[feat] - mean) / effectiveStd))
      }
    }
    if (floor > 0) return Math.max(-10, Math.min(10, (testFeatures[feat] - mean) / floor))
    return Math.max(-10, Math.min(10, testFeatures[feat] - mean))
  })
}

function classify(
  testFeatures: Record<string, number>,
  baselineSessions: Array<Record<string, number>>,
): { probability: number; impaired: boolean; zScores: number[] } {
  const rawNames = artifact.raw_feature_names as string[]
  const popStds = artifact.sober_population_stds as Record<string, number>
  const floorFraction = artifact.floor_fraction ?? 0.25
  const zScores = computeZScoresWithFloor(testFeatures, baselineSessions, rawNames, popStds, floorFraction)
  const probability = predictEnsemble(artifact.trees, zScores, artifact.scale ?? 1.0, artifact.bias ?? 0.0)
  return { probability, impaired: probability >= artifact.optimal_threshold, zScores }
}

// C1 model: gaze_transition_entropy + saccade_frequency
const bipratsSober1 = { gaze_transition_entropy: 30.169, saccade_frequency: 2.935 }
const bipratsSober2 = { gaze_transition_entropy: 30.166, saccade_frequency: 2.733 }
const bipratsDrunk  = { gaze_transition_entropy: 25.943, saccade_frequency: 3.466 }

const loganSober1 = { gaze_transition_entropy: 23.411, saccade_frequency: 1.934 }
const loganSober2 = { gaze_transition_entropy: 22.775, saccade_frequency: 1.734 }
const loganDrunk  = { gaze_transition_entropy: 14.666, saccade_frequency: 1.600 }

describe('end-to-end baseline classifier flow (floor-normalized)', () => {
  describe('model artifact integrity', () => {
    it('has correct model type', () => {
      expect(artifact.model_type).toBe('catboost_baseline')
    })
    it('has 100 trees with 2 features', () => {
      expect(artifact.trees.length).toBe(100)
      expect(artifact.raw_feature_names).toEqual(['gaze_transition_entropy', 'saccade_frequency'])
    })
    it('has floor_fraction and min_baselines', () => {
      expect(artifact.floor_fraction).toBe(0.25)
      expect(artifact.min_baselines).toBe(5)
    })
    it('has sober_population_stds for both features', () => {
      expect(artifact.sober_population_stds).toBeDefined()
      expect(artifact.sober_population_stds.gaze_transition_entropy).toBeGreaterThan(0)
      expect(artifact.sober_population_stds.saccade_frequency).toBeGreaterThan(0)
    })
  })

  describe('z-scoring with std floor', () => {
    it('produces bounded z-scores for sober sessions', () => {
      const result = classify(bipratsSober1, [bipratsSober1, bipratsSober2])
      for (const z of result.zScores) expect(Math.abs(z)).toBeLessThan(5)
    })
    it('winsorizes z-scores to [-10, 10]', () => {
      const extreme = { gaze_transition_entropy: 1000, saccade_frequency: 100 }
      const result = classify(extreme, [bipratsSober1, bipratsSober2])
      for (const z of result.zScores) {
        expect(z).toBeGreaterThanOrEqual(-10)
        expect(z).toBeLessThanOrEqual(10)
      }
    })
    it('floor prevents inflation from tight baselines', () => {
      const tight1 = { gaze_transition_entropy: 30.10, saccade_frequency: 1.60 }
      const tight2 = { gaze_transition_entropy: 30.15, saccade_frequency: 1.61 }
      const test = { gaze_transition_entropy: 28.0, saccade_frequency: 1.3 }
      const result = classify(test, [tight1, tight2])
      for (const z of result.zScores) expect(Math.abs(z)).toBeLessThan(5)
    })
  })

  describe('classification correctness with 2 baselines', () => {
    it('classifies sober biprats as NOT impaired', () => {
      expect(classify(bipratsSober1, [bipratsSober1, bipratsSober2]).impaired).toBe(false)
    })
    it('classifies drunk biprats as impaired', () => {
      expect(classify(bipratsDrunk, [bipratsSober1, bipratsSober2]).impaired).toBe(true)
    })
    it('classifies sober logan as NOT impaired', () => {
      expect(classify(loganSober1, [loganSober1, loganSober2]).impaired).toBe(false)
    })
    it('classifies drunk logan as impaired', () => {
      expect(classify(loganDrunk, [loganSober1, loganSober2]).impaired).toBe(true)
    })
  })

  describe('safety nets', () => {
    it('returns NaN z-score for NaN test features', () => {
      const bad = { gaze_transition_entropy: NaN, saccade_frequency: 2.0 }
      const popStds = artifact.sober_population_stds as Record<string, number>
      const zScores = computeZScoresWithFloor(bad, [bipratsSober1, bipratsSober2], artifact.raw_feature_names, popStds, 0.25)
      expect(isNaN(zScores[0])).toBe(true)
    })
    it('handles zero-std baselines via floor', () => {
      const result = classify(bipratsDrunk, [bipratsSober1, bipratsSober1])
      expect(isFinite(result.probability)).toBe(true)
    })
    it('model probability is always in [0, 1]', () => {
      for (const t of [
        { gaze_transition_entropy: 0, saccade_frequency: 0 },
        { gaze_transition_entropy: 100, saccade_frequency: 10 },
        { gaze_transition_entropy: -5, saccade_frequency: -5 },
      ]) {
        const r = classify(t, [bipratsSober1, bipratsSober2])
        expect(r.probability).toBeGreaterThanOrEqual(0)
        expect(r.probability).toBeLessThanOrEqual(1)
      }
    })
  })

  describe('session_type and versioning', () => {
    it('window.__SESSION_TYPE__ not synced via useEffect', () => {
      const appTsx = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8')
      expect(appTsx).not.toContain('(window as any).__SESSION_TYPE__ = sessionType')
      expect(appTsx).toContain("__SESSION_TYPE__ = 'baseline'")
    })
    it('v4 baselines required', () => {
      const appTsx = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8')
      expect(appTsx).toContain('_version >= 7')
    })
    it('5-baseline requirement in App.tsx', () => {
      const appTsx = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8')
      expect(appTsx).toContain('MIN_BASELINES = 5')
    })
    it('floor-normalized z-scores bound sober sessions', () => {
      const z1 = classify(bipratsSober1, [bipratsSober1, bipratsSober2])
      const z2 = classify(bipratsSober2, [bipratsSober1, bipratsSober2])
      for (const z of [...z1.zScores, ...z2.zScores]) expect(Math.abs(z)).toBeLessThan(5)
    })
  })
})
