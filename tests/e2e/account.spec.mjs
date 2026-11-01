// The account features for a normal user (1.10.3), in a real browser with the
// extension loaded: a fresh profile stands in for a second device. The key is
// put in chrome.storage.sync, as Chrome sync delivers it, and nothing else is
// stored; seobandwagon.com's answers are stubbed in the route below.
//
// Nothing reaches seobandwagon.com or any other host. Chromium's resolver is
// pointed nowhere from the start (--host-resolver-rules), as in
// serp-collect.spec.mjs; the route answers the API paths the extension asks
// for and aborts everything else. No secrets, no production.
//
// What this verifies:
//   1. New tab, second device: the account reads "Checking key", one /v1/me
//      verifies it, and the rank and task cards load from one progress call
//      (1.10.2 read the device as signed out and showed neither card).
//   2. Side panel, Citations: two string scores average to a number, not
//      "NaN%"; a campaign the site failed says failed.
//   3. Side panel, Link Building: review buttons only on qualified and held
//      outlets.
//   4. A 429 on every call is "rate limited", not the signed-out screen; with
//      no key, Link Building has its own not-connected words.

import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(__dirname, '..', '..', 'extension');
const KEY = 'sbw_' + '0123456789abcdef'.repeat(3);

const SUMMARY = {
  generatedAt: '2026-11-01T12:00:00Z',
  windowDays: 7,
  rankTracking: {
    trackers: [{ id: 't1', domain: 'northsidedental.com', market: 'Austin, Texas · English · desktop', keywords: 20, top10: 8, top3: 2, status: 'active' }],
    movers: [],
    drops: [{ trackerId: 't1', keyword: 'dentist austin', from: 4, to: 9, since: '2026-10-27', lostUrl: 'https://northsidedental.com/' }]
  },
  clientAudits: [],
  tasks: [{ id: 'rank-drop:t1:dentist austin', kind: 'rank_drop', title: '"dentist austin" fell from 4 to 9', detail: 'northsidedental.com, Austin.', path: '/dashboard/rank-tracker/', trackerId: 't1' }]
};

const BUSINESS = { id: '11111111-1111-4111-8111-111111111111', name: 'Northside Dental', city: 'Austin', state: 'TX', address_line1: '100 Main St', phone: '512-555-0142', website: 'https://northsidedental.com' };

// The site sends nap_match_score, a numeric column, as a string.
const CITATIONS = [
  { id: 'c1', directory_name: 'Yelp', directory_url: 'https://www.yelp.com/biz/northside-dental', status: 'active', nap_match_score: '0.850', created_at: '2026-10-01T00:00:00Z' },
  { id: 'c2', directory_name: 'Yellow Pages', directory_url: 'https://www.yellowpages.com/austin-tx/mip/northside-dental', status: 'inconsistent', nap_match_score: '0.650', created_at: '2026-10-02T00:00:00Z' },
  { id: 'c3', directory_name: 'Manta', directory_url: 'https://www.manta.com/c/northside-dental', status: 'missing', nap_match_score: null, created_at: '2026-10-03T00:00:00Z' }
];

const OUTLETS = {
  qualified: [{ id: 'p1', domain: 'austinmonthly.com', status: 'qualified', quality_score: '72', journalist_count: 3 }],
  held: [{ id: 'p2', domain: 'kxan.com', status: 'held', quality_score: '64', journalist_count: 2 }],
  approved: [{ id: 'p3', domain: 'statesman.com', status: 'approved', quality_score: '81', journalist_count: 5 }],
  candidate: [{ id: 'p4', domain: 'example-blog.com', status: 'candidate', quality_score: null, journalist_count: 0 }]
};

const campaigns = []; // what the site has run for BUSINESS, newest last

