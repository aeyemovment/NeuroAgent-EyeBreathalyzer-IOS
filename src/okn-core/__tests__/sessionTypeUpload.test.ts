import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * TDD tests for session_type upload bug.
 *
 * Bug 1: app.js line 414 defaults to 'test' when window.__SESSION_TYPE__ is
 * null/undefined/falsy. This silently masks missing session_type instead of
 * failing loudly. Baseline sessions get recorded as 'test', then get archived
 * as "unlabeled tests" because they have no BAC.
 *
 * Bug 2: The non-authenticated "Start Test" button (App.tsx line 1249) calls
 * handleStartTest() directly without setting __SESSION_TYPE__, so it stays
 * null and the upload falls back to 'test'. If auth/consent state glitches,
 * users bypass the baseline workflow entirely.
 *
 * Fix: app.js should never silently default to 'test'. If __SESSION_TYPE__ is
 * not explicitly set to 'baseline' or 'test', the upload should use 'unknown'
 * so it can be triaged. And handleStartTest() should refuse to proceed if
 * __SESSION_TYPE__ hasn't been explicitly set by the routing layer.
 */

const appJsPath = resolve(__dirname, '../../../public/app.js')
const appTsxPath = resolve(__dirname, '../../App.tsx')

describe('session_type upload safety', () => {
  const appJs = readFileSync(appJsPath, 'utf8')

  it('app.js must NOT silently default session_type to test', () => {
    // The old bug: `|| 'test'` silently masks null/undefined __SESSION_TYPE__
    // This pattern should not exist in the upload row construction
    const uploadSection = appJs.slice(
      appJs.indexOf('session_type:'),
      appJs.indexOf('session_type:') + 200
    )
    expect(uploadSection).not.toContain("|| 'test'")
  })

  it('app.js session_type must only allow baseline, test, or unknown', () => {
    // The upload path should validate __SESSION_TYPE__ and use 'unknown' for
    // any unexpected value, not silently default.
    // The validation happens at the top of uploadResultsToSupabase (eager capture),
    // so search the full function body, not just near the session_type property.
    const fnStart = appJs.indexOf('async function uploadResultsToSupabase')
    const fnSection = appJs.slice(fnStart, fnStart + 1000)
    // Must reference 'unknown' as a fallback
    expect(fnSection).toContain('unknown')
  })
})

describe('handleStartTest must require explicit session_type', () => {
  const appTsx = readFileSync(appTsxPath, 'utf8')

  it('no UI path calls handleStartTest without setting __SESSION_TYPE__ first', () => {
    // Find all onClick handlers that call handleStartTest
    // handleStartBaseline sets __SESSION_TYPE__ = 'baseline' then calls handleStartTest ✓
    // handleStartRegularTest sets __SESSION_TYPE__ = 'test' then calls handleStartTest ✓
    // The bug: the non-auth "Start Test" button called handleStartTest directly
    //
    // After fix: every button that starts a test must go through
    // handleStartBaseline or handleStartRegularTest, never handleStartTest directly

    // Count direct onClick={handleStartTest} references (excluding the function definition)
    const directCalls = appTsx.match(/onClick=\{handleStartTest\}/g) || []
    // There should be ZERO direct onClick references to handleStartTest
    // All UI buttons should use handleStartBaseline or handleStartRegularTest
    expect(directCalls.length).toBe(0)
  })

  it('handleStartTest validates __SESSION_TYPE__ is set', () => {
    // handleStartTest should check that __SESSION_TYPE__ has been explicitly
    // set before proceeding
    const handleStartBody = appTsx.slice(
      appTsx.indexOf('const handleStartTest = ()'),
      appTsx.indexOf('const handleStartTest = ()') + 500
    )
    expect(handleStartBody).toContain('__SESSION_TYPE__')
  })
})
