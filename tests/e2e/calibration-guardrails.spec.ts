import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

/**
 * Verify calibration guardrails are correctly configured in app.js.
 *
 * These tests check source-level constants and logic patterns.
 * They run without a dev server since they inspect the file directly.
 */

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_JS_PATH = path.join(__dirname, '..', '..', 'public', 'app.js')

test.describe('Calibration Guardrails (source verification)', () => {
  let appSource: string

  test.beforeAll(() => {
    appSource = fs.readFileSync(APP_JS_PATH, 'utf-8')
  })

  test('CENTER_ZONE_X is tightened to 0.38-0.62', () => {
    expect(appSource).toContain('CENTER_ZONE_X_MIN = 0.38')
    expect(appSource).toContain('CENTER_ZONE_X_MAX = 0.62')
  })

  test('EYE_SPAN_RATIO_MAX constant is 1.5', () => {
    expect(appSource).toContain('EYE_SPAN_RATIO_MAX = 1.5')
  })

  test('checkAllCriteria includes eyeSpanBalance criterion', () => {
    expect(appSource).toContain("criterion: 'eyeSpanBalance'")
    expect(appSource).toContain('Center your face')
  })

  test('priority order includes eyeSpanBalance after bothEyes', () => {
    expect(appSource).toContain("'bothEyes', 'eyeSpanBalance'")
  })

  test('simple calibration path checks span balance', () => {
    expect(appSource).toContain('spanBalanceOk')
    // Verify spanBalanceOk is part of allPass condition
    expect(appSource).toContain('bothEyes && centered && spanBalanceOk && distanceOk')
  })

  test('sidecar framing includes eye span metrics', () => {
    expect(appSource).toContain('leftEyeSpan')
    expect(appSource).toContain('rightEyeSpan')
    expect(appSource).toContain('eyeSpanRatio')
  })

  test('rich path uses smoothed spans for stability', () => {
    // The rich calibration path should use leftSpanSmooth/rightSpanSmooth
    // not raw corner coordinates for the span ratio check
    expect(appSource).toContain('leftSpanSmooth || leftSpan')
    expect(appSource).toContain('rightSpanSmooth || rightSpan')
  })
})
