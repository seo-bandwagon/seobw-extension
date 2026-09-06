// jsdom tests for the SERP overlay content script (src/overlay/serp-overlay.js).
//
// Covers fix round 1's stats pipeline: the pending-row queue (item 4), the
// per-domain cache (item 5), chunked batches (item 6), the toolbar count
// spans surviving a Copy flash (item 9), the three stat-text states (item
// 10), skipping the toolbar on non-organic tabs (item 11), and the dropped
// #sbw-analyze hash (item 16).
//
// Every scenario stubs chrome.runtime.sendMessage to CAPTURE every message
// and chrome.storage.session with a Map-backed get/set, per the harness's
// privacy contract for this content script — after each scenario the
// captured payloads must contain only bare hostnames, never the query
// string, a title, or a snippet.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

await import('../../src/lib/serp.js');

let sentMessages;
let sessionStore;
let sendMessageImpl;

function isQuickBatch(msg) {
  return !!msg && msg.action === 'sbwFetch' && msg.path === '/domain/quick-batch';
}

function defaultSendMessageImpl(msg, cb) {
  if (isQuickBatch(msg)) {
    const domains = msg.init.body.domains;
    const results = {};
    domains.forEach((d) => { results[d] = { avgScore: 70, sampleSize: 2, schemaPercentage: 40, age: '1 year' }; });
    setTimeout(() => cb({ ok: true, status: 200, code: 'ok', data: { results, invalid: [] } }), 10);
    return;
  }
  setTimeout(() => cb({ ok: false, status: 0, code: 'network' }), 10);
}

function installChromeStub() {
  sentMessages = [];
  sessionStore = new Map();
  sendMessageImpl = defaultSendMessageImpl;

  window.chrome = {
    runtime: {
      sendMessage: (msg, cb) => {
        sentMessages.push(msg);
        sendMessageImpl(msg, cb);
      },
      getURL: (p) => p
    },
    storage: {
      session: {
        get(keys, cb) {
          const out = {};
          if (keys === null || keys === undefined) {
            sessionStore.forEach((v, k) => { out[k] = v; });
          } else if (typeof keys === 'string') {
            out[keys] = sessionStore.get(keys);
          } else if (Array.isArray(keys)) {
            keys.forEach((k) => { out[k] = sessionStore.get(k); });
          }
          cb(out);
        },
        set(obj, cb) {
          Object.keys(obj).forEach((k) => sessionStore.set(k, obj[k]));
          if (cb) cb();
        }
      }
    }
  };
}

function resultBlock(domain, index) {
  return `
    <div class="g">
      <div>
        <a href="https://${domain}/page-${index}"><h3>Result ${index}</h3></a>
        <div>Snippet text long enough to satisfy the qualifying-content gate, easily forty characters.</div>
      </div>
    </div>`;
}

function freshDom(domains) {
  document.body.innerHTML = `<div id="search">${domains.map(resultBlock).join('\n')}</div>`;
}

async function loadOverlay() {
  await import(/* @vite-ignore */ '../../src/overlay/serp-overlay.js?t=' + Math.random());
}

function bars() {
  return Array.from(document.querySelectorAll('.sbw-serp-bar'));
}

function barFor(domain) {
  const domainEl = Array.from(document.querySelectorAll('.sbw-serp-domain'))
    .find((el) => el.textContent === domain);
  return domainEl && domainEl.closest('.sbw-serp-bar');
}

function statTextFor(domain) {
  const bar = barFor(domain);
  const stat = bar && bar.querySelector('.sbw-serp-stat');
  return stat ? stat.textContent : undefined;
}

function quickBatchMessages() {
  return sentMessages.filter(isQuickBatch);
}

beforeEach(() => {
  vi.useFakeTimers();
  installChromeStub();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(() => Promise.resolve()) },
    configurable: true
  });
  window.history.pushState({}, '', '/search?q=plumbers+near+austin&gl=us&hl=en');
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

/* ---------- privacy: bare hostnames only, never the query ---------- */

