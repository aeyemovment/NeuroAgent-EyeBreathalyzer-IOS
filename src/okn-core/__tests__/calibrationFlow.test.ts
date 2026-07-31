import { describe, it, expect } from 'vitest'

/**
 * TDD test for the 2-step calibration flow.
 *
 * Bug: handleStartBaseline gates on soberConfirmed, but after test 1 completes
 * and the user returns to the idle screen for test 2, soberConfirmed is false
 * and the checkbox isn't shown. The button fires but the handler silently returns.
 *
 * Rule: soberConfirmed should only be required for the FIRST calibration test.
 * For test 2, the user already confirmed sobriety — don't ask again.
 */

// Simulate the state machine
type BaselineStatus = 'loading' | 'none' | 'needs_second' | 'exists' | 'error'

function shouldRequireSoberConfirmation(baselineStatus: BaselineStatus): boolean {
  // Only require sober confirmation for the very first calibration
  // Once test 1 is done (needs_second), the user already confirmed
  return baselineStatus === 'none'
}

function canStartBaseline(
  baselineStatus: BaselineStatus,
  soberConfirmed: boolean,
): boolean {
  if (baselineStatus === 'none') return soberConfirmed
  if (baselineStatus === 'needs_second') return true // already confirmed
  return false
}

describe('calibration flow state machine', () => {
  it('requires sober confirmation for first calibration', () => {
    expect(canStartBaseline('none', false)).toBe(false)
    expect(canStartBaseline('none', true)).toBe(true)
  })

  it('does NOT require sober confirmation for second calibration', () => {
    // This is the bug: needs_second should not gate on soberConfirmed
    expect(canStartBaseline('needs_second', false)).toBe(true)
    expect(canStartBaseline('needs_second', true)).toBe(true)
  })

  it('shows sober checkbox only for first calibration', () => {
    expect(shouldRequireSoberConfirmation('none')).toBe(true)
    expect(shouldRequireSoberConfirmation('needs_second')).toBe(false)
  })

  it('does not allow starting baseline from other states', () => {
    expect(canStartBaseline('loading', true)).toBe(false)
    expect(canStartBaseline('exists', true)).toBe(false)
    expect(canStartBaseline('error', true)).toBe(false)
  })
})
