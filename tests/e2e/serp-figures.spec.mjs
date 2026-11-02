// The figures under each Google result (1.11.0) in a real browser with the
// extension loaded: saved Google pages, and seobandwagon.com's
// POST /api/v1/serp/metrics answered from the saved answers in
// tests/fixtures/serp-metrics.
//
// Nothing reaches Google, seobandwagon.com or any other host. Chromium's
// resolver points every host nowhere (--host-resolver-rules); the route
// answers www.google.com/search from disk and the API paths from the stub,
// and aborts everything else. No secrets, no production.
//
// What this verifies, in order:
//   1. Signed out of SEO Bandwagon: each bar has its position, Analyze and
//      "Connect free to see figures", and nothing is sent.
//   2. With a key, before the figures are accepted: "Turn on figures", and
//      still nothing is sent to /v1/serp/metrics.
//   3. Accepted with the button in Options (the specific action): the
//      results' addresses and sites go, never the search, and the figures,
//      the plan and the allowance show; the popup's results panel shows the
//      search's features, the account and the allowance.
//   4. The same search again this session sends nothing (the session keeps
//      the figures).
//   5. A key without the `serp` scope (403) says Reconnect; the allowance
//      reached says so and offers the upgrade; paused at the monthly ceiling
//      says so; offline says so. Position and Analyze work through all.
//   6. Signed out of Google, a row known only by its site gets the site's
//      figures and "sign in to Google to see page figures", and no request
//      goes to Google to find its page.
//   7. The panel moves to the top of the results by setting.
// When SBW_SCREENSHOTS names a folder, it also saves the overlay in Match
// Google light and dark, Night and Day there (for the PR, not the store).

import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(__dirname, '..', '..', 'extension');
const FIXTURES = resolve(__dirname, '..', 'fixtures');
const KEY = 'sbw_' + 'fedcba9876543210'.repeat(3);
const SHOTS = process.env.SBW_SCREENSHOTS || '';

const PAGES = {
  'best crm for nonprofits': 'serp-google-commercial-query.html',
  'seo chrome extension': 'serp-google-goto-links.html'
};
const searchUrl = (q) => `https://www.google.com/search?q=${q.replace(/ /g, '+')}`;
const saved = (name) => JSON.parse(readFileSync(resolve(FIXTURES, 'serp-metrics', name + '.json'), 'utf8'));

// An answer for exactly the results asked for, in the route's shape: every
// result gets the first saved result's figures (its page block only when
// it was sent with an address), so each bar has something to show.
function answerFor(body, name) {
  const base = saved(name);
  const [withPage, siteOnly] = base.results;
  return Object.assign({}, base, {
    results: body.results.map((r) => Object.assign({}, r.url ? withPage : siteOnly, { url: r.url, host: r.domain }))
  });
}

