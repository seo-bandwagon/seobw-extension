// Weekly canary: launches Chromium with the extension loaded, visits
// https://seobandwagon.com/local-seo, drives the content-analysis pipeline
// through the extension's service worker, then POSTs the resulting capture
// to the public /api/v1/captures endpoint.
//
// What this verifies:
//   1. The unpacked extension loads into Chromium (manifest is valid,
//      service worker boots).
//   2. chrome.scripting.executeScript successfully injects content-analysis.js,
//      dom-extraction.js, and content.js into a real seobandwagon.com page.
//   3. The content script's message listener responds with structured data
//      from a real (non-fixture) page.
//   4. The /api/v1/captures endpoint accepts that payload and returns 201
//      (or 409 if we already captured it this hour — still a valid signal).
//
// What this does NOT verify:
//   - The extension's popup.js autoSaveCapture wrapper (untested here; lives
//     in UI code that's hard to drive from Playwright). The important parts
//     are exercised via direct fetch.
//   - Rollup stats, domain_stats rolling averages (platform-side concern).
//
// Intentional pollution: this test creates ONE real row in Neon's
// extension_analyses per run. On the weekly cron cadence, that's fine. If
// the backend ever adds a "test canary" flag, swap to that.

import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(__dirname, '..', '..');
const TARGET_URL = 'https://seobandwagon.com/local-seo';
const CAPTURES_ENDPOINT = 'https://seobandwagon.com/api/v1/captures';

test('canary: analyze local-seo and POST capture to production', async () => {
  // Launch Chromium with the extension loaded. Must run in headful mode —
  // Playwright's default `chromium-headless-shell` doesn't support MV3
  // service workers. CI wraps this in xvfb-run to provide a virtual display.
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox'
    ]
  });

  try {
    // Wait for the service worker to come up (MV3 SWs are lazy).
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    }
    const extensionId = serviceWorker.url().split('/')[2];
    expect(extensionId).toMatch(/^[a-p]{32}$/); // Chrome extension IDs are 32 lowercase a-p

    // Open the target page.
    const page = await context.newPage();
    await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 30_000 });

    // Give the page ~1s to hydrate Next.js client components so the DOM is
    // representative of what a human would see.
    await page.waitForTimeout(1_000);

    // Get the active tab ID from the service worker.
    const tabId = await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs[0]?.id;
    });
    expect(tabId).toBeTruthy();

    // Inject the extension's scripts into the tab — same load order popup.js uses.
    await serviceWorker.evaluate(async (id) => {
      await chrome.scripting.executeScript({
        target: { tabId: id },
        files: ['lib/content-analysis.js', 'lib/dom-extraction.js', 'content.js']
      });
    }, tabId);

    // Ask the content script to analyze the page, wait up to 10s.
    const capture = await serviceWorker.evaluate(async (id) => {
      return await chrome.tabs.sendMessage(id, { action: 'analyze' });
    }, tabId);

    // Basic shape assertions on the analyzed payload.
    expect(capture).toBeTruthy();
    expect(capture.url).toContain('seobandwagon.com');
    expect(capture.meta).toBeTruthy();
    expect(capture.meta.title).toBeTruthy();
    expect(capture.meta.title.text.length).toBeGreaterThan(0);
    expect(capture.content).toBeTruthy();
    expect(capture.content.wordCount).toBeGreaterThan(0);
    expect(capture.seoScore).toBeTruthy();
    expect(typeof capture.seoScore.score).toBe('number');
    expect(capture.seoScore.score).toBeGreaterThanOrEqual(0);
    expect(capture.seoScore.score).toBeLessThanOrEqual(100);

    // POST the capture to production. Accepts 201 (new) or 409 (already
    // captured within the 1h dedupe window on the backend).
    const response = await page.request.post(CAPTURES_ENDPOINT, {
      data: capture,
      headers: { 'Content-Type': 'application/json' }
    });
    expect([201, 409]).toContain(response.status());

    if (response.status() === 201) {
      const body = await response.json();
      expect(body.id).toBeTruthy();
      expect(body.url).toContain('seobandwagon.com');
      console.log(`[canary] capture created: id=${body.id}`);
    } else {
      console.log('[canary] 409 — already captured within the last hour (expected on close-timing reruns)');
    }
  } finally {
    await context.close();
  }
});
