// Collect pages (1.8.0, src/lib/serp-collect.js) in a real browser: launches
// Chromium with the extension loaded, opens Google results pages saved in
// tests/fixtures, and clicks the results overlay's own controls the way a
// person collects a top 40: Add page 1, the overlay's "Next page →" link,
// Add page 2, Add page 2 again, Add page 4 with page 3 skipped, then Export
// collected CSV.
//
// Nothing reaches Google, or any other host. The owner's rule for Collect
// pages is a human in the loop: the extension never fetches or walks Google
// pages itself, and no test queries Google either. So every request is
// routed: www.google.com/search at a saved offset is answered from disk, and
// everything else (the saved pages' images, anything the extension asks for)
// is aborted. The route can only be set once the browser is up, and the
// extension opens its seobandwagon.com welcome tab on install, during the
// launch; so Chromium's resolver is pointed nowhere from the start
// (--host-resolver-rules), and only the route's own answers ever load. The
// last step fails if any response or open tab came from anywhere else. No
// secrets, no production.
//
// What this verifies:
//   1. The collect bar renders on a Google results page.
//   2. The collection lives in the worker, so it survives Google's own
//      navigation to the next page.
//   3. Adding a page again replaces it rather than appending its rows.
//   4. The export is one CSV of every kept row, each tagged with its page:
//      absolute positions run 1..n while no earlier page is missing, are
//      blank with a note after the skipped page, and no URL appears twice;
//      the approximate one counts the earlier pages' organic results (1.10.2).

import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(__dirname, '..', '..', 'extension');
const FIXTURES = resolve(__dirname, '..', 'fixtures');
const QUERY = 'best crm for nonprofits';

// Google's offset (`start=`) → the saved page served for it. Three different
// saved searches, so each page brings different URLs; start=20 (page 3) is
// never served, which is the skipped-page case.
const PAGES = {
  0: 'serp-google-commercial-query.html',
  10: 'serp-google-goto-links.html',
  30: 'serp-google-site-query.html'
};

// Rows each page adds to the collection, as the fixtures stand. Pinned, so a
// change in what serp.js parses or serp-collect.js keeps shows up here too.
const ADDS = { 1: 6, 2: 9, 4: 2 };

function searchUrl(start) {
  return `https://www.google.com/search?q=${QUERY.replace(/ /g, '+')}${start ? `&start=${start}` : ''}`;
}

// Enough CSV for resultsToCsv's output: quoted cells, doubled quotes, CRLF,
// and the BOM it starts with so Excel reads UTF-8.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

test('collect pages: add pages 1, 2 and 4 from saved Google results and export one CSV', async () => {
  // Headful, as the canary: the headless shell doesn't run MV3 service workers.
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--host-resolver-rules=MAP * ~NOTFOUND'
    ]
  });

  const served = [];   // google.com/search URLs answered from disk
  const aborted = [];  // everything else the route saw
  const answered = []; // every http(s) request that got a response
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const file = url.hostname === 'www.google.com' && url.pathname === '/search'
      ? PAGES[Number(url.searchParams.get('start') || 0)]
      : undefined;
    if (!file) {
      aborted.push(url.href);
      return route.abort();
    }
    served.push(url.href);
    return route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: readFileSync(resolve(FIXTURES, file))
    });
  });
  context.on('requestfinished', (request) => {
    if (/^https?:/.test(request.url())) answered.push(request.url());
  });

  try {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    }

    const page = await context.newPage();
    const bar = page.locator('.sbw-serp-collect');
    const count = bar.locator('[data-role="collect-count"]');
    const button = (label) => bar.locator('button', { hasText: label });
    const through1 = ADDS[1];
    const through2 = through1 + ADDS[2];
    const total = through2 + ADDS[4];

    await test.step('page 1: the collect bar renders and Add page 1 collects', async () => {
      await page.goto(searchUrl(0), { waitUntil: 'load' });
      await expect(bar).toBeVisible();
      await button('Add page 1').click();
      await expect(count).toHaveText(String(through1));
    });

    await test.step("page 2, through the overlay's Next link: the collection carries over", async () => {
      await bar.locator('a', { hasText: 'Next page' }).click();
      await page.waitForURL(/[?&]start=10\b/);
      await expect(count).toHaveText(String(through1));
      await button('Add page 2').click();
      await expect(count).toHaveText(String(through2));
    });

    await test.step('page 2 again: adding it twice replaces it', async () => {
      await button('Add page 2').click();
      await expect(button('Add page 2')).toHaveText(/Added again: \d+ changed/);
      await expect(count).toHaveText(String(through2));
    });

    await test.step('page 4, with page 3 skipped', async () => {
      await page.goto(searchUrl(30), { waitUntil: 'load' });
      await expect(count).toHaveText(String(through2));
      await button('Add page 4').click();
      await expect(count).toHaveText(String(total));
      await expect(bar.locator('[data-role="collect-line"]')).toContainText('page 3 not added');
    });

    await test.step('Export collected CSV: one file, every kept row', async () => {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        button('Export collected CSV').click()
      ]);
      expect(download.suggestedFilename()).toMatch(/^serp-best-crm-for-nonprofits-p1-4-.*\.csv$/);
      const rows = parseCsv(readFileSync(await download.path(), 'utf8'));
      expect(rows).toHaveLength(total);

      const onPage = (n) => rows.filter((r) => r['Page'] === String(n));
      const [p1, p2, p4] = [onPage(1), onPage(2), onPage(4)];
      expect([p1.length, p2.length, p4.length]).toEqual([ADDS[1], ADDS[2], ADDS[4]]);

      // Exact while no earlier page is missing: 1..n across pages 1 and 2.
      const exact = [...p1, ...p2].map((r) => r['Absolute position']);
      expect(exact).toEqual(exact.map((_, i) => String(i + 1)));
      // Unknown after the skipped page, and the row says why.
      for (const r of p4) {
        expect(r['Absolute position']).toBe('');
        expect(r['Collection notes']).toMatch(/After a page that was not added/);
      }

      // 1.10.2: the approximate one counts the earlier pages' organic
      // results (page 3, never added, as Google's 10), not start + position.
      const approx = (r) => Number(r['Absolute position (approx.)']) - Number(r['Position']);
      expect([...new Set(p1.map(approx))]).toEqual([0]);
      expect([...new Set(p2.map(approx))]).toEqual([ADDS[1]]);
      expect([...new Set(p4.map(approx))]).toEqual([ADDS[1] + ADDS[2] + 10]);

      const urls = rows.map((r) => r['URL']);
      expect(new Set(urls).size).toBe(urls.length);
      expect(rows.every((r) => r['Domain'])).toBe(true);
    });

    await test.step('nothing left the machine', async () => {
      // Each saved page loaded once, and nothing else answered or loaded.
      expect(served.map((u) => new URL(u).searchParams.get('start') || '0').sort()).toEqual(['0', '10', '30']);
      expect(answered.filter((u) => !served.includes(u)), 'responses from outside tests/fixtures').toEqual([]);
      const tabs = context.pages().map((p) => p.url());
      expect(tabs.filter((u) => /^https?:/.test(u) && !served.includes(u)), 'tabs showing a page from outside tests/fixtures').toEqual([]);
      const hosts = [...new Set(aborted.map((u) => new URL(u).hostname))];
      console.log(`[serp-collect] ${total} rows (${ADDS[1]} + ${ADDS[2]} + ${ADDS[4]}); aborted ${aborted.length}${hosts.length ? ` (${hosts.join(', ')})` : ''}`);
    });
  } finally {
    await context.close();
  }
});
