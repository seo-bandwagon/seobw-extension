// The first run (1.14.0) in Chromium with the extension loaded, each part
// down its data path rather than only its look:
//
//   1. A fresh install marks the first-run guide pending (the worker's
//      onInstalled); the popup shows it, "Got it" stores that it was seen and
//      it stays gone, and About & credits reopens it.
//   2. A saved page analyzed in the browser (the popup's own injection and
//      { action: 'analyze' }) draws the first screen from that analysis: the
//      grade, the checks line, the top 3 problems worst first, "All N
//      issues", every other section and the checks panels under All checks,
//      and Copy issues hands the clipboard the same text the issues give.
//   3. Your data: one row per consent flow, and each switch writes what every
//      send checks first (SBWConsent.check in the worker): keyword data's yes
//      and its withdrawal, and "Send analyses" off and on again, which the
//      popup's own switch then shows.
//   4. None of it sends anything: the popup and Your data pages make no
//      request beyond the local page server.
//
// Nothing leaves the runner: pages come from a local server on 127.0.0.1
// and Chromium's resolver points every other host nowhere. The extension is
// a copy whose manifest adds <all_urls> to host_permissions, so the popup
// can script the page without the toolbar click that grants activeTab; the
// code it runs is the shipped code, unchanged. SBW_SHOTS=<dir> saves
// screenshots of the popup and the page.

import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION = resolve(__dirname, '..', '..', 'extension');
const PAGES = resolve(__dirname, '..', 'fixtures', 'pages');
const SHOTS = process.env.SBW_SHOTS || '';

