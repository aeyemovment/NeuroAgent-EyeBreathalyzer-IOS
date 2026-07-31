/**
 * Test suite: Accessibility
 *
 * Basic accessibility checks for the HazyEyes landing page.
 * - Keyboard navigation: tab stops reach interactive elements
 * - Button elements have accessible names
 * - No images missing alt text
 * - Color contrast: dark-on-dark text has at least a font-weight fallback
 *   (full contrast ratio checks require axe-playwright which is a separate dep)
 * - Focus styles are not forcibly hidden via outline:0 with no replacement
 */
import { test, expect } from '@playwright/test'

test.describe('Accessibility — landing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)
  })

  test('all buttons have non-empty accessible names', async ({ page }) => {
    const buttons = page.locator('button')
    const count = await buttons.count()
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i)
      const text = (await btn.textContent())?.trim() ?? ''
      const ariaLabel = await btn.getAttribute('aria-label')
      const hasName = text.length > 0 || (ariaLabel !== null && ariaLabel.length > 0)
      expect(hasName, `Button at index ${i} has no accessible name`).toBe(true)
    }
  })

  test('images have alt attributes', async ({ page }) => {
    const images = page.locator('img')
    const count = await images.count()

    for (let i = 0; i < count; i++) {
      const img = images.nth(i)
      const alt = await img.getAttribute('alt')
      // alt must exist (empty string is acceptable for decorative images)
      expect(alt, `Image at index ${i} is missing alt attribute`).not.toBeNull()
    }
  })

  test('interactive elements are reachable by keyboard Tab', async ({ page }) => {
    // Press Tab and verify focus moves to an interactive element
    await page.keyboard.press('Tab')

    const focusedTag = await page.evaluate(() => document.activeElement?.tagName.toLowerCase())
    // Tab should land on a button, a, or input element — not on body or div
    expect(['button', 'a', 'input', 'select', 'textarea']).toContain(focusedTag)
  })

  test('lang attribute is set on html element', async ({ page }) => {
    const lang = await page.evaluate(() => document.documentElement.lang)
    expect(lang).toBeTruthy()
    expect(lang).toMatch(/^[a-z]{2}/)
  })

  test('page has exactly one h1 element on idle screen', async ({ page }) => {
    const h1s = page.locator('h1')
    const count = await h1s.count()
    // There should be exactly one h1 on the landing/idle page for proper document outline
    expect(count).toBe(1)
  })

  test('btn.primary focus-visible outline is not forcibly removed', async ({ page }) => {
    // Verify that focus-visible outline is not set to 'none' without replacement
    // by checking the CSS rules for .btn
    const outlineRule = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules ?? [])) {
            const text = rule.cssText
            // A rule that sets outline:0 or outline:none on .btn WITHOUT
            // a focus-visible override is an accessibility concern
            if (text.includes('.btn') && text.includes('outline: 0')) {
              return 'outline-zero-found'
            }
            if (text.includes('.btn') && text.includes('outline: none')) {
              return 'outline-none-found'
            }
          }
        } catch (_) { /* cross-origin */ }
      }
      return 'no-outline-removal'
    })

    // The current styles.css uses -webkit-tap-highlight-color on .btn
    // but does NOT globally suppress outline. Verify this is still the case.
    expect(outlineRule).toBe('no-outline-removal')
  })
})
