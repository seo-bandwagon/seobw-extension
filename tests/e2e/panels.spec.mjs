// The two panels open each other (1.13.10, openPanel() in src/lib/panels.js),
// in Chromium with the extension loaded: Citations' "Page checks →" and the
// checks panel's "Citations & link building →", each clicked, and which
// panel document Chromium then has open, read from the worker with
// runtime.getContexts. openPanel() calls sidePanel.setOptions() and
// sidePanel.open() with no await between the click and open(); this shows
// that the panel open is the one setOptions() named.
//
// Each panel page is opened as a tab here (Playwright can't click inside a
// side panel), so the tab in front is the page itself and the side panel
// opens for that tab. Nothing leaves the runner: every http(s) request is
// aborted.

import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';

const EXTENSION = path.resolve('extension');

async function launch() {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
      '--no-sandbox',
      '--host-resolver-rules=MAP * ~NOTFOUND'
    ]
  });
  await context.route('**/*', (route) => (/^https?:/.test(route.request().url()) ? route.abort() : route.continue()));
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  return { context, sw, id: new URL(sw.url()).host };
}

// The side panel documents open now. Chromium reports a side panel
// context's tabId as -1 even for a tab's own panel (measured here, Playwright
// 1.64.1's Chromium), so the document is what is compared.
const sidePanels = (sw) => sw.evaluate(async () =>
  (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).map((c) => c.documentUrl));

// Each direction in its own browser: a panel left open in a window shows
// the manifest's default panel (Citations) on the next tab, which would read
// as the second click's result.
test("Citations' Page checks opens the checks panel for the tab in front, in the click", async () => {
  const { context, sw, id } = await launch();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/src/sidepanel/sidepanel.html`);
    // The tab ID the button will use, held before the click (spTabId is a
    // top-level let of the classic script, so the page's global scope): the
    // tab in front of this page's window, which tabs.onActivated keeps
    // current (the install's welcome tab, opened after this page loaded, can
    // be the one in front here).
    await page.waitForFunction(() => typeof spTabId === 'number');
    const front = await sw.evaluate(async (url) => {
      const [mine] = await chrome.tabs.query({ url });
      const [active] = await chrome.tabs.query({ active: true, windowId: mine.windowId });
      return active.id;
    }, page.url());
    await expect.poll(() => page.evaluate(() => spTabId)).toBe(front);
    expect(await sidePanels(sw)).toEqual([]);
    await page.click('#spPageChecks');
    await expect.poll(() => sidePanels(sw)).toEqual([`chrome-extension://${id}/src/panel/panel.html`]);
  } finally {
    await context.close();
  }
});

test("the checks panel's Citations opens Citations for the tab in front, in the click", async () => {
  const { context, sw, id } = await launch();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/src/panel/panel.html`);
    // Rendered for a page it can't check, after which init() has bound the
    // buttons (paint() returns before its first await on such a tab).
    await expect(page.locator('#pnChecks')).toContainText('Open an http or https page');
    expect(await sidePanels(sw)).toEqual([]);
    await page.click('#pnCitations');
    await expect.poll(() => sidePanels(sw)).toEqual([`chrome-extension://${id}/src/sidepanel/sidepanel.html`]);
  } finally {
    await context.close();
  }
});