test('figures under Google results: signed out, accepted, cached, every refusal, signed out of Google, top', async () => {
  test.setTimeout(180_000);
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--host-resolver-rules=MAP * ~NOTFOUND'
    ]
  });

  const metricsCalls = []; // bodies sent to /v1/serp/metrics
  const googleOther = [];  // any Google request that isn't a saved search page
  const other = [];        // everything else the route saw, aborted
  let mode = 'done';
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === 'www.google.com' && url.pathname === '/search' && PAGES[url.searchParams.get('q')]) {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: readFileSync(resolve(FIXTURES, PAGES[url.searchParams.get('q')])) });
    }
    if (url.origin === 'https://seobandwagon.com' && url.pathname === '/api/v1/me') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'owner@example.com', scopes: ['captures', 'serp'] }) });
    }
    if (url.origin === 'https://seobandwagon.com' && url.pathname === '/api/v1/serp/metrics') {
      const body = JSON.parse(req.postData() || '{}');
      metricsCalls.push(body);
      if (mode === 'offline') return route.abort('internetdisconnected');
      if (mode === 'forbidden') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'insufficient_scope', required: 'serp' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answerFor(body, mode)) });
    }
    if (!/^https?:$/.test(url.protocol)) return route.continue();
    if (/(^|\.)google\./.test(url.hostname)) googleOther.push(url.href);
    other.push(url.href);
    return route.abort();
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    const bars = page.locator('.sbw-serp-bar');
    const figures = (n) => bars.nth(n).locator('[data-role="figures"]');
    // Each case starts from an empty session: the worker keeps figures for
    // the session, which is what step 4 checks.
    const freshSession = () => worker.evaluate(() => chrome.storage.session.clear());
    const open = async (q) => {
      await page.goto(searchUrl(q), { waitUntil: 'load' });
      await expect(bars.first()).toBeVisible();
    };

    await test.step('signed out of SEO Bandwagon: position, Analyze and "Connect free to see figures"; nothing sent', async () => {
      await open('best crm for nonprofits');
      await expect(bars).toHaveCount(6);
      await expect(bars.first().locator('.sbw-serp-pos')).toHaveText('#1');
      await expect(bars.first().locator('.sbw-serp-analyze')).toHaveText('Analyze');
      await expect(figures(0)).toHaveText('Connect free to see figures');
      expect(metricsCalls).toEqual([]);
    });

    await test.step('with a key, not accepted yet: "Turn on figures", and still nothing sent', async () => {
      await worker.evaluate((key) => chrome.storage.sync.set({ apiKey: key }), KEY);
      await open('best crm for nonprofits');
      await expect(figures(0)).toHaveText('Turn on figures');
      expect(metricsCalls).toEqual([]);
    });

    await test.step('accepted in Options with its own button: the addresses go, never the search, and the figures show', async () => {
      const options = await context.newPage();
      await options.goto(`chrome-extension://${id}/src/options/options.html#google-results`);
      await expect(options.locator('#serpConsentStatus')).toHaveText('Not turned on: nothing is sent.');
      await options.locator('#serpConsentAccept').click();
      await expect(options.locator('#serpConsentStatus')).toContainText('result addresses are sent for figures');
      await options.close();

      await open('best crm for nonprofits');
      await expect(figures(1)).toContainText('412 ref. domains');
      await expect(bars.nth(1).locator('.sbw-fig-source')).toHaveText('DataForSEO');
      await expect(figures(1)).toContainText('age 28y 1m');
      await expect(page.locator('[data-role="figures-line"]')).toContainText('Free plan: 17 of 20 searches with new figures left today');
      expect(metricsCalls).toHaveLength(1);
      expect(metricsCalls[0].results).toHaveLength(6);
      metricsCalls[0].results.forEach((r) => {
        expect(Object.keys(r).sort()).toEqual(['domain', 'url']);
        expect(new URL(r.url).hostname.replace(/^www\./, '')).toMatch(new RegExp(r.domain.replace(/\./g, '\\.') + '$'));
      });
      expect(JSON.stringify(metricsCalls)).not.toMatch(/crm\+for|crm for nonprofits|q=/);
    });

    await test.step('the popup on the results page shows the search\'s features, the account and the allowance', async () => {
      const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.google.com/search*' }))[0].id);
      const popup = await context.newPage();
      // Opened as a page, the popup's active tab is itself, so its results
      // panel is drawn for the results tab the way popup.js draws it.
      await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
      await popup.evaluate(async (tabId) => {
        const tab = await chrome.tabs.get(tabId);
        await globalThis.SBWSerpPanel.render(document.getElementById('content'), tab);
      }, tabId);
      await expect(popup.locator('#serpNoticeText')).toContainText('Found 6 results');
      await expect(popup.locator('.srp-feature[data-present="true"]').first()).toContainText('People also ask');
      await expect(popup.locator('#serpAccount')).toContainText('Free plan: 17 of 20 searches with new figures left today');
      await popup.close();
    });

    await test.step('the same search again this session sends nothing', async () => {
      await open('best crm for nonprofits');
      await expect(figures(1)).toContainText('412 ref. domains');
      expect(metricsCalls).toHaveLength(1);
    });

    if (SHOTS) {
      await test.step('screenshots: Match Google light and dark, Night, Day', async () => {
        mkdirSync(SHOTS, { recursive: true });
        const shot = async (name) => {
          await page.waitForTimeout(300);
          const box = await page.locator('#rso').boundingBox();
          await page.screenshot({ path: join(SHOTS, name + '.png'), clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y), width: Math.min(760, box.width + 32), height: 560 } });
        };
        await shot('match-google-light');
        await page.evaluate(() => { document.documentElement.style.background = '#1f1f1f'; document.body.style.background = '#1f1f1f'; document.body.style.color = '#e3e3e3'; });
        await page.reload({ waitUntil: 'load' });
        await page.evaluate(() => { document.documentElement.style.background = '#1f1f1f'; document.body.style.background = '#1f1f1f'; document.body.style.color = '#e3e3e3'; });
        // Match Google reads Google's page when it draws; a dark Google page
        // is stood in for by the saved page with a dark ground.
        await worker.evaluate(() => chrome.storage.local.get('serpSettings').then(({ serpSettings }) => chrome.storage.local.set({ serpSettings: Object.assign({}, serpSettings, { look: 'google', collapsed: !!(serpSettings && serpSettings.collapsed) }) })));
        await page.evaluate(() => document.querySelectorAll('[data-sbw-look]').forEach((el) => el.setAttribute('data-sbw-look', 'google-dark')));
        await shot('match-google-dark');
        await page.reload({ waitUntil: 'load' });
        for (const look of ['dark', 'light']) {
          await worker.evaluate((look) => chrome.storage.local.get('serpSettings').then(({ serpSettings }) => chrome.storage.local.set({ serpSettings: Object.assign({}, serpSettings, { look }) })), look);
          await expect(bars.first()).toHaveAttribute('data-sbw-look', look);
          await shot(look === 'dark' ? 'night' : 'day');
        }
        await worker.evaluate(() => chrome.storage.local.get('serpSettings').then(({ serpSettings }) => chrome.storage.local.set({ serpSettings: Object.assign({}, serpSettings, { look: 'google' }) })));
      });
    }

    await test.step('a key without the serp scope (403) says Reconnect', async () => {
      await freshSession();
      mode = 'forbidden';
      await open('best crm for nonprofits');
      await expect(figures(0)).toHaveText(/^Reconnect to see figures/);
      await expect(bars.first().locator('.sbw-serp-analyze')).toBeVisible();
    });

    await test.step('the allowance reached: the bar and the panel say so and offer the upgrade', async () => {
      await freshSession();
      mode = 'limit-reached';
      await open('best crm for nonprofits');
      await expect(figures(0)).toContainText('No figures: today’s limit is reached');
      await expect(figures(0).locator('button')).toHaveText('Upgrade');
      await expect(page.locator('[data-role="figures-line"]')).toContainText('searches with new figures are used');
    });

    await test.step('paused at the monthly ceiling: says so, no upgrade', async () => {
      await freshSession();
      mode = 'paused';
      await open('best crm for nonprofits');
      await expect(figures(0)).toHaveText('New figures paused until next month');
      await expect(page.locator('.sbw-serp-tools button', { hasText: 'Upgrade' })).toHaveCount(0);
    });

    await test.step('offline: says so; position and Analyze still work', async () => {
      await freshSession();
      mode = 'offline';
      await open('best crm for nonprofits');
      await expect(figures(0)).toHaveText(/^Offline/);
      await expect(bars.first().locator('.sbw-serp-pos')).toHaveText('#1');
    });

    await test.step('signed out of Google: a row known only by its site gets the site\'s figures, and nothing asks Google', async () => {
      await freshSession();
      mode = 'done';
      const before = metricsCalls.length;
      await open('seo chrome extension');
      const sent = metricsCalls.slice(before).flatMap((c) => c.results);
      const siteOnly = sent.filter((r) => r.url === null);
      expect(siteOnly.length).toBeGreaterThan(0);
      const n = await bars.count();
      let checked = 0;
      for (let i = 0; i < n; i++) {
        const t = await figures(i).textContent();
        if (t.includes('sign in to Google to see page figures')) {
          expect(t).toContain('Site');
          expect(t).not.toContain('Page');
          checked++;
        }
      }
      expect(checked).toBe(siteOnly.length);
      // The saved page loads Google's own logo; what must never happen is
      // a request through Google's redirects to find a hidden result's page.
      expect(googleOther.filter((u) => /\/(goto|url)\?/.test(new URL(u).pathname + '?'))).toEqual([]);
    });

    await test.step('the panel moves above the results by setting, and pushes them down', async () => {
      await worker.evaluate(() => chrome.storage.local.get('serpSettings').then(({ serpSettings }) => chrome.storage.local.set({ serpSettings: Object.assign({}, serpSettings, { placement: 'top' }) })));
      await expect(page.locator('.sbw-serp-tools')).toHaveAttribute('data-placement', 'top');
      const [panel, results] = await Promise.all([page.locator('.sbw-serp-tools').boundingBox(), page.locator('#rso').boundingBox()]);
      expect(panel.y + panel.height).toBeLessThanOrEqual(results.y + 1);
    });

    // Nothing else went to seobandwagon.com but the welcome tab a first
    // install opens (aborted here).
    expect(other.filter((u) => /seobandwagon\.com/.test(u) && !/\/seo-chrome-extension\/welcome/.test(u))).toEqual([]);
  } finally {
    await context.close();
  }
});
