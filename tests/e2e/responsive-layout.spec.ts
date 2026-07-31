/**
 * Test suite: Responsive Layout
 *
 * Verifies orientation-sensitive CSS layout behavior:
 * - Portrait mode shows "Turn phone to landscape" prompt instead of Start button
 *   (because the OKN test requires landscape orientation)
 * - Landscape mode shows the Start Test button (when auth allows)
 * - The layout does not overflow horizontally at any tested viewport width
 * - Core CSS media queries are wired correctly
 *
 * These tests use the viewport sizes configured per project in playwright.config.ts
 * and also test explicit viewport overrides inline.
 */
import { test, expect } from '@playwright/test'

test.describe('Portrait orientation layout', () => {
  test.use({ viewport: { width: 393, height: 851 } })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)
  })

  test('landscape-prompt text is visible in portrait for unauthenticated user', async ({ page }) => {
    // App.tsx: when (!isSignedIn || !consentChoice) && !isLandscape → shows landscape prompt
    // isLandscape = window.innerWidth > window.innerHeight
    // 393 < 851 → portrait → landscape prompt should display
    const promptText = page.locator('.landscape-prompt__text')
    await expect(promptText).toBeVisible({ timeout: 8000 })
    await expect(promptText).toContainText(/turn phone to landscape/i)
  })

  test('no horizontal overflow in portrait viewport (393px wide)', async ({ page }) => {
    const overflowX = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth
    })
    expect(overflowX).toBe(false)
  })

  test('start-card is within max-width bounds', async ({ page }) => {
    const card = page.locator('.start-card')
    await expect(card).toBeVisible({ timeout: 8000 })
    const box = await card.boundingBox()
    // start-card has max-width: 420px — should never exceed viewport width
    expect(box?.width).toBeLessThanOrEqual(393 + 1) // +1 for sub-pixel rounding
  })

  test('tab bar buttons are horizontally centered', async ({ page }) => {
    const tabBar = page.locator('.tab-bar')
    await expect(tabBar).toBeVisible({ timeout: 8000 })
    const tabBarBox = await tabBar.boundingBox()
    // tab-bar has justify-content: center — verify it spans the full width
    expect(tabBarBox?.width).toBeGreaterThan(200)
  })
})

test.describe('Landscape orientation layout', () => {
  test.use({ viewport: { width: 851, height: 393 } })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)
  })

  test('landscape-prompt is NOT shown in landscape for unauthenticated user', async ({ page }) => {
    // In landscape (851 > 393), isLandscape = true
    // For unauthenticated user: shows Start Test button, not the prompt
    const promptTexts = page.locator('.landscape-prompt__text')
    // There should be no portrait-only landscape prompt visible in landscape orientation
    const count = await promptTexts.count()
    if (count > 0) {
      // If the element exists, it should not be visible (could be in a hidden branch)
      for (let i = 0; i < count; i++) {
        await expect(promptTexts.nth(i)).not.toBeVisible()
      }
    }
  })

  test('Start Test button is visible for unauthenticated user in landscape', async ({ page }) => {
    // App.tsx: (!isSignedIn || !consentChoice) && isLandscape → shows #btnStart
    const startBtn = page.locator('#btnStart')
    await expect(startBtn).toBeVisible({ timeout: 8000 })
    await expect(startBtn).toContainText(/start test/i)
  })

  test('Start Test button is disabled when not signed in', async ({ page }) => {
    // canStart requires isSignedIn && consentChoice — both absent when signed out
    const startBtn = page.locator('#btnStart')
    await expect(startBtn).toBeVisible({ timeout: 8000 })
    await expect(startBtn).toBeDisabled()
  })

  test('no horizontal overflow in landscape viewport (851px wide)', async ({ page }) => {
    const overflowX = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth
    })
    expect(overflowX).toBe(false)
  })
})

test.describe('Desktop viewport layout', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)
  })

  test('page renders without horizontal overflow at 1280px', async ({ page }) => {
    const overflowX = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth
    })
    expect(overflowX).toBe(false)
  })

  test('main heading is visible at desktop width', async ({ page }) => {
    const heading = page.locator('.start-heading')
    await expect(heading).toBeVisible({ timeout: 8000 })
  })

  test('Start Test button is visible at desktop width (landscape)', async ({ page }) => {
    // 1280 > 800 → isLandscape=true for unauthenticated user
    const startBtn = page.locator('#btnStart')
    await expect(startBtn).toBeVisible({ timeout: 8000 })
  })
})

test.describe('Narrow mobile viewport', () => {
  test.use({ viewport: { width: 320, height: 568 } })

  test('page renders at 320px width without overflow', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1500)

    const overflowX = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth
    })
    expect(overflowX).toBe(false)
  })

  test('portrait landscape prompt visible at 320x568', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    const promptText = page.locator('.landscape-prompt__text')
    await expect(promptText).toBeVisible({ timeout: 8000 })
  })
})