describe('privacy: quick-batch payloads', () => {
  it('carry only bare hostnames and never the query string, a title, or a snippet', async () => {
    window.history.pushState({}, '', '/search?q=confidential+search+terms&gl=us&hl=en');
    freshDom(['alpha.example', 'beta.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);

    const msgs = quickBatchMessages();
    expect(msgs.length).toBeGreaterThan(0);
    msgs.forEach((msg) => {
      expect(Array.isArray(msg.init.body.domains)).toBe(true);
      msg.init.body.domains.forEach((d) => {
        expect(d).not.toMatch(/\s/);
        expect(d).not.toMatch(/^https?:/);
      });
    });

    const raw = JSON.stringify(sentMessages);
    expect(raw).not.toContain('confidential');
    expect(raw).not.toContain('search terms');
    expect(raw).not.toContain('Result 1');
    expect(raw).toContain('alpha.example');
    expect(raw).toContain('beta.example');
  });

  it('caches resolved stats under a per-domain key, never a query/hostname key', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);

    const keys = Array.from(sessionStore.keys());
    expect(keys).toContain('sbwSerpStat::first.example');
    keys.forEach((k) => expect(k).not.toMatch(/plumbers|austin|search/));
  });
});

/* ---------- item 4: pending-row queue (mid-flight rows never dropped) ---------- */

describe('fix round 1, item 4: pending-row queue', () => {
  it('queues a result appended mid-flight and fetches it in a second call once the first settles', async () => {
    freshDom(['first.example']);
    sendMessageImpl = (msg, cb) => {
      if (isQuickBatch(msg)) {
        setTimeout(() => {
          const results = {};
          msg.init.body.domains.forEach((d) => { results[d] = { avgScore: 55, sampleSize: 1 }; });
          cb({ ok: true, status: 200, code: 'ok', data: { results, invalid: [] } });
        }, 1500);
        return;
      }
      setTimeout(() => cb({ ok: false, code: 'network' }), 10);
    };

    await loadOverlay();
    await vi.advanceTimersByTimeAsync(0);
    expect(quickBatchMessages().length).toBe(1);
    expect(quickBatchMessages()[0].init.body.domains).toEqual(['first.example']);

    // Append a new result while the first request is still in flight.
    document.querySelector('#search').insertAdjacentHTML('beforeend', resultBlock('second.example', 2));

    // Debounced rescan (500ms) fires well before the 1500ms reply — the new
    // row must get a bar and sit pending, not be silently dropped.
    await vi.advanceTimersByTimeAsync(500);
    expect(quickBatchMessages().length).toBe(1); // still just the first request
    expect(statTextFor('second.example')).toBe('—');

    // Let the first request resolve (total elapsed 1500ms) — its `finally`
    // must drain the queued row into a second request.
    await vi.advanceTimersByTimeAsync(1000);
    expect(quickBatchMessages().length).toBe(2);
    expect(quickBatchMessages()[1].init.body.domains).toEqual(['second.example']);

    // Let the second request resolve.
    await vi.advanceTimersByTimeAsync(1500);
    expect(statTextFor('second.example')).not.toBe('—');
    expect(statTextFor('first.example')).not.toBe('—');
  });
});

/* ---------- item 5: per-domain cache ---------- */

describe('fix round 1, item 5: per-domain cache', () => {
  it('does not re-request a domain already resolved, even when it reappears in a new row', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(quickBatchMessages().length).toBe(1);
    expect(quickBatchMessages()[0].init.body.domains).toEqual(['first.example']);

    // A second block reusing the already-resolved domain, plus one new
    // domain — only the new domain should ever go out.
    document.querySelector('#search').insertAdjacentHTML('beforeend', resultBlock('first.example', 2));
    document.querySelector('#search').insertAdjacentHTML('beforeend', resultBlock('second.example', 3));

    await vi.advanceTimersByTimeAsync(600);
    const msgs = quickBatchMessages();
    expect(msgs.length).toBe(2);
    expect(msgs[1].init.body.domains).toEqual(['second.example']);
  });
});

/* ---------- item 6: chunked batches for >20 domains ---------- */

describe('fix round 1, item 6: chunked batches', () => {
  it('splits 25 domains into two requests of 20 and 5, and every bar resolves', async () => {
    const domains = Array.from({ length: 25 }, (_, i) => `domain${i + 1}.example`);
    freshDom(domains);
    await loadOverlay();

    // First chunk (20) resolves...
    await vi.advanceTimersByTimeAsync(20);
    // ...which drains the remaining 5 into a second request.
    await vi.advanceTimersByTimeAsync(20);

    const msgs = quickBatchMessages();
    expect(msgs.length).toBe(2);
    const sizes = msgs.map((m) => m.init.body.domains.length).sort((a, b) => a - b);
    expect(sizes).toEqual([5, 20]);

    domains.forEach((d) => {
      expect(statTextFor(d)).not.toBe('—');
      expect(statTextFor(d)).not.toBe('No data');
    });
  });
});

