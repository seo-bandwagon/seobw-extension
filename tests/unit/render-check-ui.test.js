// The Rendering section of the popup (src/popup/render-check.js), 1.13.8:
// "View as" analyzes the page again once the tab has reloaded with the other
// User-Agent (until 1.13.8 the popup kept the analysis from before), and the
// JavaScript-changed verdict is shown as a warning.
import { describe, it, expect, beforeEach, vi } from 'vitest';

await import('../../extension/src/lib/browser.js');
await import('../../extension/src/lib/ua-switch.js');
await import('../../extension/src/lib/html-diff.js');

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup({ setUa = { ok: true, presetId: 'googlebot-smartphone' }, raw } = {}) {
  const completed = [];
  const reanalyze = vi.fn();
  globalThis.SBWPerms = { hasAllUrls: async () => true, onAllUrlsGranted: () => () => {}, ALL_URLS_REASON: 'x' };
  globalThis.SBWCsv = { toCsv: () => '', csvFilename: () => 'x.csv' };
  globalThis.SBWPopup = {
    esc: (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]),
    section: (id, title, badge, body) => `<div class="section" data-section="${id}"><div class="section-header">${title}${badge}</div><div class="section-content">${body}</div></div>`,
    badge: (t, c) => `<span class="badge-mono ${c || ''}">${t}</span>`,
    setSeoStatus: vi.fn(),
    getCurrentTab: () => ({ id: 7, url: 'https://example.com/' }),
    reanalyze
  };
  const sent = [];
  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (msg, cb) => {
        sent.push(msg);
        if (msg.action === 'getUserAgent') cb({ presetId: 'default' });
        else if (msg.action === 'setUserAgent') cb(setUa);
        else if (msg.action === 'fetchRawHtml') cb({ html: raw, finalUrl: 'https://example.com/' });
        else cb(null);
      }
    },
    webNavigation: {
      onCompleted: {
        addListener: (fn) => completed.push(fn),
        removeListener: (fn) => { const i = completed.indexOf(fn); if (i >= 0) completed.splice(i, 1); }
      }
    }
  };
  return { completed, reanalyze, sent };
}

async function mount(data) {
  delete globalThis.SBWRenderCheckUI;
  await import(/* @vite-ignore */ '../../extension/src/popup/render-check.js?t=' + Math.random());
  document.body.innerHTML = '<div id="content"><div class="section" data-section="meta"></div></div>';
  globalThis.SBWRenderCheckUI.mount(document.getElementById('content'), data || { url: 'https://example.com/', meta: {} });
  await flush(); await flush();
}

describe('View as analyzes the page again (1.13.8)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('once the tab has reloaded, with the Rendering section open', async () => {
    const { completed, reanalyze } = setup();
    await mount();
    const select = document.getElementById('rcUaSelect');
    select.value = 'googlebot-smartphone';
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(reanalyze).not.toHaveBeenCalled();
    // Another tab, or a frame, finishing is not this reload.
    completed.slice().forEach((fn) => fn({ tabId: 8, frameId: 0 }));
    completed.slice().forEach((fn) => fn({ tabId: 7, frameId: 3 }));
    expect(reanalyze).not.toHaveBeenCalled();
    completed.slice().forEach((fn) => fn({ tabId: 7, frameId: 0 }));
    await flush();
    expect(reanalyze).toHaveBeenCalledWith('render');
    expect(completed).toHaveLength(0);
  });

  it('not when the switch failed', async () => {
    const { completed, reanalyze } = setup({ setUa: { error: 'dnr_failed' } });
    await mount();
    const select = document.getElementById('rcUaSelect');
    select.value = 'googlebot-smartphone';
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(completed).toHaveLength(0);
    expect(reanalyze).not.toHaveBeenCalled();
  });
});

describe('JavaScript changes a signal (1.13.8)', () => {
  it('reads as a warning naming what changed', async () => {
    const raw = '<html><head><title>Roofing</title><link rel="canonical" href="https://example.com/"><meta name="robots" content="index"></head><body><h1>Roofing</h1><p>Words here.</p></body></html>';
    setup({ raw });
    await mount({ url: 'https://example.com/', meta: { title: { text: 'Roofing' }, canonical: 'https://example.com/', robots: 'noindex' }, headings: { h1: ['Roofing'] }, content: { wordCount: 2 } });
    document.getElementById('rcCompareBtn').click();
    await flush(); await flush();
    const verdict = document.querySelector('.rc-verdict');
    expect(verdict.querySelector('.badge-mono').textContent).toBe('JavaScript changes the robots meta');
    expect(verdict.querySelector('.badge-mono').className).toContain('b-warn');
    expect(verdict.querySelector('.rc-signal-note').textContent).toMatch(/server sends one version of the robots meta/);
  });
});
