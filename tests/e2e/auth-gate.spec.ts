/**
 * Test suite: Auth Gate
 *
 * Verifies that the Clerk authentication UI is correctly gated — unauthenticated
 * users see a sign-in prompt and do not see auth-only content (user email,
 * consent screen, test start button). The tests do NOT actually sign in because
 * Clerk modal flows require real credentials and external network access.
 *
 * What these tests confirm:
 * - The sign-in button is present for unauthenticated visitors
 * - Protected content (user email) is absent until auth
 * - The app heading identifies the correct product
 * - Tab navigation structure exists
 */
import { test, expect } from '@playwright/test'

test.describe('Auth gate (unauthenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for React to fully hydrate and Clerk to resolve its loading state
    await page.waitForLoadState('domcontentloaded')
    // Clerk SDK reports isLoaded after async init — wait for the auth block
    // to become stable (either sign-in button or user content appears)
    await page.waitForTimeout(2000)
  })

  test('sign-in button is visible for unauthenticated users', async ({ page }) => {
    // App.tsx renders a <SignedOut> block with a "Sign in with email to continue" button
    const signInBtn = page.locator('button', { hasText: /sign in/i })
    await expect(signInBtn).toBeVisible({ timeout: 8000 })
  })

  test('app heading "EyeBreathalyzer V3" is visible', async ({ page }) => {
    // The idle screen heading — always visible regardless of auth state
    const heading = page.locator('.start-heading')
    await expect(heading).toBeVisible({ timeout: 8000 })
    await expect(heading).toContainText('EyeBreathalyzer')
  })

  test('tab bar with Test and Settings tabs is rendered', async ({ page }) => {
    // Tab bar is always rendered in the idle state
    const tabBar = page.locator('.tab-bar')
    await expect(tabBar).toBeVisible({ timeout: 8000 })

    const testTab = page.locator('.tab', { hasText: /^test$/i })
    const settingsTab = page.locator('.tab', { hasText: /^settings$/i })

    await expect(testTab).toBeVisible()
    await expect(settingsTab).toBeVisible()
  })

  test('HazyEyes brand footer logo is present', async ({ page }) => {
    const brandText = page.locator('.brand-footer__text')
    await expect(brandText).toBeVisible({ timeout: 8000 })
    await expect(brandText).toContainText('HazyEyes')
  })

  test('user email is NOT shown when signed out', async ({ page }) => {
    // The .auth-email-line element only renders inside <SignedIn>
    const emailLine = page.locator('.auth-email-line')
    await expect(emailLine).toHaveCount(0)
  })

  test('consent overlay is NOT visible when signed out', async ({ page }) => {
    // Consent overlay only renders when isSignedIn is true
    const consentOverlay = page.locator('.consent-overlay')
    await expect(consentOverlay).toHaveCount(0)
  })

  test('sign in prompt description text is shown', async ({ page }) => {
    const description = page.locator('.start-description', {
      hasText: /sign in is required/i,
    })
    await expect(description).toBeVisible({ timeout: 8000 })
  })
})

test.describe('Auth gate — Settings tab (unauthenticated)', () => {
  test('settings tab click shows sign-in prompt', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    // Click the Settings tab
    const settingsTab = page.locator('.tab', { hasText: /^settings$/i })
    await settingsTab.click()

    // Settings tab shows a sign-in button and a description
    const settingsSignInBtn = page.locator('button', { hasText: /sign in/i })
    await expect(settingsSignInBtn).toBeVisible({ timeout: 5000 })

    const settingsDescription = page.locator('.start-description', {
      hasText: /sign in to manage/i,
    })
    await expect(settingsDescription).toBeVisible()
  })

  test('active tab styling updates on click', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)

    const settingsTab = page.locator('.tab', { hasText: /^settings$/i })
    const testTab = page.locator('.tab', { hasText: /^test$/i })

    // Test tab should be active by default
    await expect(testTab).toHaveClass(/active/)

    // After clicking Settings, it becomes active
    await settingsTab.click()
    await expect(settingsTab).toHaveClass(/active/)
    await expect(testTab).not.toHaveClass(/active/)
  })
})
