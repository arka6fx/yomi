// Browser Automation Layer — Playwright-based web automation.
// Falls back to UIA → Accessibility → Vision → Coordinates when Playwright unavailable.
// Requires: `bun add playwright` and `npx playwright install chromium`
// Set YOMI_BROWSER_PROVIDER=playwright to enable.

type BrowserLike = { close: () => Promise<void>; newContext: () => Promise<{ newPage: () => Promise<PageLike> }> }
type PageLike = {
  goto: (url: string, options: { waitUntil: "domcontentloaded" }) => Promise<unknown>
  click: (selector: string) => Promise<unknown>
  fill: (selector: string, text: string) => Promise<unknown>
  textContent: (selector: string) => Promise<string | null>
  waitForSelector: (selector: string, options: { timeout: number }) => Promise<unknown>
  evaluate: (js: string) => Promise<unknown>
  screenshot: (options: { type: "png" }) => Promise<Buffer>
  waitForEvent: (event: "download") => Promise<{ suggestedFilename: () => string; saveAs: (path: string) => Promise<void> }>
  setInputFiles: (selector: string, filePath: string) => Promise<unknown>
}
type PlaywrightLike = { chromium: { launch: (options: { headless: boolean }) => Promise<BrowserLike> } }

let playwrightModule: PlaywrightLike | null = null

async function getPlaywright() {
  if (playwrightModule) return playwrightModule
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>
    playwrightModule = await dynamicImport("playwright") as PlaywrightLike
    return playwrightModule
  } catch {
    return null
  }
}

// ===========================================================================
// Browser session management
// ===========================================================================

let browser: BrowserLike | null = null
let page: PageLike | null = null

export async function browserLaunch(headless = false): Promise<{ ok: boolean; error?: string }> {
  const pw = await getPlaywright()
  if (!pw) return { ok: false, error: "Playwright not installed. Run: bun add playwright && npx playwright install chromium" }

  try {
    browser = await pw.chromium.launch({ headless })
    const context = await browser.newContext()
    page = await context.newPage()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function browserClose(): Promise<void> {
  await browser?.close().catch(() => {})
  browser = null; page = null
}

// ===========================================================================
// Navigation
// ===========================================================================

export async function browserNavigate(url: string): Promise<{ ok: boolean; error?: string }> {
  if (!page) return { ok: false, error: "browser not launched" }
  try { await page.goto(url, { waitUntil: "domcontentloaded" }); return { ok: true } }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}

// ===========================================================================
// Interaction
// ===========================================================================

export async function browserClick(selector: string): Promise<{ ok: boolean; error?: string }> {
  if (!page) return { ok: false, error: "browser not launched" }
  try { await page.click(selector); return { ok: true } }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}

export async function browserFill(selector: string, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!page) return { ok: false, error: "browser not launched" }
  try { await page.fill(selector, text); return { ok: true } }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}

export async function browserExtract(selector: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (!page) return { ok: false, error: "browser not launched" }
  try { const text = await page.textContent(selector); return { ok: true, text: text ?? "" } }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}

export async function browserWait(selector: string, timeoutMs = 10_000): Promise<{ ok: boolean; error?: string }> {
  if (!page) return { ok: false, error: "browser not launched" }
  try { await page.waitForSelector(selector, { timeout: timeoutMs }); return { ok: true } }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}

export async function browserEvaluate(js: string): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  if (!page) return { ok: false, error: "browser not launched" }
  try { const result = await page.evaluate(js); return { ok: true, result } }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}

export async function browserScreenshot(): Promise<{ ok: boolean; image_b64?: string; error?: string }> {
  if (!page) return { ok: false, error: "browser not launched" }
  try {
    const buf = await page.screenshot({ type: "png" })
    return { ok: true, image_b64: buf.toString("base64") }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function browserDownload(selector: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (!page) return { ok: false, error: "browser not launched" }
  try {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click(selector),
    ])
    const path = download.suggestedFilename()
    await download.saveAs(path)
    return { ok: true, path }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function browserUpload(selector: string, filePath: string): Promise<{ ok: boolean; error?: string }> {
  if (!page) return { ok: false, error: "browser not launched" }
  try { await page.setInputFiles(selector, filePath); return { ok: true } }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}
