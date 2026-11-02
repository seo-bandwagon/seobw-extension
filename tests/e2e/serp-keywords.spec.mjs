// Keyword data on Google (1.13.0) in a real browser with the extension
// loaded: the saved commercial-query page (its related searches and People
// also ask), and seobandwagon.com's POST /api/v1/keywords/metrics and
// POST /api/v1/keywords answered from the saved answers in
// tests/fixtures/keyword-metrics and inline.
//
// Nothing reaches Google, seobandwagon.com or any other host. Chromium's
// resolver points every host nowhere (--host-resolver-rules); the route
// answers www.google.com/search from disk and the API paths from the stub,
// and aborts everything else. No secrets, no production.
//
// What this verifies, in order:
//   1. Signed out of SEO Bandwagon: the strip says "Connect free", the bars
//      keep their position and Analyze, and nothing is sent.
//   2. With a key, before the yes: "Show keyword data" shows the disclosure;
//      "Not now" sends nothing.
//   3. The yes (a real click): it is recorded by the consent module, and one
//      request goes with the search first, its related searches and
//      questions, and the market, never a result's address; the figures,
//      DataForSEO's label, the allowance and the labels beside Google's
//      related searches and questions show; the keywords CSV downloads.
//   4. The same search again this session sends nothing.
//   5. "Add to my keywords": added, already tracked, no tracker (a link to
//      the dashboard), which tracker (the choice is sent with its id).
//   6. A tracked search: the tracked site's bar shows its rank history.
//   7. A 403 says Reconnect; the allowance reached says so and offers the
//      upgrade; paused says so; offline says so. Position and Analyze work
//      through all.
//   8. With the page, by setting: loads without a click.
//   9. The popup's results panel reads it.
// When SBW_SCREENSHOTS names a folder, it also saves the strip in Match
// Google light and dark, Night and Day there (for the PR, not the store).

import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(__dirname, '..', '..', 'extension');
const FIXTURES = resolve(__dirname, '..', 'fixtures');
const KEY = 'sbw_' + '0123456789abcdef'.repeat(3);
const SHOTS = process.env.SBW_SCREENSHOTS || '';
const QUERY = 'best crm for nonprofits';
const SEARCH_URL = 'https://www.google.com/search?q=best+crm+for+nonprofits&gl=us&hl=en';

const saved = (name) => JSON.parse(readFileSync(resolve(FIXTURES, 'keyword-metrics', name + '.json'), 'utf8'));

// The saved answer, with the tracked site one of the saved page's results.
function metricsAnswer(name) {
  const a = saved(name);
  if (a.tracked) a.tracked.domain = 'givebutter.com';
  return a;
}

