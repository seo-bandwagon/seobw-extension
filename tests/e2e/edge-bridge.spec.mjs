// The Microsoft Edge package (1.13.6), loaded unpacked in Chromium, and the
// Connect bridge it carries, end to end.
//
// Playwright can't load an extension into branded Edge, so Chromium stands in
// (vault design: "the Chromium e2e stands in, plus a manual smoke test"). The
// package is built here with scripts/build-zip.mjs --target edge and loaded
// from its unzipped files, exactly what Partner Center gets. Loaded unpacked
// without "key", it has an ID of its own, as an Edge install will: the
// bridge has to work without the Chrome item's ID.
//
// Nothing reaches seobandwagon.com or any other host: Chromium's resolver is
// pointed nowhere (--host-resolver-rules), the route below serves a stand-in
// for the site's pages, which talks to the bridge the way the site will
// (keepkalm/platform, src/lib/extension/browser-messaging.ts), answers
// /api/v1/me for the connect step, and aborts everything else.
//
// What this verifies:
//   1. the Edge build: its manifest, no welcome tab, no "Chrome" on its
//      options page and popup, and no new-tab or theme settings;
//   2. the bridge's marker on the API keys and welcome pages, and nowhere
//      else, not in a frame;
//   3. ping, status and connect through the bridge: the worker's answers, the
//      key stored after /v1/me verifies it, and a bad key refused;
//   4. messages the bridge ignores: wrong flag, no port, from a frame;
//   5. install warnings (getPermissionWarningsByManifest): the bridge adds
//      none to the Chrome package, and the Edge one has Chrome's less the new
//      tab's and `management`'s.

import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildZip, packageManifest } from '../../scripts/build-zip.mjs';

const KEY = 'sbw_' + '0123456789abcdef'.repeat(3);
const ME = { email: 'owner@example.com', name: 'Owner', key: { name: 'Edge' }, scopes: ['captures', 'citations', 'progress', 'serp', 'keywords'] };

