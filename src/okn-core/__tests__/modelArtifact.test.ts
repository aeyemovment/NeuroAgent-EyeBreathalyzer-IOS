import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('model_artifact.json', () => {
  const artifactPath = resolve(__dirname, '../../../public/model_artifact.json')
  const raw = readFileSync(artifactPath, 'utf8')

  it('is valid JSON (no Infinity, NaN, or other non-standard tokens)', () => {
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  it('does not contain bare Infinity or NaN tokens', () => {
    expect(raw).not.toMatch(/\bInfinity\b/)
    expect(raw).not.toMatch(/\bNaN\b/)
  })

  it('has model_type catboost_baseline', () => {
    const artifact = JSON.parse(raw)
    expect(artifact.model_type).toBe('catboost_baseline')
  })

  it('has required fields for C1 baseline classifier', () => {
    const artifact = JSON.parse(raw)
    expect(artifact.feature_names).toEqual([
      'gaze_transition_entropy_zsub',
      'saccade_frequency_zsub',
    ])
    expect(artifact.raw_feature_names).toEqual([
      'gaze_transition_entropy',
      'saccade_frequency',
    ])
    expect(artifact.optimal_threshold).toBeCloseTo(0.4480, 3)
    expect(artifact.trees).toBeInstanceOf(Array)
    expect(artifact.trees.length).toBe(100)
    expect(artifact.sober_population_stds).toBeDefined()
    expect(artifact.sober_population_stds.gaze_transition_entropy).toBeGreaterThan(0)
    expect(artifact.sober_population_stds.saccade_frequency).toBeGreaterThan(0)
  })

  it('has valid oblivious tree structure', () => {
    const artifact = JSON.parse(raw)
    for (const tree of artifact.trees) {
      expect(tree.splits).toBeInstanceOf(Array)
      expect(tree.leaf_values).toBeInstanceOf(Array)
      expect(tree.leaf_values.length).toBe(Math.pow(2, tree.splits.length))
      for (const split of tree.splits) {
        expect(typeof split.feature_index).toBe('number')
        expect(split.feature_index).toBeGreaterThanOrEqual(0)
        expect(split.feature_index).toBeLessThan(2) // 2 features
        expect(typeof split.threshold).toBe('number')
        expect(isFinite(split.threshold)).toBe(true)
      }
    }
  })
})
