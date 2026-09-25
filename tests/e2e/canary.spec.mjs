// Canary: launches Chromium with the extension loaded, visits
// https://seobandwagon.com/local-seo, runs the extension's page analysis the
// same way the popup does, then sends the capture to production through the
// extension's own API layer (src/lib/api.js), exactly as a synced capture goes.
//
// What this verifies:
//   1. The unpacked extension (extension/) loads into Chromium: the manifest
//      is valid and the service worker boots.
//   2. The popup's injection list loads into a real seobandwagon.com page and
//      the analyzer answers { action: 'analyze' } with structured data.
//   3. The capture, stripped the way the extension strips it before upload,
//      is accepted by POST /api/v1/captures.
//
// The captures endpoint requires an API key (anonymous posts were removed on
// the site). With the SBW_CANARY_KEY secret set, step 3 posts for real and
// expects 201 (new) or 409 (already captured in the dedupe window); the row
// is private to the key's account. Without it, step 3 checks the contract
// instead: the extension reports `no_key` without touching the network, and
// an unauthenticated POST gets 401.
//
// History: this passed weekly from April to 2026-08-31, then broke three
// ways. #7 (1.5.0) moved content.js to src/content/analyzer.js, so injection
// failed with "Could not load file: 'content.js'". #14 moved the manifest into
// extension/, so loading the repo root hung the browser launch until the
// 60-second test timeout, which hid the first break. The site then started
// requiring an API key for captures.

import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(__dirname, '..', '..', 'extension');
const TARGET_URL = 'https://seobandwagon.com/local-seo';
const CAPTURES_ENDPOINT = 'https://seobandwagon.com/api/v1/captures';
const CANARY_KEY = process.env.SBW_CANARY_KEY || '';

// The popup's own injection list, read from popup.js so the two can never
// drift apart again (the hard-coded copy here is how #7 broke this test).
function popupInjectionFiles() {
  const src = readFileSync(resolve(EXTENSION_PATH, 'src/popup/popup.js'), 'utf8');
  const m = /executeScript\(\{\s*target:\s*\{\s*tabId:\s*tab\.id\s*\},\s*files:\s*(\[[^\]]+\])/.exec(src);
  if (!m) throw new Error('could not find the analysis executeScript files list in popup.js');
  return JSON.parse(m[1].replace(/'/g, '"'));
}

// The extension strips a capture before it is stored or uploaded
// (src/lib/capture-strip.js, which uses SBWSchema to drop structured-data
// values). Both libs are dual-export, so Node can load them directly.
function stripCapture(capture) {
  const require = createRequire(import.meta.url);
  require(resolve(EXTENSION_PATH, 'src/lib/structured-data.js'));
  const { strip } = require(resolve(EXTENSION_PATH, 'src/lib/capture-strip.js'));
  return strip(capture);
}

test('the canary injects exactly what the popup injects', () => {
  const files = popupInjectionFiles();
  expect(files).toContain('src/content/analyzer.js');
  for (const f of files) expect(() => readFileSync(resolve(EXTENSION_PATH, f))).not.toThrow();
});

test('canary: analyze local-seo and POST capture to production', async () => {
  // Headful: Playwright's headless shell doesn't run MV3 service workers.
  // CI wraps this in xvfb-run to provide a virtual display.
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox'
    ]
  });

  try {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    }
    const extensionId = serviceWorker.url().split('/')[2];
    expect(extensionId).toMatch(/^[a-p]{32}$/);

    const page = await context.newPage();
    await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(1_000); // let client components hydrate

    const tabId = await serviceWorker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((t) => t.url && t.url.startsWith(url))?.id;
    }, TARGET_URL);
    expect(tabId).toBeTruthy();

    const files = popupInjectionFiles();
    await serviceWorker.evaluate(async ({ id, files }) => {
      await chrome.scripting.executeScript({ target: { tabId: id }, files });
    }, { id: tabId, files });

    const capture = await serviceWorker.evaluate(async (id) => {
      return await chrome.tabs.sendMessage(id, { action: 'analyze' });
    }, tabId);

    expect(capture).toBeTruthy();
    expect(capture.url).toContain('seobandwagon.com');
    expect(capture.meta?.title?.text?.length).toBeGreaterThan(0);
    expect(capture.content?.wordCount).toBeGreaterThan(0);
    expect(typeof capture.seoScore?.score).toBe('number');
    expect(capture.seoScore.score).toBeGreaterThanOrEqual(0);
    expect(capture.seoScore.score).toBeLessThanOrEqual(100);

    const payload = stripCapture(capture);

    if (CANARY_KEY) {
      // Real upload, through the extension's own API layer.
      const result = await serviceWorker.evaluate(async ({ key, payload }) => {
        await chrome.storage.sync.set({ apiKey: key });
        return await SBW.postCapture(payload);
      }, { key: CANARY_KEY, payload });
      expect([201, 409], `postCapture returned ${JSON.stringify({ status: result.status, code: result.code, data: result.data })}`)
        .toContain(result.status);
      console.log(`[canary] capture ${result.status === 201 ? 'created' : 'already captured (409)'}`);
    } else {
      // No key: the extension must refuse locally, and production must
      // refuse an anonymous capture.
      const result = await serviceWorker.evaluate(async (payload) => SBW.postCapture(payload), payload);
      expect(result.code).toBe('no_key');
      const response = await page.request.post(CAPTURES_ENDPOINT, {
        data: payload,
        headers: { 'Content-Type': 'application/json' }
      });
      expect(response.status()).toBe(401);
      console.log('[canary] SBW_CANARY_KEY not set: checked no_key locally and 401 from production');
    }
  } finally {
    await context.close();
  }
});
