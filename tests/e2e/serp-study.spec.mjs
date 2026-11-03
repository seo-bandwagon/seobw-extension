// The AI Overview study's send (1.13.3) in a real browser with the extension
// loaded: the saved signed-out Google page for "how does seo work", and
// seobandwagon.com's study API answered from stubs.
//
// Nothing reaches Google, seobandwagon.com or any other host. Chromium's
// resolver points every host nowhere (--host-resolver-rules); the route
// answers www.google.com/search from disk and the API paths from the stub,
// and aborts everything else. No secrets, no production.
//
// What this verifies, in order:
//   1. A key; figures and keyword data accepted and set to load with the
//      page; "Turn on study sends" clicked in Options.
//   2. The popup's STUDY tab shows the day's one term, "To do". Search
//      refuses with the incognito words (Playwright's Chromium does not
//      allow the extension in private windows): no page or window opens and
//      no request goes to Google.
//   3. Standing in for the private window (the worker's record of a study
//      tab, written for a normal tab): the same page in a normal tab sends
//      figures and keyword data, and in the study tab sends neither. The
//      study group shows "AI Overview: loaded".
//   4. Send to study: one POST to /aio-study/captures with { term_id, csv };
//      the CSV is the saved page's export with no figure or keyword column
//      filled; the status reads "Sent to the study."
//   5. Google stopped me: one POST to /aio-study/stop.

import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(__dirname, '..', '..', 'extension');
const FIXTURES = resolve(__dirname, '..', 'fixtures');
const KEY = 'sbw_' + '0123456789abcdef'.repeat(3);
const VERSION = JSON.parse(readFileSync(resolve(EXTENSION_PATH, 'manifest.json'), 'utf8')).version;

const KEYWORD = 'how does seo work';
const TERM_ID = 'soft-howwhy-01';
const STUDY_URL = 'https://www.google.com/search?q=how+does+seo+work&hl=en&gl=us&pws=0';
const CITED = 'https://digitalmarketinginstitute.com/blog/what-is-seo';
const INCOGNITO_OFF = "SEO Bandwagon isn't allowed in private windows";
const TODAY = new Date().toISOString().slice(0, 10); // the site's day is UTC

const saved = (dir, name) => JSON.parse(readFileSync(resolve(FIXTURES, dir, name + '.json'), 'utf8'));

// The figures route's saved answer, with every result sent given the first
// saved result's figures (the same way serp-figures.spec.mjs does).
function figuresAnswer(body) {
  const base = saved('serp-metrics', 'done');
  const [withPage, siteOnly] = base.results;
  return Object.assign({}, base, {
    results: body.results.map((r) => Object.assign({}, r.url ? withPage : siteOnly, { url: r.url, host: r.domain }))
  });
}