// The files the popup injects before { action: 'analyze' }, from popup.js.
const popupSrc = readFileSync(resolve(EXTENSION, 'src/popup/popup.js'), 'utf8');
const FILES = JSON.parse(/executeScript\(\{\s*target:\s*\{\s*tabId:\s*tab\.id\s*\},\s*files:\s*(\[[^\]]+\])/.exec(popupSrc)[1].replace(/'/g, '"'));

function serve() {
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    let body = null;
    if (path.startsWith('/pages/')) {
      try { body = readFileSync(join(PAGES, path.slice('/pages/'.length).replace(/[^\w.-]/g, ''))); } catch { body = null; }
    }
    if (body === null) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

// Every http(s) request a page makes that isn't the local page server.
function watchRequests(page, base) {
  const out = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/^https?:/.test(u) && !u.startsWith(base)) out.push(u);
  });
  return out;
}

test('the first run: the guide, the first screen and Your data, each down its data path', async () => {
  test.setTimeout(150_000);
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;

  const copy = mkdtempSync(join(tmpdir(), 'sbw-ext-'));
  cpSync(EXTENSION, copy, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf8'));
  manifest.host_permissions = [...manifest.host_permissions, '<all_urls>'];
  writeFileSync(join(copy, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 500, height: 550 },
    args: [
      `--disable-extensions-except=${copy}`,
      `--load-extension=${copy}`,
      '--no-sandbox',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      '--disable-backgrounding-occluded-windows'
    ]
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    const id = new URL(worker.url()).host;
    const popupUrl = `chrome-extension://${id}/src/popup/popup.html`;
    const local = (key) => worker.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key);

    await test.step('a fresh install marks the guide pending, and the popup shows it once', async () => {
      await expect.poll(() => local('sbwGuide')).toMatchObject({ pending: true });

      const popup = await context.newPage();
      const sent = watchRequests(popup, base);
      await popup.goto(popupUrl);
      const guide = popup.locator('#firstRunGuide');
      await expect(guide).toBeVisible();
      await expect(guide.locator('.guide-step')).toHaveCount(3);
      await expect(guide.locator('[data-step="score"]')).toContainText('doesn’t measure or predict rankings');
      await expect(guide.locator('[data-step="account"]')).toContainText('Nothing here needs an account.');
      await expect(guide.locator('#guideData')).toHaveAttribute('href', '../your-data/your-data.html');
      if (SHOTS) await popup.screenshot({ path: join(SHOTS, 'popup-guide.png') });

      await guide.locator('#guideOk').click();
      await expect(guide).toBeHidden();
      await expect.poll(() => local('sbwGuide')).toMatchObject({ pending: false });

      await popup.reload();
      await popup.waitForTimeout(300);
      await expect(popup.locator('#firstRunGuide')).toBeHidden();

      // About & credits reopens it, without marking it pending again.
      await popup.locator('#creditsLink').click();
      await popup.locator('#creditsGuide').click();
      await expect(popup.locator('#firstRunGuide')).toBeVisible();
      await expect(popup.locator('#creditsPanel')).toBeHidden();
      expect(await local('sbwGuide')).toMatchObject({ pending: false });
      expect(sent).toEqual([]);
      await popup.close();
    });

    await test.step('a page analyzed in the browser draws the first screen from its own analysis', async () => {
      const page = await context.newPage();
      const pageUrl = `${base}/pages/duplicates.html`;
      await page.goto(pageUrl);
      const tabId = await worker.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, pageUrl);

      const popup = await context.newPage();
      const sent = watchRequests(popup, base);
      await popup.goto(popupUrl);
      // Opened as a page, the popup's active tab is itself; it analyzes the
      // saved page the way popup.js does, and renderResults draws it.
      const data = await popup.evaluate(async ({ tabId, files }) => {
        await chrome.scripting.executeScript({ target: { tabId }, files });
        const response = await chrome.tabs.sendMessage(tabId, { action: 'analyze' });
        currentTab = await chrome.tabs.get(tabId);
        pageData = response;
        renderResults(response);
        return response;
      }, { tabId, files: FILES });

      const order = await popup.evaluate((d) => SBWFirstScreen.orderedIssues(d), data);
      expect(order.length).toBe(data.seoScore.issues.length);
      expect(order.length).toBeGreaterThan(3);
      for (let i = 1; i < order.length; i++) {
        if (!order[i - 1].blocksIndex) expect(order[i - 1].points).toBeGreaterThanOrEqual(order[i].points);
      }

      await expect(popup.locator('#scoreGrade')).toHaveText(`GRADE ${data.seoScore.grade}`);
      await expect(popup.locator('.ring-val')).toHaveText(String(data.seoScore.score));
      const line = await popup.evaluate((d) => SBWFirstScreen.checksLineText(SBWFirstScreen.checksLine(d)), data);
      await expect(popup.locator('#checksLine .checks-passed')).toHaveText(line.passed);
      await expect(popup.locator('#scoreLine')).toContainText('An on-page checklist');

      const top = popup.locator('#topIssues > .issue');
      await expect(top).toHaveCount(3);
      expect(await top.evaluateAll((els) => els.map((e) => e.dataset.issue))).toEqual(order.slice(0, 3).map((i) => i.issue));
      for (let i = 0; i < 3; i++) {
        await expect(top.nth(i).locator('.issue-why')).toHaveText(order[i].why);
        await expect(top.nth(i).locator('.issue-fix')).toHaveText(order[i].body);
        await expect(top.nth(i).locator('.issue-points')).toHaveText(`−${order[i].points}`);
      }
      if (SHOTS) await popup.screenshot({ path: join(SHOTS, 'popup-first-screen.png') });
      const all = popup.locator('#topIssues .all-issues');
      await expect(all.locator('.section-title')).toHaveText(`All ${order.length} issues`);
      await expect(all.locator('.issue').first()).toBeHidden();
      await all.locator('.section-header').click();
      await expect(all.locator('.issue')).toHaveCount(order.length - 3);
      await expect(all.locator('.issue').first()).toBeVisible();

      // Every other section, the checks panels too, under All checks.
      const checks = popup.locator('#content > [data-section="allchecks"]');
      await expect(checks).toBeVisible();
      for (const sec of ['meta', 'indexability', 'render', 'schema', 'headings', 'links', 'content', 'technical', 'link-check']) {
        await expect(checks.locator(`#allChecksBody > [data-section="${sec}"]`)).toHaveCount(1);
        await expect(popup.locator(`#content > [data-section="${sec}"]`)).toHaveCount(0);
      }
      await expect(checks.locator('#allChecksBody > [data-section="meta"]')).toBeHidden();
      // The jumps are inside All checks: open it, then jump to the last section.
      await checks.locator(':scope > .section-header').click();
      await expect(checks.locator('#jumpRow .jump-link')).toHaveCount(await checks.locator('#allChecksBody > .section').count());
      // Each section inside stays folded until it is opened itself.
      await expect(checks.locator('#allChecksBody > [data-section="meta"] > .section-content')).toBeHidden();
      await expect(checks.locator('#allChecksBody > [data-section="headings"] > .section-content')).toBeHidden();
      // The footer's links each sit on one line, inside the popup's width.
      const footer = await popup.evaluate(() => {
        const items = [...document.querySelectorAll('.footer-right > *:not([hidden]), .footer-toggle .toggle-label')];
        return { lines: items.map((el) => Math.round(el.getBoundingClientRect().height)), right: Math.max(...items.map((el) => el.getBoundingClientRect().right)) };
      });
      expect(Math.max(...footer.lines)).toBeLessThan(20);
      expect(footer.right).toBeLessThanOrEqual(500);
      if (SHOTS) {
        await checks.scrollIntoViewIfNeeded();
        await popup.screenshot({ path: join(SHOTS, 'popup-all-checks.png') });
      }
      await checks.locator('.jump-link[data-jump="link-check"]').click({ timeout: 10_000 });
      await expect(checks).toHaveClass(/\bopen\b/);
      await expect(checks.locator('[data-section="link-check"]')).toHaveClass(/\bopen\b/);
      await expect(checks.locator('[data-section="link-check"] .section-content')).toBeVisible();

      // "+ Add as outlet" is under the actions, off the first screen.
      await expect(popup.locator('.actions-more #addOutletBtn')).toHaveCount(1);
      await expect(popup.locator('#toolsSlot .tools a').first()).toBeVisible();

      // Copy issues: the text the analysis gives, through the clipboard call.
      await popup.evaluate(() => {
        globalThis.__copied = [];
        navigator.clipboard.writeText = async (t) => { globalThis.__copied.push(t); };
      });
      await popup.locator('#copyIssuesBtn').click();
      await expect(popup.locator('#status')).toHaveText('Issues copied');
      const copied = await popup.evaluate(() => globalThis.__copied);
      const expected = await popup.evaluate((d) => SBWFirstScreen.issuesText(d), data);
      expect(copied).toEqual([expected]);
      expect(copied[0].split('\n')[0]).toBe(`SEO Bandwagon: ${pageUrl}`);
      expect(copied[0].split('\n').filter((l) => /^\d+\. /.test(l))).toHaveLength(order.length);

      expect(sent).toEqual([]);
      await popup.close();
      await page.close();
    });

    await test.step('Your data: a row per flow, and each switch writes what every send checks', async () => {
      const yd = await context.newPage();
      await yd.setViewportSize({ width: 900, height: 1400 });
      const sent = watchRequests(yd, base);
      await yd.goto(`chrome-extension://${id}/src/your-data/your-data.html`);
      const flows = await worker.evaluate(() => Object.keys(SBWConsent.FLOWS));
      await expect(yd.locator('#ydFlows .yd-row')).toHaveCount(flows.length);
      for (const f of flows) await expect(yd.locator(`#ydFlows [data-row="${f}"] input[data-flow="${f}"]`)).toHaveCount(1);
      await expect(yd.locator('#ydAccountLine')).toContainText('No account is connected');
      await expect(yd.locator('#ydSyncedItems li')).toHaveCount(2);
      await expect(yd.locator('#ydKept')).toContainText('30 days');
      await expect(yd.locator('#yd-switch-keywordData-status')).toHaveText('Off: nothing is sent.');

      // With a key (no request reaches anything: the resolver points nowhere).
      await worker.evaluate(() => chrome.storage.sync.set({ apiKey: 'sbw_' + '0'.repeat(48) }));
      await yd.reload();
      await expect(yd.locator('#ydAccountLine')).toContainText('An account is connected');
      const check = (name) => worker.evaluate((n) => SBWConsent.check(n, { hasKey: true }), name);

      // Keyword data: the switch is its yes, and its withdrawal.
      expect(await check('keywordData')).toEqual({ ok: false, reason: 'not_accepted' });
      await yd.locator('#yd-switch-keywordData').check();
      await expect.poll(() => check('keywordData')).toEqual({ ok: true });
      const record = (await local('sbwConsent')).keywordData;
      expect(record.version).toBe(1);
      expect(Date.parse(record.acceptedAt)).toBeGreaterThan(Date.now() - 60_000);
      await expect(yd.locator('#yd-switch-keywordData-status')).toHaveText('On: sent when you use it, as described above.');
      await yd.locator('#yd-switch-keywordData').uncheck();
      await expect.poll(() => check('keywordData')).toEqual({ ok: false, reason: 'not_accepted' });
      expect((await local('sbwConsent')).keywordData).toBeUndefined();

      // Send analyses: the switch the popup and Settings have, read by every capture send.
      await expect(yd.locator('#yd-switch-captureSync')).toBeChecked();
      expect(await check('captureSync')).toEqual({ ok: true });
      await yd.locator('#yd-switch-captureSync').uncheck();
      await expect.poll(() => local('dataCollection')).toBe(false);
      expect(await check('captureSync')).toEqual({ ok: false, reason: 'category_off' });
      expect(await worker.evaluate(() => SBW.isDataCollectionEnabled())).toBe(false);
      const popup = await context.newPage();
      await popup.goto(popupUrl);
      await expect(popup.locator('#dataToggle')).not.toBeChecked();
      // And back on from the popup: Your data follows it.
      await popup.locator('#dataToggle').check();
      await expect.poll(() => local('dataCollection')).toBe(true);
      await expect(yd.locator('#yd-switch-captureSync')).toBeChecked();
      expect(await check('captureSync')).toEqual({ ok: true });
      await popup.close();

      if (SHOTS) await yd.screenshot({ path: join(SHOTS, 'your-data.png'), fullPage: true });
      expect(sent).toEqual([]);
      await yd.close();
    });
  } finally {
    await context.close();
    server.close();
    rmSync(copy, { recursive: true, force: true });
  }
});
