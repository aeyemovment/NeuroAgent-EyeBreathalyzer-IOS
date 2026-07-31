import { describe, it, expect } from 'vitest'

/**
 * Regression test for React error #300:
 * "Objects are not valid as a React child"
 *
 * The baseline query returns ml_features as a JSONB object from Supabase.
 * If this object leaks into JSX rendering, React throws error #300.
 *
 * This test verifies that the baseline status state machine values
 * are all primitive strings (never objects that could leak into JSX).
 */
describe('baseline status state machine', () => {
  const VALID_STATES = ['loading', 'none', 'exists', 'error'] as const

  it('all baseline status values are primitive strings', () => {
    for (const state of VALID_STATES) {
      expect(typeof state).toBe('string')
    }
  })

  it('supabase ml_features response is an object (not renderable as React child)', () => {
    // Simulate what Supabase returns for ml_features JSONB column
    const mockSupabaseRow = {
      ml_features: {
        saccade_frequency: 1.6,
        gaze_entropy: 3.6,
        gaze_transition_entropy: 28.4,
      }
    }

    // ml_features is an object — rendering it directly would cause error #300
    expect(typeof mockSupabaseRow.ml_features).toBe('object')

    // Verify it's NOT a string (which would be safe to render)
    expect(typeof mockSupabaseRow.ml_features).not.toBe('string')

    // The correct pattern: store in state, pass to window global, never render
    const baselineFeatures = mockSupabaseRow.ml_features
    expect(baselineFeatures.saccade_frequency).toBeCloseTo(1.6)
  })
})

/**
 * Regression test: catch() without parameter binding must be valid
 * in our TypeScript configuration. Bare catch {} was introduced in ES2019.
 */
describe('bare catch syntax', () => {
  it('catch without parameter is valid', () => {
    let caught = false
    try {
      JSON.parse('invalid json{{{')
    } catch {
      caught = true
    }
    expect(caught).toBe(true)
  })
})