// path (after /api) → [status, body]. `mode` switches the whole site to an
// answer (429 everywhere) for the rate-limit step.
function answer(method, path, search, mode) {
  if (mode === 'rate_limited') return [429, { error: 'Too many requests' }];
  if (path === '/v1/me') return [200, { email: 'owner@example.com', name: 'Owner', key: { name: 'Second device' }, scopes: ['captures', 'citations', 'link-building:read', 'link-building:write', 'progress'] }];
  if (path === '/extension/progress') return [200, SUMMARY];
  if (path === '/citations/businesses') return [200, { data: [BUSINESS] }];
  if (path === `/citations/businesses/${BUSINESS.id}/stats`) return [200, { data: { total_citations: 3, active_citations: 1, inconsistent_citations: 1, missing_citations: 1, avg_nap_score: 0.75, last_campaign_at: null } }];
  if (path === `/citations/businesses/${BUSINESS.id}/citations`) return [200, { data: CITATIONS }];
  if (path === `/citations/businesses/${BUSINESS.id}/campaigns`) {
    // The site answers a campaign its engine failed with 201 and status 'failed'.
    if (method === 'POST') campaigns.push({ id: 'k1', status: 'failed', campaign_type: 'discovery', created_at: '2026-11-01T12:00:00Z' });
    if (method === 'POST') return [201, { data: campaigns[campaigns.length - 1] }];
    return [200, { data: campaigns }];
  }
  if (path === '/link-building/prospects') {
    const status = new URLSearchParams(search).get('status');
    return [200, { prospects: OUTLETS[status] || [] }];
  }
  return [404, { error: 'Not found' }];
}