test('keyword data on Google: signed out, the yes, cached, add, tracked, every refusal, with the page, popup', async () => {
  test.setTimeout(180_000);
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--host-resolver-rules=MAP * ~NOTFOUND'
    ]
  });

  const metricsCalls = []; // bodies sent to /v1/keywords/metrics
  const addCalls = [];     // bodies sent to /v1/keywords
  const googleOther = [];
  const other = [];
  let mode = 'done';
  let addMode = 'added';
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === 'www.google.com' && url.pathname === '/search' && url.searchParams.get('q') === QUERY) {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: readFileSync(resolve(FIXTURES, 'serp-google-commercial-query.html')) });
    }
    if (url.origin === 'https://seobandwagon.com' && url.pathname === '/api/v1/me') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'owner@example.com', scopes: ['captures', 'serp', 'keywords'] }) });
    }
    if (url.origin === 'https://seobandwagon.com' && url.pathname === '/api/v1/keywords/metrics') {
      metricsCalls.push(JSON.parse(req.postData() || '{}'));
      if (mode === 'offline') return route.abort('internetdisconnected');
      if (mode === 'forbidden') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'insufficient_scope', required: 'keywords' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(metricsAnswer(mode)) });
    }
    if (url.origin === 'https://seobandwagon.com' && url.pathname === '/api/v1/keywords') {
      const body = JSON.parse(req.postData() || '{}');
      addCalls.push(body);
      const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (addMode === 'already') return json(200, { alreadyTracked: true, trackerId: 'trk_1' });
      if (addMode === 'no_tracker') return json(409, { error: 'no_tracker' });
      if (addMode === 'choose_tracker' && !body.trackerId) return json(409, { error: 'choose_tracker', trackers: [{ id: 'trk_1', domain: 'example.org' }, { id: 'trk_2', domain: 'example.net' }] });
      return json(201, { trackerId: body.trackerId || 'trk_1', keyword: body.keyword });
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
    const strip = page.locator('.sbw-serp-keywords');
    const bars = page.locator('.sbw-serp-bar');
    const freshSession = () => worker.evaluate(() => chrome.storage.session.clear());
    const setSettings = (patch) => worker.evaluate((patch) => chrome.storage.local.get('serpSettings')
      .then(({ serpSettings }) => chrome.storage.local.set({ serpSettings: Object.assign({}, serpSettings, patch) })), patch);
    const open = async () => {
      await page.goto(SEARCH_URL, { waitUntil: 'load' });
      await expect(bars.first()).toBeVisible();
      await expect(strip).toBeVisible();
    };
    const show = async () => {
      await strip.getByRole('button', { name: 'Show keyword data' }).click();
      await expect(strip.locator('[data-kw="volume"]')).toBeVisible();
    };

    await test.step('signed out of SEO Bandwagon: "Connect free", position and Analyze, nothing sent', async () => {
      await open();
      await expect(strip.getByRole('button', { name: 'Connect free' })).toBeVisible();
      await expect(bars.first().locator('.sbw-serp-pos')).toHaveText('#1');
      await expect(bars.first().locator('.sbw-serp-analyze')).toHaveText('Analyze');
      expect(metricsCalls).toEqual([]);
    });

    await test.step('with a key, before the yes: the disclosure; "Not now" sends nothing', async () => {
      await worker.evaluate((key) => chrome.storage.sync.set({ apiKey: key }), KEY);
      await open();
      await strip.getByRole('button', { name: 'Show keyword data' }).click();
      const disclosure = strip.locator('[data-role="kw-disclosure"]');
      await expect(disclosure).toContainText('Keyword data sends SEO Bandwagon the words of this search');
      await expect(disclosure).toContainText('Never a result’s address with them, and never a request to Google');
      await strip.getByRole('button', { name: 'Not now' }).click();
      await expect(strip).toContainText('Keyword data is off: it sends this search to SEO Bandwagon.');
      expect(metricsCalls).toEqual([]);
    });

    await test.step('the yes: recorded, then one request with the search first and the market, never an address', async () => {
      await strip.getByRole('button', { name: 'Turn on keyword data' }).click();
      await strip.getByRole('button', { name: 'Yes, send my searches for keyword data' }).click();
      await expect(strip.locator('[data-kw="volume"]')).toHaveText('2.9K searches/mo');
      const consent = await worker.evaluate(() => chrome.storage.local.get('sbwConsent').then((r) => r.sbwConsent));
      expect(consent.keywordData).toMatchObject({ version: 1 });
      expect(consent.serpFigures).toBeUndefined();
      expect(metricsCalls).toHaveLength(1);
      const body = metricsCalls[0];
      expect(Object.keys(body).sort()).toEqual(['gl', 'hl', 'keywords']);
      expect(body).toMatchObject({ gl: 'us', hl: 'en' });
      expect(body.keywords[0]).toBe(QUERY);
      expect(body.keywords).toContain('best crm for nonprofits reddit');
      expect(body.keywords).toContain('what is the 33 rule for nonprofits');
      expect(JSON.stringify(body)).not.toMatch(/https?:|\.com|\.org/);
      await expect(strip.locator('.sbw-fig-source')).toHaveText('DataForSEO');
      await expect(strip.locator('[data-role="kw-allowance"]')).toContainText('Free plan: 16 of 20 searches with new keyword data left today (UTC).');
      await expect(page.locator('.b2Rnsc .sbw-kw-badge').first()).toHaveText('170/mo');
      await expect(page.locator('[data-q="What is the 33% rule for nonprofits?"] .sbw-kw-badge')).toHaveText('1K/mo');
      await expect(strip.locator('[data-role="kw-more"] tbody tr')).toHaveCount(12);
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        strip.getByRole('button', { name: 'Export keywords CSV' }).click()
      ]);
      expect(download.suggestedFilename()).toMatch(/^serp-keywords-best-crm-for-nonprofits-\d{4}-\d{2}-\d{2}\.csv$/);
    });

    await test.step('the same search again this session sends nothing', async () => {
      await open();
      await show();
      expect(metricsCalls).toHaveLength(1);
    });

    await test.step('Options: the card shows the yes; Stop withdraws it and the page asks again; its button gives it back', async () => {
      const options = await context.newPage();
      await options.goto(`chrome-extension://${id}/src/options/options.html#keyword-data`);
      await expect(options.locator('#kwConsentStatus')).toContainText('your searches are sent for keyword data when you ask for it');
      await options.locator('#kwConsentWithdraw').click();
      await expect(options.locator('#kwConsentStatus')).toHaveText('Not turned on: no search is sent.');
      await page.bringToFront();
      await open();
      await strip.getByRole('button', { name: 'Show keyword data' }).click();
      await expect(strip.locator('[data-role="kw-disclosure"]')).toBeVisible();
      await options.bringToFront();
      await options.locator('#kwConsentAccept').click();
      await expect(options.locator('#kwConsentStatus')).toContainText('your searches are sent for keyword data');
      await options.close();
      // The open page goes on by itself, from the session's keyword data.
      await expect(strip.locator('[data-kw="volume"]')).toHaveText('2.9K searches/mo');
      expect(metricsCalls).toHaveLength(1);
    });

    if (SHOTS) {
      await test.step('screenshots: Match Google light and dark, Night, Day', async () => {
        mkdirSync(SHOTS, { recursive: true });
        // Google's results column is about 650 px; the saved page has none.
        const column = () => page.evaluate(() => { document.body.style.maxWidth = '652px'; document.body.style.marginLeft = '24px'; document.body.style.fontFamily = 'Arial, sans-serif'; });
        await column();
        const shot = async (name) => {
          await page.waitForTimeout(300);
          const box = await strip.boundingBox();
          await page.screenshot({ path: join(SHOTS, 'keywords-' + name + '.png'), clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 12), width: box.width + 32, height: Math.min(720, box.height + 24) } });
        };
        await shot('match-google-light');
        await page.evaluate(() => {
          document.documentElement.style.background = '#1f1f1f'; document.body.style.background = '#1f1f1f'; document.body.style.color = '#e3e3e3';
          document.querySelectorAll('[data-sbw-look]').forEach((el) => el.setAttribute('data-sbw-look', 'google-dark'));
        });
        await shot('match-google-dark');
        await page.reload({ waitUntil: 'load' });
        await column();
        await show();
        for (const look of ['dark', 'light']) {
          await setSettings({ look });
          await expect(strip).toHaveAttribute('data-sbw-look', look);
          await shot(look === 'dark' ? 'night' : 'day');
        }
        await setSettings({ look: 'google' });
      });
    }

    await test.step('"Add to my keywords": added, already tracked, no tracker, which tracker', async () => {
      await open();
      await show();
      await strip.getByRole('button', { name: 'Add to my keywords' }).click();
      await expect(strip.locator('[data-role="kw-add-message"]')).toContainText('Added to your rank tracker');
      await expect(strip.locator('.sbw-kw-head .sbw-kw-add')).toHaveText('Added');
      expect(addCalls.at(-1)).toEqual({ keyword: QUERY, gl: 'us', hl: 'en' });

      addMode = 'already';
      const row = strip.locator('[data-role="kw-more"] tr[data-keyword="salesforce for nonprofits"]');
      await row.getByRole('button', { name: '+ Add' }).click();
      await expect(row.locator('button')).toHaveText('In your tracker');

      addMode = 'no_tracker';
      await strip.locator('[data-role="kw-more"] tr[data-keyword="zoho crm for nonprofits"]').getByRole('button', { name: '+ Add' }).click();
      await expect(strip.locator('[data-role="kw-add-message"]')).toContainText('You have no rank tracker yet');
      await strip.getByRole('button', { name: 'Create a rank tracker' }).click();
      await expect.poll(() => other.some((u) => new URL(u).pathname === '/dashboard/rank-tracker')).toBe(true);

      addMode = 'choose_tracker';
      await strip.locator('[data-role="kw-more"] tr[data-keyword="what is the 33 rule for nonprofits"]').getByRole('button', { name: '+ Add' }).click();
      await expect(strip.locator('[data-role="kw-add-message"]')).toContainText('to which rank tracker?');
      await strip.getByRole('button', { name: 'example.net' }).click();
      await expect(strip.locator('[data-role="kw-add-message"]')).toContainText('Added to your rank tracker');
      expect(addCalls.at(-1)).toEqual({ keyword: 'what is the 33 rule for nonprofits', gl: 'us', hl: 'en', trackerId: 'trk_2' });
      addMode = 'added';
    });

    await test.step('a tracked search: the tracked site\'s bar shows its rank history', async () => {
      await freshSession();
      mode = 'tracked';
      await open();
      await show();
      await expect(strip.locator('[data-role="kw-tracked"]')).toContainText('givebutter.com: #4, ▲ 5 since 2026-10-05');
      const tracked = page.locator('.sbw-serp-bar[data-domain="givebutter.com"] .sbw-kw-tracked');
      await expect(tracked).toContainText('your tracker #4, ▲ 5 since 2026-10-05');
      await expect(page.locator('.sbw-serp-bar[data-domain="reddit.com"] .sbw-kw-tracked')).toHaveCount(0);
    });

    await test.step('a key without the keywords scope (403) says Reconnect', async () => {
      await freshSession();
      mode = 'forbidden';
      await open();
      await strip.getByRole('button', { name: 'Show keyword data' }).click();
      await expect(strip).toContainText('Reconnect to see keyword data');
      await expect(bars.first().locator('.sbw-serp-analyze')).toBeVisible();
    });

    await test.step('the allowance reached: says so and offers the upgrade', async () => {
      await freshSession();
      mode = 'limit-reached';
      await open();
      await show();
      await expect(strip.locator('[data-role="kw-allowance"]')).toContainText('searches with new keyword data are used');
      await expect(strip.getByRole('button', { name: 'Upgrade for more keyword data' })).toBeVisible();
    });

    await test.step('paused at the monthly ceiling: says so, no upgrade', async () => {
      await freshSession();
      mode = 'paused';
      await open();
      await strip.getByRole('button', { name: 'Show keyword data' }).click();
      await expect(strip).toContainText('New keyword data is paused for everyone until next month');
      await expect(strip.getByRole('button', { name: 'Upgrade for more keyword data' })).toHaveCount(0);
    });

    await test.step('offline: says so; position and Analyze still work', async () => {
      await freshSession();
      mode = 'offline';
      await open();
      await strip.getByRole('button', { name: 'Show keyword data' }).click();
      await expect(strip).toContainText('Offline: no keyword data until SEO Bandwagon can be reached');
      await expect(bars.first().locator('.sbw-serp-pos')).toHaveText('#1');
    });

    await test.step('with the page, by setting: loads without a click', async () => {
      // Off the results page first, so only the next one loads.
      await page.goto('about:blank');
      await freshSession();
      mode = 'done';
      await setSettings({ keywordsLoad: 'auto' });
      const before = metricsCalls.length;
      await open();
      await expect(strip.locator('[data-kw="volume"]')).toHaveText('2.9K searches/mo');
      expect(metricsCalls.length).toBe(before + 1);
      await setSettings({ keywordsLoad: 'click' });
    });

    await test.step('the popup on the results page reads keyword data', async () => {
      const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.google.com/search*' }))[0].id);
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
      await popup.evaluate(async (tabId) => {
        const tab = await chrome.tabs.get(tabId);
        await globalThis.SBWSerpPanel.render(document.getElementById('content'), tab);
      }, tabId);
      await expect(popup.locator('#serpKeywords')).toContainText('This search: 2.9K searches a month, difficulty 47/100, CPC $18.42, competition High (DataForSEO).');
      await expect(popup.locator('#serpKeywords')).toContainText('Free plan: 16 of 20 searches with new keyword data left today (UTC).');
      await popup.close();
    });

    // Never a request to Google beyond the saved page and its own assets.
    expect(googleOther.filter((u) => /\/(search|goto|url)\?/.test(new URL(u).pathname + '?'))).toEqual([]);
    // Nothing else went to seobandwagon.com but the welcome tab a first
    // install opens and the dashboard tab opened above (both aborted here).
    expect(other.filter((u) => /seobandwagon\.com/.test(u) && !/\/seo-chrome-extension\/welcome|\/dashboard\/rank-tracker/.test(u))).toEqual([]);
  } finally {
    await context.close();
  }
});
