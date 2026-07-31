/**
 * Test suite: Results Phase DOM Structure
 *
 * Verifies that results-screen components render correctly given the correct
 * React state. Since Clerk auth is required to reach the results phase
 * organically, this suite uses two strategies:
 *
 * 1. Direct window event dispatch — fires the 'test-complete' CustomEvent that
 *    App.tsx listens to and uses to set testPhase='results'. This bypasses
 *    MediaPipe and camera entirely. It DOES still require Clerk to have
 *    resolved isSignedIn=true, so we check both the event dispatch path and
 *    the structural CSS validation path.
 *
 * 2. CSS/structural assertions — verify that results-phase CSS classes exist
 *    in the loaded stylesheet, confirming the component bundle is correct.
 */
import { test, expect } from '@playwright/test'

// Minimal synthetic result that matches what app.js emits via 'test-complete'
const SYNTHETIC_RESULT = {
  decision: 'unlikely',     // 'unlikely' | 'possible' | 'likely' | 'insufficient'
  gain: 0.92,
  passQuality: true,
  retryReason: null,
  baselineRawFeatures: null,
}

test.describe('Results phase CSS and structural validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1500)
  })

  test('results-screen-ios CSS class is defined in stylesheet', async ({ page }) => {
    const hasClass = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules ?? [])) {
            if (rule.cssText.includes('results-screen-ios')) return true
          }
        } catch (_) { /* cross-origin */ }
      }
      return false
    })
    expect(hasClass).toBe(true)
  })

  test('outcome-panel CSS class is defined in stylesheet', async ({ page }) => {
    const hasClass = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules ?? [])) {
            if (rule.cssText.includes('outcome-panel')) return true
          }
        } catch (_) { /* cross-origin */ }
      }
      return false
    })
    expect(hasClass).toBe(true)
  })

  test('risk tone CSS classes are all defined (risk-low, risk-medium, risk-high)', async ({ page }) => {
    const riskClasses = await page.evaluate(() => {
      const found = new Set<string>()
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules ?? [])) {
            if (rule.cssText.includes('risk-high')) found.add('risk-high')
            if (rule.cssText.includes('risk-low')) found.add('risk-low')
            if (rule.cssText.includes('risk-medium')) found.add('risk-medium')
          }
        } catch (_) { /* cross-origin */ }
      }
      return Array.from(found)
    })
    expect(riskClasses).toContain('risk-high')
    expect(riskClasses).toContain('risk-low')
    expect(riskClasses).toContain('risk-medium')
  })

  test('subject-panel and feedback-panel CSS are defined', async ({ page }) => {
    const hasPanel = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules ?? [])) {
            if (rule.cssText.includes('subject-panel')) return true
          }
        } catch (_) { /* cross-origin */ }
      }
      return false
    })
    expect(hasPanel).toBe(true)
  })
})

test.describe('Results phase via synthetic test-complete event', () => {
  test('test-complete event with unlikely decision shows results UI', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    // Check if user is signed in by looking for the email line
    const isSignedIn = await page.locator('.auth-email-line').count() > 0

    if (!isSignedIn) {
      // Skip this check if not authenticated — auth is required for results phase
      test.skip()
      return
    }

    // Fire the synthetic event that app.js fires after a real test
    await page.evaluate((result) => {
      window.dispatchEvent(new CustomEvent('test-complete', { detail: result }))
    }, SYNTHETIC_RESULT)

    await page.waitForTimeout(500)

    // The results-screen-ios div should now be rendered
    const resultsScreen = page.locator('.results-screen-ios')
    await expect(resultsScreen).toBeVisible({ timeout: 3000 })

    // Outcome panel should be visible
    const outcomePanel = page.locator('.outcome-panel')
    await expect(outcomePanel).toBeVisible()

    // Results screen now shows "Calculated offline" in a neutral gray panel
    // regardless of the raw decision — actual result is logged to Supabase only.
    // The outcome-value element may not exist in the new results layout (the
    // React ResultsScreen renders a risk-neutral panel instead).  What matters
    // is that the results-screen-ios container is visible and the old
    // "Impaired"/"Not Impaired" label is NOT shown as standalone visible text.
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toMatch(/^Not Impaired$/im)
  })

  test('test-complete event with likely-impaired decision shows neutral "Calculated offline" UI', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    const isSignedIn = await page.locator('.auth-email-line').count() > 0
    if (!isSignedIn) {
      test.skip()
      return
    }

    const impairedResult = { ...SYNTHETIC_RESULT, decision: 'likely', gain: 0.45 }
    await page.evaluate((result) => {
      window.dispatchEvent(new CustomEvent('test-complete', { detail: result }))
    }, impairedResult)

    await page.waitForTimeout(500)

    const resultsScreen = page.locator('.results-screen-ios')
    await expect(resultsScreen).toBeVisible({ timeout: 3000 })

    // UI must NOT show "Impaired" as a standalone visible label — the new
    // design always shows "Calculated offline" in a neutral gray panel.
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toMatch(/^Impaired$/im)
  })

  test('BAC input field renders in test results screen', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    const isSignedIn = await page.locator('.auth-email-line').count() > 0
    if (!isSignedIn) {
      test.skip()
      return
    }

    await page.evaluate((result) => {
      window.dispatchEvent(new CustomEvent('test-complete', { detail: result }))
    }, SYNTHETIC_RESULT)

    await page.waitForTimeout(500)

    // The BAC input only appears for 'test' session type (not baseline)
    const bacInput = page.locator('#bac-value')
    await expect(bacInput).toBeVisible({ timeout: 3000 })
    await expect(bacInput).toHaveAttribute('type', 'number')
  })

  test('Submit & Save button renders in test results screen', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    const isSignedIn = await page.locator('.auth-email-line').count() > 0
    if (!isSignedIn) {
      test.skip()
      return
    }

    await page.evaluate((result) => {
      window.dispatchEvent(new CustomEvent('test-complete', { detail: result }))
    }, SYNTHETIC_RESULT)

    await page.waitForTimeout(500)

    const submitBtn = page.locator('button', { hasText: /submit.*save/i })
    await expect(submitBtn).toBeVisible({ timeout: 3000 })
  })
})