test('second device and the account surfaces: connected, cards, scores, campaigns, review buttons', async () => {
  // Six extension pages in one headful browser; launch and close alone take
  // 15-40 s on a busy machine, past the config's 60 s.
  test.setTimeout(120_000);
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--host-resolver-rules=MAP * ~NOTFOUND'
    ]
  });

  const api = [];     // "METHOD /path" for every API call answered
  const other = [];   // everything else the route saw, aborted
  let mode = 'normal';
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === 'https://seobandwagon.com' && url.pathname.startsWith('/api/')) {
      const path = url.pathname.slice(4);
      api.push(`${req.method()} ${path}`);
      const [status, body] = answer(req.method(), path, url.search, mode);
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    }
    // The extension's own pages and files load as they are.
    if (!/^https?:$/.test(url.protocol)) return route.continue();
    other.push(url.href);
    return route.abort();
  });

  try {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    const id = new URL(serviceWorker.url()).host;
    const pageUrl = (path) => `chrome-extension://${id}/${path}`;

    await test.step('the key arrives through Chrome sync; this profile has nothing else', async () => {
      await serviceWorker.evaluate((key) => chrome.storage.sync.set({ apiKey: key }), KEY);
      const local = await serviceWorker.evaluate(() => chrome.storage.local.get(['sbwKeyStatus', 'sbwUser', 'sbwProgress']));
      expect(local).toEqual({});
    });

    await test.step('new tab: the key is checked once and the account cards load', async () => {
      // No Neon theme here, so pin the dashboard (Options → New tab → Always).
      await serviceWorker.evaluate(() => chrome.storage.local.set({ bwNewTab: 'always' }));
      const page = await context.newPage();
      await page.goto(pageUrl('src/newtab/newtab.html'));
      await expect(page.locator('#ntRankCard')).toBeVisible();
      await expect(page.locator('#ntRankTitle')).toContainText('northsidedental.com');
      await expect(page.locator('#ntDrops')).toContainText('dentist austin');
      await expect(page.locator('#ntTasksCard')).toBeVisible();
      await expect(page.locator('#ntTasks')).toContainText('fell from 4 to 9');
      await expect(page.locator('#ntAccount')).toHaveText('Synced');
      await expect(page.locator('#ntAccount')).toHaveAttribute('title', 'Connected as owner@example.com');
      // The repaint the verify triggers reuses the answer: one of each.
      await page.waitForTimeout(500);
      expect(api.filter((c) => c === 'GET /v1/me')).toHaveLength(1);
      expect(api.filter((c) => c === 'GET /extension/progress')).toHaveLength(1);
      await page.close();
    });

    await test.step('side panel, Citations: the average is a number', async () => {
      const page = await context.newPage();
      await page.goto(pageUrl('src/sidepanel/sidepanel.html'));
      await expect(page.locator('.sp-row-t', { hasText: 'Northside Dental' })).toBeVisible();
      await page.locator('#spNav button[data-section="citations"]').click();
      await expect(page.locator('#spFootStat')).toHaveText('3 shown · 3 total · 75% avg');
      await expect(page.locator('#spBody')).not.toContainText('NaN');
      await expect(page.locator('.sp-row', { hasText: 'Yelp' }).locator('.badge-mono')).toHaveText('85%');

      await page.locator('#spNav button[data-section="campaigns"]').click();
      await expect(page.locator('#spFootStat')).toHaveText('0 campaigns');
      await page.locator('#spRun').click();
      // The list reloads with the run on it, and the footer keeps the outcome.
      await expect(page.locator('.sp-row .badge-mono')).toHaveText('FAILED');
      await expect(page.locator('#spFootStat')).toHaveText(/^Campaign failed/);
      await expect(page.locator('#spFootStat')).not.toHaveText(/complete/i);
      await page.close();
    });

    await test.step('side panel, Link Building: review buttons only where the route acts', async () => {
      const page = await context.newPage();
      await page.goto(pageUrl('src/sidepanel/sidepanel.html'));
      await page.locator('#spModeNav button[data-mode="links"]').click();
      const card = page.locator('.lb-card');
      await expect(card).toContainText('austinmonthly.com');
      await expect(card.locator('.lb-actions button')).toHaveText(['APPROVE', 'HOLD', 'REJECT']);

      await page.locator('.sp-chip[data-v="held"]').click();
      await expect(card).toContainText('kxan.com');
      await expect(card.locator('.lb-actions button')).toHaveText(['APPROVE', 'REJECT']);

      for (const [chip, domain] of [['approved', 'statesman.com'], ['candidate', 'example-blog.com']]) {
        await page.locator(`.sp-chip[data-v="${chip}"]`).click();
        await expect(card).toContainText(domain);
        await expect(card.locator('.lb-actions')).toHaveCount(0);
      }
      await page.close();
    });

    await test.step('a 429 is rate limited, not signed out', async () => {
      // A fresh /v1/me is asked only once sbwUser is stale: drop it.
      await serviceWorker.evaluate(() => chrome.storage.local.remove('sbwUser'));
      mode = 'rate_limited';
      const page = await context.newPage();
      await page.goto(pageUrl('src/sidepanel/sidepanel.html'));
      await expect(page.locator('#spBody')).toContainText('Rate limited');
      await expect(page.locator('#spBody')).not.toContainText('NOT CONNECTED');
      await page.close();
      mode = 'normal';
    });

    await test.step('signed out, Link Building says what it would show', async () => {
      await serviceWorker.evaluate(() => chrome.storage.sync.set({ apiKey: '' }));
      const page = await context.newPage();
      await page.goto(pageUrl('src/sidepanel/sidepanel.html'));
      // The panel reopens in the mode it was left in (Link Building, above).
      await expect(page.locator('#spBody')).toContainText('NOT CONNECTED');
      await expect(page.locator('#spBody')).toContainText('link-building outlets and pitches');
      await page.locator('#spModeNav button[data-mode="citations"]').click();
      await expect(page.locator('#spBody')).toContainText('citation data');
      await expect(page.locator('#spModeNav button[data-mode="citations"]')).toHaveClass(/active/);
      await page.locator('#spModeNav button[data-mode="links"]').click();
      await expect(page.locator('#spBody')).toContainText('link-building outlets and pitches');
      await page.close();
    });

    await test.step('nothing left the machine', async () => {
      // The install's welcome tab opens and is aborted like everything else.
      const welcome = /^https:\/\/seobandwagon\.com\/seo-chrome-extension\/welcome\?ref=install&/;
      expect(other.filter((u) => !welcome.test(u)), 'requests outside the stubbed API').toEqual([]);
    });
  } finally {
    await context.close();
  }
});