/* ---------- item 9: toolbar count spans survive a flash ---------- */

describe('fix round 1, item 9: toolbar count survives a Copy flash', () => {
  it('keeps updating [data-role="copy-count"] after the button has flashed "Copied"', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);

    const toolbar = document.querySelector('.sbw-serp-tools');
    const copyBtn = toolbar.querySelectorAll('button')[0];
    copyBtn.click();
    await vi.advanceTimersByTimeAsync(0); // let the clipboard promise settle and flash apply

    document.querySelector('#search').insertAdjacentHTML('beforeend', resultBlock('second.example', 2));
    await vi.advanceTimersByTimeAsync(600);

    const countEl = toolbar.querySelector('[data-role="copy-count"]');
    expect(countEl).not.toBeNull();
    expect(countEl.textContent).toBe('2');
  });
});

/* ---------- item 10: three stat-text states ---------- */

describe('fix round 1, item 10: stat-text states', () => {
  it('shows the pending placeholder before anything resolves', async () => {
    freshDom(['first.example']);
    sendMessageImpl = (msg, cb) => {
      setTimeout(() => cb({ ok: true, status: 200, code: 'ok', data: { results: {}, invalid: [] } }), 5000);
    };
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(0);
    expect(statTextFor('first.example')).toBe('—');
  });

  it('shows "No data" when the server has nothing for the domain', async () => {
    freshDom(['first.example']);
    sendMessageImpl = (msg, cb) => {
      setTimeout(() => cb({ ok: true, status: 200, code: 'ok', data: { results: { 'first.example': null }, invalid: [] } }), 10);
    };
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(statTextFor('first.example')).toBe('No data');
  });

  it('shows "No score yet · N captures" rather than the old "Score —" when avgScore is null but captures exist', async () => {
    freshDom(['first.example']);
    sendMessageImpl = (msg, cb) => {
      setTimeout(() => cb({
        ok: true, status: 200, code: 'ok',
        data: { results: { 'first.example': { avgScore: null, sampleSize: 3 } }, invalid: [] }
      }), 10);
    };
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(statTextFor('first.example')).toBe('No score yet · 3 captures');
  });

  it('shows "Unavailable" with a title attribute when the worker bridge fails', async () => {
    freshDom(['first.example']);
    sendMessageImpl = (msg, cb) => {
      setTimeout(() => cb({ ok: false, status: 0, code: 'network' }), 10);
    };
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(statTextFor('first.example')).toBe('Unavailable');
    const bar = barFor('first.example');
    expect(bar.querySelector('.sbw-serp-stat').getAttribute('title')).toBe('Could not reach SEO Bandwagon');
  });
});

/* ---------- item 11: skip the toolbar on non-organic tabs ---------- */

describe('fix round 1, item 11: no toolbar without an organic result', () => {
  it('renders no toolbar when there is no #rso/#search container with an h3 at all (e.g. Images tab)', async () => {
    document.body.innerHTML = '<div id="isr"><div>Images grid, no h3 anywhere</div></div>';
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('.sbw-serp-tools')).toBeNull();
  });

  it('renders no toolbar when #search exists but has no h3 (e.g. a zero-result page)', async () => {
    document.body.innerHTML = '<div id="search"><div>No results found.</div></div>';
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('.sbw-serp-tools')).toBeNull();
  });

  it('still renders the toolbar on a normal results page', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('.sbw-serp-tools')).not.toBeNull();
  });
});

/* ---------- item 16: no #sbw-analyze hash ---------- */

describe('fix round 1, item 16: dropped #sbw-analyze hash', () => {
  it('links the Analyze button straight to the result URL, with no hash appended', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    const link = document.querySelector('.sbw-serp-analyze');
    expect(link.getAttribute('href')).toBe('https://first.example/page-0');
    expect(link.getAttribute('href')).not.toContain('#');
  });
});
