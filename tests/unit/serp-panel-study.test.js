// The popup on a Google results page (src/popup/serp-panel.js) in a tab the
// AI Overview study opened (1.13.3): the overlay's 'serpStatus' says so
// (`study: true`, `figures.state: 'study_tab'`), and the popup says figures
// and keyword data are off there and offers no "Load figures" or "Show
// keyword data". An ordinary tab keeps its buttons.

import { describe, it, expect, beforeEach, vi } from 'vitest';

await import('../../extension/src/lib/serp.js');
await import('../../extension/src/lib/serp-figures.js');
await import('../../extension/src/lib/serp-keywords.js');

let status;

function installGlobals() {
  globalThis.SBWPopup = { esc: (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) };
  globalThis.SBWConsent = { acceptance: vi.fn(async () => ({ acceptedAt: '2026-11-01T00:00:00.000Z', version: 1 })) };
  globalThis.SBWSerpSettingsUI = { render: vi.fn() };
  window.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (msg, cb) => cb(undefined),
      getURL: (p) => 'chrome-extension://test/' + p
    },
    tabs: {
      sendMessage: (tabId, msg, cb) => cb(msg.action === 'serpStatus' ? status : undefined),
      create: vi.fn()
    },
    storage: {
      sync: { get: (defaults, cb) => cb({ apiKey: 'sbw_test_key' }) },
      local: { get: vi.fn(async () => ({})) }
    }
  };
}

async function panel() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await globalThis.SBWSerpPanel.render(container, { id: 7 });
  return container;
}

const buttons = (container, attr) => Array.from(container.querySelectorAll(`[${attr}]`)).map((b) => b.getAttribute(attr));

beforeEach(async () => {
  document.body.innerHTML = '';
  installGlobals();
  delete globalThis.SBWSerpPanel;
  await import(/* @vite-ignore */ '../../extension/src/popup/serp-panel.js?t=' + Math.random());
});

describe('the popup on a results page', () => {
  it('in a study tab says figures and keyword data are off, with no button to load either', async () => {
    status = {
      rows: 10, headings: 10, features: [], study: true,
      figures: { state: 'study_tab', code: null, loaded: 0 },
      keywords: { on: false, state: 'idle' }
    };
    const container = await panel();
    const account = container.querySelector('#serpAccount').textContent;
    expect(account).toContain('Figures are off in a study search.');
    expect(account).not.toContain('Figures are off: they send');
    expect(buttons(container, 'data-account')).not.toContain('load');
    expect(container.querySelector('#serpKeywords').textContent).toContain('Keyword data is off in a study search.');
    expect(buttons(container, 'data-keywords')).not.toContain('load');
    expect(container.querySelector('#serpKeywords').textContent).not.toContain('operator');
  });

  it('in an ordinary tab where nothing was asked yet still offers Load figures and Show keyword data', async () => {
    status = {
      rows: 10, headings: 10, features: [], study: false,
      figures: { state: 'idle', code: null, loaded: 0 },
      keywords: { on: true, state: 'idle', hasKey: true, accepted: true, search: null }
    };
    const container = await panel();
    expect(container.querySelector('#serpAccount').textContent).not.toContain('study search');
    expect(buttons(container, 'data-account')).toContain('load');
    expect(buttons(container, 'data-keywords')).toContain('load');
  });
});
