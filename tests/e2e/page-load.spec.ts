/**
 * Test suite: Page Load
 *
 * Verifies the initial page render before any user interaction.
 * These tests must pass regardless of authentication state — they confirm
 * the React shell mounts, fonts load, and the basic document structure
 * is present.
 *
 * Webcam access is NOT required here. Camera permission is granted in
 * playwright.config.ts so the permission prompt never interrupts loading.
 */
import { test, expect } from '@playwright/test'

test.describe('Page load', () => {
  test('root div mounts and page is not blank', async ({ page }) => {
    await page.goto('/')

    // React mounts into #root — verify it is present and has content
    const root = page.locator('#root')
    await expect(root).toBeAttached()

    // The root should not be empty after React hydrates
    await expect(root).not.toBeEmpty()
  })

  test('page title is set by the app', async ({ page }) => {
    await page.goto('/')

    // App.tsx sets document.title = 'EyeBreathalyzer V3' in a useEffect
    // Allow a brief moment for the effect to run
    await page.waitForFunction(() => document.title.length > 0)
    const title = await page.title()
    expect(title.length).toBeGreaterThan(0)
    // Title should contain a meaningful app identifier
    expect(title.toLowerCase()).toMatch(/eyebreathalyzer|hazyeyes/i)
  })

  test('no JavaScript console errors on initial load', async ({ page }) => {
    const consoleErrors: string[] = []

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        // Filter out expected third-party CDN load errors that can occur
        // when MediaPipe CDN is unreachable in test environments
        const text = msg.text()
        const isKnownExternal =
          text.includes('cdn.jsdelivr.net') ||
          text.includes('mediapipe') ||
          text.includes('Failed to load resource') ||
          text.includes('unpkg.com')
        if (!isKnownExternal) {
          consoleErrors.push(text)
        }
      }
    })

    await page.goto('/')
    // Wait for React to stabilize
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1500)

    expect(consoleErrors).toHaveLength(0)
  })

  test('page responds with HTTP 200', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
  })

  test('viewport meta tag is set for mobile', async ({ page }) => {
    await page.goto('/')
    const viewportContent = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="viewport"]')
      return meta?.getAttribute('content') ?? ''
    })
    expect(viewportContent).toContain('width=device-width')
  })

  test('body has black background indicating CSS loaded', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const bgColor = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor
    })

    // styles.css sets --bg: #000000 and body { background: var(--bg) }
    // rgb(0, 0, 0) == #000000
    expect(bgColor).toBe('rgb(0, 0, 0)')
  })
})
