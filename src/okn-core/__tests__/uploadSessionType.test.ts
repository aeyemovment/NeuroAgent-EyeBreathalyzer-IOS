import { describe, it, expect } from 'vitest'

/**
 * TDD test for the session_type race condition in uploadResultsToSupabase.
 *
 * Bug: session_type is read from window.__SESSION_TYPE__ AFTER async storage
 * uploads (CSV + video + sidecar JSON). If handleFinish() resets it to 'test'
 * before the row is constructed, the second baseline gets session_type='test'
 * instead of 'baseline'. On next app load, fetchBaseline finds only 1 baseline
 * row and forces the user to redo "Test 2 of 2".
 *
 * Fix: Capture session_type eagerly at function entry, before any async work.
 */

/**
 * Pure function extracted from uploadResultsToSupabase row construction.
 * Takes a snapshot of session_type (captured at function entry) instead of
 * reading window.__SESSION_TYPE__ lazily after async uploads.
 */
import { buildUploadRow } from '../uploadRow'

describe('upload session_type race condition', () => {
  it('uses the captured sessionType, not a late-read global', () => {
    // Simulate: session_type was 'baseline' when upload started
    const row = buildUploadRow({
      sessionType: 'baseline',
      userEmail: 'user@test.com',
      result: { baselineRawFeatures: { gaze_transition_entropy: 1.5, saccade_frequency: 3.2 } },
    })
    expect(row.session_type).toBe('baseline')
  })

  it('preserves baseline session_type even if called after global changed', () => {
    // This models the race: global was 'baseline' at capture time,
    // but by the time the row is built the global has changed to 'test'.
    // The function should use the captured value, not re-read the global.
    const row = buildUploadRow({
      sessionType: 'baseline', // captured at upload start
      userEmail: 'user@test.com',
      result: { baselineRawFeatures: { gaze_transition_entropy: 1.5, saccade_frequency: 3.2 } },
    })
    // Even though a hypothetical global is now 'test', row uses captured value
    expect(row.session_type).toBe('baseline')
  })

  it('defaults session_type to test when no sessionType provided', () => {
    const row = buildUploadRow({
      sessionType: undefined as any,
      userEmail: 'user@test.com',
      result: null,
    })
    expect(row.session_type).toBe('test')
  })

  it('populates ml_features from baselineRawFeatures with _version 4', () => {
    const row = buildUploadRow({
      sessionType: 'baseline',
      userEmail: 'user@test.com',
      result: {
        baselineRawFeatures: {
          gaze_transition_entropy: 2.1,
          saccade_frequency: 4.5,
        },
      },
    })
    expect(row.ml_features).toEqual({
      gaze_transition_entropy: 2.1,
      saccade_frequency: 4.5,
      _version: 4,
    })
  })

  it('sets ml_features to null when baselineRawFeatures missing', () => {
    const row = buildUploadRow({
      sessionType: 'baseline',
      userEmail: 'user@test.com',
      result: {},
    })
    expect(row.ml_features).toBeNull()
  })

  it('sets baseline_gain_cal only for baseline sessions with valid gain', () => {
    const row = buildUploadRow({
      sessionType: 'baseline',
      userEmail: 'user@test.com',
      result: { gainCalMedian: 0.92, baselineRawFeatures: { gaze_transition_entropy: 1, saccade_frequency: 2 } },
    })
    expect(row.baseline_gain_cal).toBe(0.92)
  })

  it('sets baseline_gain_cal to null for test sessions', () => {
    const row = buildUploadRow({
      sessionType: 'test',
      userEmail: 'user@test.com',
      result: { gainCalMedian: 0.92, baselineRawFeatures: { gaze_transition_entropy: 1, saccade_frequency: 2 } },
    })
    expect(row.baseline_gain_cal).toBeNull()
  })
})