// The site's half of the bridge, as a page script. `bridge(message)` posts
// { sbwBridge: 1, message } with one port and resolves with what comes back
// on it, or { timeout: true }.
const SITE_SCRIPT = `
  window.bridge = (message, { flag = 1, port = true, wait = 8000 } = {}) => new Promise((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve({ timeout: true }), wait);
    ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
    window.postMessage({ sbwBridge: flag, message }, 'https://seobandwagon.com', port ? [ch.port2] : []);
  });
`;
const page = (title, body = '') => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1>${body}<script>${SITE_SCRIPT}</script></body></html>`;

test('the Edge package: its build, and the Connect bridge (ping, status, connect)', async () => {
  test.setTimeout(150_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbw-edge-e2e-'));
  const zip = path.join(dir, 'edge.zip');
  const unpacked = path.join(dir, 'extension');
  buildZip(zip, { target: 'edge' });
  execFileSync('unzip', ['-q', zip, '-d', unpacked]);

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${unpacked}`,
      `--load-extension=${unpacked}`,
      '--no-sandbox',
      '--host-resolver-rules=MAP * ~NOTFOUND'
    ]
  });

  const api = [];    // "METHOD /path" of every API call answered
  const pages = [];  // every seobandwagon.com page served
  const other = [];  // everything else, aborted
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (!/^https?:$/.test(url.protocol)) return route.continue();
    if (url.origin === 'https://seobandwagon.com' && url.pathname.startsWith('/api/')) {
      const p = url.pathname.slice(4);
      api.push(`${req.method()} ${p}`);
      const auth = req.headers().authorization || '';
      if (p === '/v1/me' && auth === `Bearer ${KEY}`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ME) });
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }) });
    }
    if (url.origin === 'https://seobandwagon.com') {
      pages.push(url.pathname + url.search);
      const framed = url.pathname === '/framed/';
      const html = framed
        ? page('Framed', '<iframe id="f" src="/dashboard/api-keys/"></iframe>')
        : page(url.pathname);
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    }
    other.push(url.href);
    return route.abort();
  });

  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const id = new URL(sw.url()).host;

    await test.step('the Edge build: its manifest, its own ID, and no welcome tab', async () => {
      const m = await sw.evaluate(() => chrome.runtime.getManifest());
      expect(m.version).toBe('1.13.6');
      expect(m).not.toHaveProperty('key');
      expect(m).not.toHaveProperty('chrome_url_overrides');
      expect(m.permissions).not.toContain('management');
      expect(m).not.toHaveProperty('optional_permissions');
      expect(m.commands['analyze-current'].suggested_key).toEqual({ default: 'Alt+Shift+S', mac: 'MacCtrl+Shift+S' });
      expect(m.externally_connectable).toEqual({ matches: ['https://seobandwagon.com/*'] });
      expect(id).not.toBe('dphmaddiedhkejfhabkfdenfphjljioj');
      expect(await sw.evaluate(() => [globalThis.SBWBrowser.target, globalThis.SBWBrowser.name])).toEqual(['edge', 'Microsoft Edge']);
      // The site's welcome page says "Chrome extension": the Edge build opens
      // none. The install ran before the route was set, so look at the tabs.
      await new Promise((r) => setTimeout(r, 1500));
      expect(context.pages().map((p) => p.url()).filter((u) => u.includes('/seo-chrome-extension/welcome'))).toEqual([]);
      expect(pages.filter((p) => p.startsWith('/seo-chrome-extension/welcome'))).toEqual([]);
    });

    await test.step('install warnings: none from the bridge; Edge has Chrome\'s less the new tab\'s', async () => {
      const chromeText = packageManifest(fs.readFileSync(path.resolve('extension/manifest.json'), 'utf8'));
      const noBridge = JSON.parse(chromeText);
      noBridge.content_scripts = noBridge.content_scripts.filter((c) => !c.js.includes('src/content/site-bridge.js'));
      const edgeText = fs.readFileSync(path.join(unpacked, 'manifest.json'), 'utf8');
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/src/options/options.html`);
      const warn = (text) => page.evaluate((t) => chrome.management.getPermissionWarningsByManifest(t), text);
      const [withBridge, without, edgeWarnings] = [await warn(chromeText), await warn(JSON.stringify(noBridge)), await warn(edgeText)];
      console.log('install warnings, Chrome package:', JSON.stringify(withBridge));
      console.log('install warnings, Edge package:', JSON.stringify(edgeWarnings));
      expect(withBridge).toEqual(without);
      expect(edgeWarnings).toEqual(withBridge.filter((w) => !/new tab|Manage your apps/.test(w)));
      await page.close();
    });

    await test.step('options and popup name no other browser, and offer no new tab, themes or review', async () => {
      const options = await context.newPage();
      await options.goto(`chrome-extension://${id}/src/options/options.html`);
      await expect(options.locator('#newTabSection')).toBeHidden();
      await expect(options.locator('#themeLinks')).toBeHidden();
      // Shown text, and all text, hidden sections included.
      expect(await options.locator('body').innerText()).not.toMatch(/Chrome|Incognito/);
      const optionsText = await options.locator('body').textContent();
      expect(optionsText).not.toMatch(/Chrome|Incognito/);
      expect(optionsText).toContain('Microsoft Edge must allow SEO Bandwagon in private windows: Allow in InPrivate');
      expect(optionsText).toContain('click Connect extension there');
      await options.close();

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
      await expect(popup.locator('[data-review-link]')).toBeHidden();
      await expect(popup.locator('#themeStrip')).toBeHidden();
      expect(await popup.locator('body').innerText()).not.toMatch(/Chrome|Incognito/);
      await popup.close();
    });

    const tab = await context.newPage();

    await test.step('the marker: on the API keys and welcome pages, top frame only', async () => {
      for (const p of ['/dashboard/api-keys/', '/seo-chrome-extension/welcome/?ref=install']) {
        await tab.goto(`https://seobandwagon.com${p}`);
        expect(await tab.evaluate(() => document.documentElement.dataset.sbwBridge), p).toBe('1');
      }
      await tab.goto('https://seobandwagon.com/pricing/');
      expect(await tab.evaluate(() => document.documentElement.dataset.sbwBridge ?? null)).toBeNull();
      expect(await tab.evaluate(() => window.bridge({ type: 'ping' }, { wait: 1500 }))).toEqual({ timeout: true });

      await tab.goto('https://seobandwagon.com/framed/');
      const frame = tab.frameLocator('#f');
      await expect(frame.locator('h1')).toHaveText('/dashboard/api-keys/');
      const inner = tab.frames().find((f) => f !== tab.mainFrame());
      expect(await inner.evaluate(() => document.documentElement.dataset.sbwBridge ?? null)).toBeNull();
      expect(await inner.evaluate(() => window.bridge({ type: 'ping' }, { wait: 1500 }))).toEqual({ timeout: true });
    });

    await tab.goto('https://seobandwagon.com/dashboard/api-keys/');

    await test.step('ping: the version, as by ID', async () => {
      expect(await tab.evaluate(() => window.bridge({ type: 'ping' }))).toEqual({ response: { ok: true, version: '1.13.6' } });
    });

    await test.step('status: not answered yet, so the site falls back to ping', async () => {
      expect(await tab.evaluate(() => window.bridge({ type: 'status' }))).toEqual({ response: { ok: false } });
    });

    await test.step('ignored: another flag, or no port', async () => {
      expect(await tab.evaluate(() => window.bridge({ type: 'ping' }, { flag: 2, wait: 1500 }))).toEqual({ timeout: true });
      expect(await tab.evaluate(() => window.bridge({ type: 'ping' }, { port: false, wait: 1500 }))).toEqual({ timeout: true });
    });

    await test.step('connect: a bad key is refused and nothing is stored', async () => {
      expect(await tab.evaluate(() => window.bridge({ type: 'connect', apiKey: 'sbw_nope' })))
        .toEqual({ response: { ok: false, error: 'Invalid API key format' } });
      expect(await sw.evaluate(() => chrome.storage.sync.get({ apiKey: '' }))).toEqual({ apiKey: '' });
    });

    await test.step('connect: the key is verified with /v1/me, stored, and the account named', async () => {
      const answer = await tab.evaluate((key) => window.bridge({ type: 'connect', apiKey: key }), KEY);
      expect(answer).toEqual({ response: { ok: true, email: 'owner@example.com' } });
      expect(api).toContain('GET /v1/me');
      expect(await sw.evaluate(() => chrome.storage.sync.get({ apiKey: '' }))).toEqual({ apiKey: KEY });
    });

    expect(other).toEqual([]);
  } finally {
    await context.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