// A CSV file as rows of cells. Cells may hold commas, quotes ("" inside a
// quoted cell) and line breaks; the file starts with a byte order mark.
function parseCsv(text) {
  const src = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// The rows of a parsed CSV as objects keyed by header name.
function recordsOf(csv) {
  const [header, ...rest] = parseCsv(csv);
  return {
    header,
    records: rest.map((cells) => {
      expect(cells).toHaveLength(header.length);
      return Object.fromEntries(header.map((name, i) => [name, cells[i]]));
    })
  };
}

test('study send: accept, popup refuses without a private window, a study tab sends nothing else, Send to study, Google stopped me', async () => {
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

  const figuresCalls = [];  // bodies sent to /v1/serp/metrics
  const keywordCalls = [];  // bodies sent to /v1/keywords/metrics
  const captures = [];      // bodies sent to /v1/aio-study/captures
  const stops = [];         // bodies sent to /v1/aio-study/stop
  const searchHits = [];    // addresses the route answered from the saved page
  const googleRequests = []; // every request to a Google host, answered or aborted
  const other = [];         // everything else the route saw, aborted
  let sent = false;         // the stubbed site has the day's term
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (/(^|\.)google\./.test(url.hostname)) googleRequests.push(url.href);
    if (url.hostname === 'www.google.com' && url.pathname === '/search' && url.searchParams.get('q') === KEYWORD) {
      searchHits.push(url.href);
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: readFileSync(resolve(FIXTURES, 'serp-google-aio-signed-out.html')) });
    }
    if (url.origin === 'https://seobandwagon.com' && url.pathname === '/api/v1/me') {
      return json(200, { email: 'owner@example.com', scopes: ['captures', 'serp', 'keywords'] });
    }
    if (url.origin === 'https://seobandwagon.com' && url.pathname === '/api/v1/aio-study/today') {
      return json(200, { enrolled: true, week: 0, paused: false, date: TODAY, terms: [{ term_id: TERM_ID, keyword: KEYWORD, status: sent ? 'sent' : 'open' }] });
    }
    if (url.origin === 'https://seobandwagon.com' && url.pathname === '/api/v1/aio-study/captures') {
      captures.push(JSON.parse(req.postData() || '{}'));
      sent = true;
      return json(201, { ok: true });
    }
    if (url.origin === 'https://seobandwagon.com' && url.pathname === '/api/v1/aio-study/stop') {
      stops.push(JSON.parse(req.postData() || '{}'));
      return json(200, { ok: true, carried: 0 });
    }
    if (url.origin === 'https://seobandwagon.com' && url.pathname === '/api/v1/serp/metrics') {
      const body = JSON.parse(req.postData() || '{}');
      figuresCalls.push(body);
      return json(200, figuresAnswer(body));
    }
    if (url.origin === 'https://seobandwagon.com' && url.pathname === '/api/v1/keywords/metrics') {
      keywordCalls.push(JSON.parse(req.postData() || '{}'));
      return json(200, saved('keyword-metrics', 'done'));
    }
    if (!/^https?:$/.test(url.protocol)) return route.continue();
    other.push(url.href);
    return route.abort();
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    const id = new URL(worker.url()).host;
    const setSettings = (patch) => worker.evaluate((patch) => chrome.storage.local.get('serpSettings')
      .then(({ serpSettings }) => chrome.storage.local.set({ serpSettings: Object.assign({}, serpSettings, patch) })), patch);

    await test.step('a key; figures and keyword data accepted and set to load with the page; study sends turned on', async () => {
      await worker.evaluate((key) => chrome.storage.sync.set({ apiKey: key }), KEY);

      const options = await context.newPage();
      await options.goto(`chrome-extension://${id}/src/options/options.html#google-results`);
      await options.locator('#serpConsentAccept').click();
      await expect(options.locator('#serpConsentStatus')).toContainText('result addresses are sent for figures');
      await options.locator('#kwConsentAccept').click();
      await expect(options.locator('#kwConsentStatus')).toContainText('your searches are sent for keyword data');
      await setSettings({ overlay: true, figuresOn: true, load: 'auto', keywordsOn: true, keywordsLoad: 'auto' });

      await options.goto(`chrome-extension://${id}/src/options/options.html#aio-study`);
      await expect(options.locator('#aioStudyStatus')).toHaveText('Not turned on: nothing is sent to the study.');
      await options.locator('#aioStudyAccept').click();
      await expect(options.locator('#aioStudyStatus')).toContainText('a study search is sent only when you click Send to study');
      await options.close();

      const consent = await worker.evaluate(() => chrome.storage.local.get('sbwConsent').then((r) => r.sbwConsent));
      expect(consent.aioStudy).toMatchObject({ version: 1 });
    });

    await test.step('the popup\'s STUDY tab lists the term "To do"; Search refuses without a private window and opens nothing', async () => {
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
      const studyTab = popup.locator('button[data-tab="study"]');
      await expect(studyTab).toBeVisible();
      await studyTab.click();

      const rows = popup.locator('#study-content .study-term');
      await expect(rows).toHaveCount(1);
      await expect(rows.first().locator('.study-keyword')).toHaveText(KEYWORD);
      await expect(rows.first().locator('.study-status')).toHaveText('To do');

      const pagesBefore = context.pages().length;
      const windowsBefore = await worker.evaluate(async () => (await chrome.windows.getAll()).length);
      await rows.first().getByRole('button', { name: 'Search' }).click();
      const notice = popup.locator('#study-content .study-notice');
      await expect(notice).toContainText(INCOGNITO_OFF);
      expect(await notice.textContent()).toBe(await popup.evaluate(() => globalThis.SBWAioStudy.message('incognito_off')));
      await expect(popup.locator('#study-content').getByRole('button', { name: "Open SEO Bandwagon's Details page" })).toBeVisible();

      // Nothing opened and nothing asked Google; no study tab was recorded.
      expect(context.pages()).toHaveLength(pagesBefore);
      expect(await worker.evaluate(async () => (await chrome.windows.getAll()).length)).toBe(windowsBefore);
      expect(googleRequests).toEqual([]);
      expect(await worker.evaluate(() => chrome.storage.session.get('aioStudyTabs').then((r) => r.aioStudyTabs || {}))).toEqual({});
      await popup.close();
    });

    const page = await context.newPage();
    const group = page.locator('[data-group="study"]');
    const role = (name) => group.locator(`[data-role="${name}"]`);

    await test.step('in a normal tab the study address sends figures and keyword data (the settings are live)', async () => {
      await page.goto(STUDY_URL, { waitUntil: 'load' });
      await expect(page.locator('.sbw-serp-bar').first()).toBeVisible();
      await expect.poll(() => figuresCalls.length).toBe(1);
      await expect.poll(() => keywordCalls.length).toBe(1);
      await expect(group).toHaveCount(0);
    });

    await test.step('standing in for the private window: the worker records this tab, and the reload sends no figures or keyword data', async () => {
      await worker.evaluate(async (record) => {
        const [tab] = await chrome.tabs.query({ url: 'https://www.google.com/search*' });
        const got = await chrome.storage.session.get('aioStudyTabs');
        const tabs = Object.assign({}, got.aioStudyTabs);
        tabs[String(tab.id)] = Object.assign({ windowId: tab.windowId, openedAt: Date.now() }, record);
        await chrome.storage.session.set({ aioStudyTabs: tabs });
      }, { termId: TERM_ID, keyword: KEYWORD, date: TODAY });

      const figuresBefore = figuresCalls.length;
      const keywordsBefore = keywordCalls.length;
      await page.reload({ waitUntil: 'load' });
      await expect(group).toBeVisible();
      await expect(role('study-term')).toHaveText('Term: ' + KEYWORD);
      await expect(role('study-ai')).toHaveText('AI Overview: loaded');
      await expect(role('study-send')).toHaveText('Send to study');
      await expect(role('study-send')).toBeEnabled();
      await expect(page.locator('[data-role="figures-line"]')).toHaveText('Figures are off in a study search.');
      // The overlay asks the worker before it loads anything; give a load
      // that would have gone ahead the time the first one took.
      await page.waitForTimeout(1000);
      expect(figuresCalls).toHaveLength(figuresBefore);
      expect(keywordCalls).toHaveLength(keywordsBefore);
    });

    await test.step('Send to study: one POST of { term_id, csv }; the CSV is the page alone, no figure or keyword column filled', async () => {
      await role('study-send').click();
      await expect(role('study-status')).toHaveText('Sent to the study.');
      await expect(role('study-send')).toHaveText('Sent');
      await expect(role('study-send')).toBeDisabled();

      expect(captures).toHaveLength(1);
      expect(Object.keys(captures[0]).sort()).toEqual(['csv', 'term_id']);
      expect(captures[0].term_id).toBe(TERM_ID);
      expect(captures[0].csv.startsWith('\uFEFF')).toBe(true);

      const { header, records } = recordsOf(captures[0].csv);
      expect(records.length).toBeGreaterThan(0);
      const blankColumns = header.filter((name) => /\((DataForSEO|RDAP)\)$/.test(name) ||
        ['Your site', 'Your on-page checklist', 'Checklist captured', 'Your rank tracker position'].includes(name));
      // The study's columns are there, and so are the figure and keyword ones,
      // which stay blank on every row.
      expect(header).toEqual(expect.arrayContaining(['Query', 'Search features', 'AI Overview citations', 'AI Overview citations read from',
        'Page referring domains (DataForSEO)', 'Search volume a month (DataForSEO)', 'Related searches with volume (DataForSEO)']));
      expect(blankColumns.length).toBeGreaterThan(20);
      records.forEach((r) => {
        expect(r['Query']).toBe(KEYWORD);
        expect(r['Search features']).toContain('AI Overview');
        expect(r['AI Overview state']).toBe('loaded');
        expect(r['AI Overview citations read from'].startsWith('link | record')).toBe(true);
        expect(r['AI Overview citations']).toContain(CITED);
        expect(r['Extension version']).toBe(VERSION);
        blankColumns.forEach((name) => expect(r[name], name).toBe(''));
      });
    });

    await test.step('Google stopped me: one POST to /aio-study/stop', async () => {
      expect(stops).toHaveLength(0);
      await role('study-stop').click();
      await expect(role('study-status')).toHaveText('Recorded. Stop searching for today; your other terms move to tomorrow.');
      expect(stops).toHaveLength(1);
      expect(captures).toHaveLength(1);
    });

    // The only Google page asked for was the saved search at the study's
    // address (twice: the normal tab, then the reload); the page's own
    // assets were aborted, and nothing went through a Google redirect.
    expect(searchHits.length).toBeGreaterThan(0);
    searchHits.forEach((u) => expect(u).toBe(STUDY_URL));
    expect(googleRequests.filter((u) => /\/(goto|url)\?/.test(new URL(u).pathname + '?'))).toEqual([]);
    // Nothing else went to seobandwagon.com but the welcome tab a first
    // install opens (aborted here).
    expect(other.filter((u) => /seobandwagon\.com/.test(u) && !/\/seo-chrome-extension\/welcome/.test(u))).toEqual([]);
  } finally {
    await context.close();
  }
});
