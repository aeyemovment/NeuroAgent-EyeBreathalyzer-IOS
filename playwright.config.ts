import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E configuration for HazyEyes.
 *
 * The dev server (npm run dev) must be running on port 3000 before executing
 * these tests. Tests target the UI shell and static DOM structure only —
 * webcam-dependent OKN measurement flows are explicitly excluded.
 *
 * Run tests:
 *   npx playwright test
 *   npx playwright test tests/e2e/page-load.spec.ts
 *   npx playwright show-report
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'playwright-report/results.xml' }],
    ['list'],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    // Grant camera permission so Clerk/MediaPipe init does not block the
    // auth UI from rendering; actual camera feed is never used in tests.
    permissions: ['camera'],
  },
  projects: [
    {
      name: 'chromium-portrait',
      use: {
        ...devices['Pixel 5'],
        // Force portrait orientation for auth/landing tests
        viewport: { width: 393, height: 851 },
      },
    },
    {
      name: 'chromium-landscape',
      use: {
        ...devices['Pixel 5'],
        // Landscape viewport to exercise the orientation-sensitive layout
        viewport: { width: 851, height: 393 },
      },
    },
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  // No webServer block — the dev server must be started manually:
  //   npm run dev
  // This avoids coupling test runs to a specific launch command and
  // allows tests to run against the already-running dev server in CI.
})
