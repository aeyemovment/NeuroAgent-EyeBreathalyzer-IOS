/**
 * Verification suite: Results screen "Calculated offline" on deployed production URL
 *
 * Target: https://hazyeyes-opennystagmus.vercel.app
 *
 * Since the full OKN test requires a camera and real eye tracking, this suite
 * verifies the deployed bundle contents directly:
 *
 * 1. Landing page loads and screenshot is captured.
 * 2. The deployed app.js bundle contains "Calculated offline".
 * 3. The deployed app.js bundle does NOT show "Impaired"/"Not Impaired" as a
 *    displayed UI label (logging/upload references are expected and allowed).
 * 4. The deployed CSS contains the "risk-neutral" class.
 * 5. Screenshots are captured at each key verification step.
 */
import { test, expect, Page } from '@playwright/test'
import * as fs from 'fs'
import { fileURLToPath } from 'url'
import * as path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEPLOYED_URL = 'https://hazyeyes-opennystagmus.vercel.app'
const ARTIFACTS_DIR = path.join(__dirname, 'artifacts')

function ensureArtifactsDir() {
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })
  }
}

async function screenshotStep(page: Page, name: string) {
  ensureArtifactsDir()
  const filePath = path.join(ARTIFACTS_DIR, `${name}.png`)
  await page.screenshot({ path: filePath, fullPage: true })
  console.log(`Screenshot saved: ${filePath}`)
  return filePath
}

test.describe('Deployed results screen verification — hazyeyes-opennystagmus.vercel.app', () => {
  // Each test navigates to the live site independently.
  test.use({ baseURL: DEPLOYED_URL })

  test('Step 1: Landing page loads and renders visible content', async ({ page }) => {
    await page.goto(DEPLOYED_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForLoadState('load', { timeout: 30000 })

    // Give JS time to boot
    await page.waitForTimeout(3000)

    // Page should have a non-empty body
    const bodyText = await page.locator('body').innerText()
    console.log('Body text (first 500 chars):', bodyText.substring(0, 500))

    // Capture landing page screenshot
    await screenshotStep(page, '01-landing-page')

    // Basic existence check — the page must have rendered something
    expect(bodyText.length).toBeGreaterThan(10)
  })

  test('Step 2: Deployed app.js bundle contains "Calculated offline"', async ({ page }) => {
    await page.goto(DEPLOYED_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 30000 })

    // Collect all script src URLs loaded by the page
    const scriptUrls: string[] = await page.evaluate(() => {
      return Array.from(document.scripts)
        .map(s => s.src)
        .filter(src => src.length > 0)
    })
    console.log('Script URLs found:', scriptUrls)

    // Fetch each script and look for "Calculated offline"
    let foundCalculatedOffline = false
    let foundInAppJs = false
    let checkedUrls: string[] = []

    for (const url of scriptUrls) {
      try {
        const response = await page.request.get(url)
        const text = await response.text()
        checkedUrls.push(url)
        if (text.includes('Calculated offline')) {
          foundCalculatedOffline = true
          if (url.includes('app.js') || url.includes('app-')) {
            foundInAppJs = true
          }
          console.log(`"Calculated offline" found in: ${url}`)
        }
      } catch (e) {
        console.log(`Could not fetch: ${url}`, e)
      }
    }

    console.log('Checked URLs:', checkedUrls)
    console.log('"Calculated offline" found:', foundCalculatedOffline)

    await screenshotStep(page, '02-bundle-check')

    expect(foundCalculatedOffline).toBe(true)
  })

  test('Step 3: Deployed bundle does NOT show "Impaired"/"Not Impaired" as a UI label in showDecision', async ({ page }) => {
    await page.goto(DEPLOYED_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 30000 })

    const scriptUrls: string[] = await page.evaluate(() => {
      return Array.from(document.scripts)
        .map(s => s.src)
        .filter(src => src.length > 0)
    })

    // We check specifically that showDecision does NOT set "Impaired" or "Not Impaired"
    // as displayed text. The pattern to look for is the showDecision function context.
    // It's acceptable for "Impaired" to appear in safety-default logging or upload code.
    let showDecisionSetsImpaired = false
    let showDecisionContent = ''

    for (const url of scriptUrls) {
      try {
        const response = await page.request.get(url)
        const text = await response.text()

        // Extract the region around showDecision to check what it sets in the UI
        const showDecisionIdx = text.indexOf('showDecision')
        if (showDecisionIdx !== -1) {
          // Grab 2000 chars of context around showDecision
          showDecisionContent = text.substring(showDecisionIdx, showDecisionIdx + 2000)
          console.log('showDecision context (first 2000 chars):', showDecisionContent)

          // Check if showDecision sets decisionTag.textContent to "Impaired" or "Not Impaired"
          // (as opposed to "Calculated offline")
          const setToImpaired = /decisionTag\.textContent\s*=\s*['"](?:Not )?Impaired['"]/i.test(showDecisionContent)
          const setToCalcOffline = showDecisionContent.includes('Calculated offline')

          if (setToImpaired) {
            showDecisionSetsImpaired = true
            console.log('PROBLEM: showDecision sets textContent to Impaired/Not Impaired')
          }
          if (setToCalcOffline) {
            console.log('GOOD: showDecision sets textContent to "Calculated offline"')
          }
        }
      } catch (e) {
        console.log(`Could not fetch: ${url}`)
      }
    }

    await screenshotStep(page, '03-show-decision-check')

    // The showDecision function must NOT set "Impaired" or "Not Impaired" as UI text
    expect(showDecisionSetsImpaired).toBe(false)
  })

  test('Step 4: Deployed CSS contains risk-neutral class', async ({ page }) => {
    await page.goto(DEPLOYED_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 30000 })

    // Check inline stylesheets (accessible via CSSOM)
    const hasRiskNeutralInCSS = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules ?? [])) {
            if (rule.cssText.includes('risk-neutral')) return true
          }
        } catch (_) { /* cross-origin */ }
      }
      return false
    })

    // Also check linked stylesheet URLs
    const styleUrls: string[] = await page.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
        .map(l => l.href)
        .filter(h => h.length > 0)
    })
    console.log('Stylesheet URLs:', styleUrls)

    let foundRiskNeutralInFetch = false
    for (const url of styleUrls) {
      try {
        const response = await page.request.get(url)
        const css = await response.text()
        if (css.includes('risk-neutral')) {
          foundRiskNeutralInFetch = true
          console.log(`"risk-neutral" found in CSS: ${url}`)
        }
      } catch (e) {
        console.log(`Could not fetch CSS: ${url}`)
      }
    }

    // Also search JS bundles for inline CSS or class references
    const scriptUrls: string[] = await page.evaluate(() => {
      return Array.from(document.scripts)
        .map(s => s.src)
        .filter(src => src.length > 0)
    })
    let foundRiskNeutralInJS = false
    for (const url of scriptUrls) {
      try {
        const response = await page.request.get(url)
        const text = await response.text()
        if (text.includes('risk-neutral')) {
          foundRiskNeutralInJS = true
          console.log(`"risk-neutral" found in JS bundle: ${url}`)
        }
      } catch (e) {
        console.log(`Could not fetch JS: ${url}`)
      }
    }

    console.log('risk-neutral in CSSOM:', hasRiskNeutralInCSS)
    console.log('risk-neutral in fetched CSS:', foundRiskNeutralInFetch)
    console.log('risk-neutral in JS bundle:', foundRiskNeutralInJS)

    await screenshotStep(page, '04-css-risk-neutral-check')

    const foundRiskNeutral = hasRiskNeutralInCSS || foundRiskNeutralInFetch || foundRiskNeutralInJS
    expect(foundRiskNeutral).toBe(true)
  })

  test('Step 5: Final landing page screenshot with visible page state', async ({ page }) => {
    await page.goto(DEPLOYED_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForLoadState('load', { timeout: 30000 })
    await page.waitForTimeout(4000)

    // Log visible text for diagnosis
    const visibleText = await page.locator('body').innerText()
    console.log('Visible page text:\n', visibleText.substring(0, 1000))

    // Capture final state screenshot
    await screenshotStep(page, '05-final-landing-state')

    // Verify "Impaired" or "Not Impaired" is not visible as standalone text in the UI
    // (it should say "Calculated offline" on the results panel)
    const bodyText = await page.locator('body').innerText()
    const hasImpairedLabel = /^(?:Not\s+)?Impaired$/im.test(bodyText)
    console.log('Body contains standalone "Impaired" label:', hasImpairedLabel)

    // This is an informational check — the landing page should not show results at all
    // (results only appear after a completed test)
    expect(bodyText).not.toMatch(/^Impaired$/im)
    expect(bodyText).not.toMatch(/^Not Impaired$/im)
  })
})
