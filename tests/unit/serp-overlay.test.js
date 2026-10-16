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

await import('../../extension/src/lib/serp.js');

let sentMessages;
let sendMessageImpl;

// #50: the overlay asks the worker for stats with { action: 'serpStats',
// domains }; the worker owns the cache and the API call.
function isQuickBatch(msg) {
  return !!msg && msg.action === 'serpStats';
}

function defaultSendMessageImpl(msg, cb) {
  if (isQuickBatch(msg)) {
    const domains = msg.domains;
    const results = {};
    domains.forEach((d) => { results[d] = { avgScore: 70, sampleSize: 2, schemaPercentage: 40, age: '1 year' }; });
    setTimeout(() => cb({ ok: true, status: 200, code: 'ok', data: { results, invalid: [] } }), 10);
    return;
  }
  setTimeout(() => cb({ ok: false, status: 0, code: 'network' }), 10);
}

function installChromeStub() {
  sentMessages = [];
  sendMessageImpl = defaultSendMessageImpl;

  window.chrome = {
    runtime: {
      sendMessage: (msg, cb) => {
        sentMessages.push(msg);
        sendMessageImpl(msg, cb);
      },
      // What Chrome really returns. A link to it from google.com is blocked
      // (ERR_BLOCKED_BY_CLIENT): nothing in the manifest is web-accessible.
      getURL: (p) => 'chrome-extension://dphmaddiedhkejfhabkfdenfphjljioj/' + p
    },
    // A real content script may not use chrome.storage.session ("Access to
    // storage is not allowed from this context"). Until 1.7.6 this stub
    // allowed it, which is how the overlay's never-working cache (#50) passed.
    storage: {
      session: {
        get: vi.fn(() => { throw new Error('Access to storage is not allowed from this context.'); }),
        set: vi.fn(() => { throw new Error('Access to storage is not allowed from this context.'); })
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
  await import(/* @vite-ignore */ '../../extension/src/overlay/serp-overlay.js?t=' + Math.random());
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
      expect(Array.isArray(msg.domains)).toBe(true);
      msg.domains.forEach((d) => {
        expect(d).not.toMatch(/\s/);
        expect(d).not.toMatch(/^https?:/);
      });
    });

    // What can reach the network: the serpStats lookups. (#45's serpCollect
    // messages carry the search to the extension's own worker, which keeps
    // it in session storage and sends nothing.)
    const raw = JSON.stringify(sentMessages.filter((m) => m && m.action !== 'serpCollect'));
    expect(raw).not.toContain('confidential');
    expect(raw).not.toContain('search terms');
    expect(raw).not.toContain('Result 1');
    expect(raw).toContain('alpha.example');
    expect(raw).toContain('beta.example');
  });

  it('never touches chrome.storage from the content script (#50)', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(window.chrome.storage.session.get).not.toHaveBeenCalled();
    expect(window.chrome.storage.session.set).not.toHaveBeenCalled();
    expect(statTextFor('first.example')).toMatch(/^Score /);
  });

  it('sends the worker nothing but the domains', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    quickBatchMessages().forEach((m) => expect(Object.keys(m).sort()).toEqual(['action', 'domains']));
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
          msg.domains.forEach((d) => { results[d] = { avgScore: 55, sampleSize: 1 }; });
          cb({ ok: true, status: 200, code: 'ok', data: { results, invalid: [] } });
        }, 1500);
        return;
      }
      setTimeout(() => cb({ ok: false, code: 'network' }), 10);
    };

    await loadOverlay();
    await vi.advanceTimersByTimeAsync(0);
    expect(quickBatchMessages().length).toBe(1);
    expect(quickBatchMessages()[0].domains).toEqual(['first.example']);

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
    expect(quickBatchMessages()[1].domains).toEqual(['second.example']);

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
    expect(quickBatchMessages()[0].domains).toEqual(['first.example']);

    // A second block reusing the already-resolved domain, plus one new
    // domain — only the new domain should ever go out.
    document.querySelector('#search').insertAdjacentHTML('beforeend', resultBlock('first.example', 2));
    document.querySelector('#search').insertAdjacentHTML('beforeend', resultBlock('second.example', 3));

    await vi.advanceTimersByTimeAsync(600);
    const msgs = quickBatchMessages();
    expect(msgs.length).toBe(2);
    expect(msgs[1].domains).toEqual(['second.example']);
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
    const sizes = msgs.map((m) => m.domains.length).sort((a, b) => a - b);
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

/* ---------- issue #41: /goto results ---------- */

describe('issue #41: results linked through Google /goto redirects', () => {
  it('draws a bar for a /goto result and opens it through Google\'s link', async () => {
    document.body.innerHTML = `<div id="search"><div id="rso"><div class="g"><div>
      <a href="/goto?url=CAESopaque"><h3>Goto result</h3></a>
      <cite>https://goto-site.example › docs</cite>
      <div>Snippet text long enough to satisfy the qualifying-content gate, easily forty characters.</div>
    </div></div></div></div>`;
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(barFor('goto-site.example')).toBeTruthy();
    const link = barFor('goto-site.example').querySelector('.sbw-serp-analyze');
    expect(link.getAttribute('href')).toMatch(/\/goto\?url=CAESopaque$/);
    quickBatchMessages().forEach((m) => expect(m.domains).toContain('goto-site.example'));
  });
});

/* ---------- issue #37: Copy PAA / Copy results ---------- */

describe('issue #37: copying from the SERP toolbar', () => {
  // In a real content script navigator.clipboard.writeText() rejects with
  // "Write permission denied", so the copy must not depend on it.
  let copied;
  function paaDom() {
    document.body.innerHTML = `<div id="search"><div id="rso">${resultBlock('first.example', 0)}
      <div data-q="How do widgets work?">How do widgets work?</div>
      <div data-q="Are widgets safe?">Are widgets safe?</div></div></div>`;
  }
  function stubExecCommand(result) {
    copied = null;
    document.execCommand = vi.fn((cmd) => {
      if (cmd !== 'copy') return false;
      const ta = document.querySelector('textarea[aria-hidden="true"]');
      if (result) copied = ta && ta.value;
      return result;
    });
  }
  const button = (label) => Array.from(document.querySelectorAll('.sbw-serp-tools button'))
    .find((b) => b.textContent.startsWith(label));
  const flashText = (btn) => btn.querySelector('[data-role="flash"]')?.textContent;

  afterEach(() => { delete document.execCommand; });

  it('copies the PAA questions without the async clipboard API', async () => {
    stubExecCommand(true);
    navigator.clipboard.writeText = vi.fn(() => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')));
    paaDom();
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);

    button('Copy PAA').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(copied).toBe('How do widgets work?\nAre widgets safe?');
    expect(flashText(button('Copy PAA'))).toBe('Copied');
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(document.querySelector('textarea[aria-hidden="true"]')).toBeNull();
  });

  it('copies results the same way', async () => {
    stubExecCommand(true);
    paaDom();
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);

    button('Copy results').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(copied.split('\n')[0]).toMatch(/^Query\tPosition\tURL/);
    expect(copied).toContain('first.example');
    expect(flashText(button('Copy results'))).toBe('Copied');
  });

  it('falls back to the async clipboard API when execCommand refuses', async () => {
    stubExecCommand(false);
    navigator.clipboard.writeText = vi.fn(() => Promise.resolve());
    paaDom();
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);

    button('Copy PAA').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('How do widgets work?\nAre widgets safe?');
    expect(flashText(button('Copy PAA'))).toBe('Copied');
  });

  it('says "Copy failed" and logs why when both ways fail', async () => {
    stubExecCommand(false);
    navigator.clipboard.writeText = vi.fn(() => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    paaDom();
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);

    button('Copy PAA').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(flashText(button('Copy PAA'))).toBe('Copy failed');
    expect(warn).toHaveBeenCalledWith('[SBW] copy failed:', 'NotAllowedError', 'Write permission denied.');
    warn.mockRestore();
  });

  it('gives focus back to whatever had it', async () => {
    stubExecCommand(true);
    paaDom();
    document.body.insertAdjacentHTML('afterbegin', '<input id="q" value="search box">');
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    document.getElementById('q').focus();

    button('Copy PAA').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.activeElement.id).toBe('q');
  });
});

/* ---------- issue #44: say when there is nothing to copy or export ---------- */

describe('issue #44: empty results are reported, not exported', () => {
  // A result heading the parser can't place: a /goto link whose breadcrumb
  // isn't a URL. The toolbar still renders (there is an organic h3).
  function unreadableDom() {
    document.body.innerHTML = `<div id="search"><div id="rso"><div class="g"><div>
      <a href="/goto?url=CAESopaque"><h3>Unplaceable result</h3></a>
      <cite>10+ comments · 3 years ago</cite>
      <div>Snippet text long enough to satisfy the qualifying-content gate, easily forty characters.</div>
    </div></div></div></div>`;
  }
  const button = (label) => Array.from(document.querySelectorAll('.sbw-serp-tools button'))
    .find((b) => b.textContent.startsWith(label));
  const flashText = (btn) => btn.querySelector('[data-role="flash"]')?.textContent;
  let warn;
  beforeEach(() => {
    document.execCommand = vi.fn(() => true);
    navigator.clipboard.writeText = vi.fn(() => Promise.resolve());
    URL.createObjectURL = vi.fn(() => 'blob:stub');
    URL.revokeObjectURL = vi.fn();
    // jsdom can't follow the download link's click; the blob URL is the signal
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    delete document.__sbwWarnedUnparsed;
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    delete document.execCommand;
    vi.restoreAllMocks();
  });

  it('Copy results says "No results found" and copies nothing', async () => {
    unreadableDom();
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(button('Copy results').textContent).toBe('Copy results (0)');

    button('Copy results').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(flashText(button('Copy results'))).toBe('No results found');
    expect(document.execCommand).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('Export CSV says "No results found" and downloads nothing', async () => {
    unreadableDom();
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);

    button('Export CSV').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(flashText(button('Export CSV'))).toBe('No results found');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('Copy PAA with no questions leaves the clipboard alone', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);

    button('Copy PAA').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(flashText(button('Copy PAA'))).toBe('No questions found');
    expect(document.execCommand).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('still exports when there are results', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);

    button('Export CSV').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(flashText(button('Export CSV'))).toBeUndefined();
  });

  it('warns once in the console when a page with result headings yields no rows', async () => {
    unreadableDom();
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    // a later DOM change triggers a rescan; the warning must not repeat
    document.querySelector('#rso').insertAdjacentHTML('beforeend', '<div>more</div>');
    await vi.advanceTimersByTimeAsync(600);

    const ours = warn.mock.calls.filter((c) => String(c[0]).includes('SERP overlay read 0 results'));
    expect(ours.length).toBe(1);
    expect(ours[0][0]).toContain('1 result headings (1 Google redirect links)');
  });

  it('does not warn on a page it reads fine', async () => {
    freshDom(['first.example', 'second.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('read 0 results'))).toBe(false);
  });
});

/* ---------- 1.7.7: #54 flash text, #55 SERP filename, #45 TSV column, #56 status ---------- */

describe('1.7.7 SERP toolbar fixes', () => {
  const button = (label) => Array.from(document.querySelectorAll('.sbw-serp-tools button'))
    .find((b) => b.textContent.startsWith(label));
  let copied;
  beforeEach(() => {
    copied = null;
    document.execCommand = vi.fn(() => { copied = document.querySelector('textarea[aria-hidden="true"]').value; return true; });
  });
  afterEach(() => { delete document.execCommand; vi.restoreAllMocks(); });

  it('#54: once the flash ends, the button\'s text is only its label', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    button('Copy results').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(button('Copy results').querySelector('[data-role="flash"]').textContent).toBe('Copied');
    await vi.advanceTimersByTimeAsync(1300);
    expect(button('Copy results').textContent).toBe('Copy results (1)');
  });

  it('#55: the SERP CSV is named with the page number and the time to the second', async () => {
    window.history.pushState({}, '', '/search?q=seo+stats+chrome&start=20');
    URL.createObjectURL = vi.fn(() => 'blob:stub');
    URL.revokeObjectURL = vi.fn();
    let name = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { name = this.download; });
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    button('Export CSV').click();
    expect(name).toMatch(/^serp-seo-stats-chrome-p3-\d{4}-\d{2}-\d{2}-\d{6}\.csv$/);
  });

  it('#45: Copy results carries the approximate and exact absolute positions, at the end', async () => {
    window.history.pushState({}, '', '/search?q=x&start=10');
    freshDom(['first.example', 'second.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    button('Copy results').click();
    const [header, r1, r2] = copied.split('\n');
    expect(header.split('\t').slice(-3)).toEqual(['Absolute position (approx.)', 'Absolute position', 'Collection notes']);
    expect([r1.split('\t').at(-3), r2.split('\t').at(-3)]).toEqual(['11', '12']);
    // Page 2 on its own: the exact overall rank can't be known.
    expect([r1.split('\t').at(-2), r2.split('\t').at(-2)]).toEqual(['', '']);
  });

  it('#56: answers the popup with what the page actually yielded', async () => {
    let handler = null;
    window.chrome.runtime.onMessage = { addListener: (fn) => { handler = fn; } };
    document.body.innerHTML = `<div id="search"><div id="rso">${resultBlock('first.example', 0)}
      <div data-q="Is it good?">Is it good?</div></div></div>`;
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    let reply = null;
    handler({ action: 'serpStatus' }, {}, (r) => { reply = r; });
    expect(reply).toEqual({ rows: 1, headings: 1, questions: 1 });
    expect(handler({ action: 'somethingElse' }, {}, () => {})).toBeUndefined();
  });
});

/* ---------- #45: collect pages, one click per page ---------- */

describe('#45: collecting result pages', () => {
  const button = (label) => Array.from(document.querySelectorAll('.sbw-serp-tools button'))
    .find((b) => b.textContent.startsWith(label));
  let copied;

  // The worker's serpCollect, in memory, using the real combining logic.
  async function workerStub() {
    await import('../../extension/src/lib/serp-collect.js');
    const C = globalThis.SBWSerpCollect;
    const store = {};
    sendMessageImpl = (msg, cb) => {
      if (msg.action !== 'serpCollect') return defaultSendMessageImpl(msg, cb);
      const key = C.collectionKey(msg.search);
      let col = store[key] || C.emptyCollection(key);
      let r = {};
      if (msg.op === 'add') { r = C.addPage(col, msg.page); if (!r.error) col = store[key] = r.collection; }
      if (msg.op === 'clear') { delete store[key]; col = C.emptyCollection(key); }
      const combined = C.combine(col);
      setTimeout(() => cb({ added: r.added, moved: r.moved, error: r.error, summary: combined.summary, line: C.describe(combined.summary), rows: combined.rows }), 5);
    };
    return store;
  }

  beforeEach(() => {
    copied = null;
    document.execCommand = vi.fn(() => {
      copied = document.querySelector('textarea[aria-hidden="true"]').value;
      return true;
    });
  });
  afterEach(() => { delete document.execCommand; });

  it('never adds a page by itself: loading the page only reads what was added before', async () => {
    window.history.pushState({}, '', '/search?q=crm&gl=us');
    freshDom(['a.example', 'b.example']);
    await workerStub();
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(100);
    const ops = sentMessages.filter((m) => m.action === 'serpCollect').map((m) => m.op);
    expect(ops).toEqual(['get']);
  });

  it('adds the page on a click and copies one combined list with absolute positions', async () => {
    const store = await workerStub();
    window.history.pushState({}, '', '/search?q=crm&gl=us');
    freshDom(['a.example', 'b.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    button('Add page 1').click();
    await vi.advanceTimersByTimeAsync(50);

    // Page 2, after the person follows Google's Next link.
    document.querySelectorAll('.sbw-serp-tools').forEach((t) => t.remove());
    window.history.pushState({}, '', '/search?q=crm&gl=us&start=10');
    // b.example/page-1 again (Google's pages overlap), then a new result.
    document.body.innerHTML = `<div id="search">${resultBlock('b.example', 1)}${resultBlock('c.example', 2)}</div>`;
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    button('Add page 2').click();
    await vi.advanceTimersByTimeAsync(50);

    expect(Object.keys(store)).toHaveLength(1);
    expect(document.querySelector('[data-role="collect-line"]').textContent).toMatch(/Pages 1, 2 added: 3 results/);
    button('Copy collected').click();
    const lines = copied.split('\n');
    const cols = lines[0].split('\t');
    const at = (line, name) => line.split('\t')[cols.indexOf(name)];
    expect(lines.slice(1).map((l) => [at(l, 'Domain'), at(l, 'Page'), at(l, 'Position'), at(l, 'Absolute position')])).toEqual([
      ['a.example', '1', '1', '1'], ['b.example', '1', '2', '2'], ['c.example', '2', '2', '3']
    ]);
  });

  it('offers Google\'s own Next link, and finds Google\'s Web tab link when clicked', async () => {
    await workerStub();
    window.history.pushState({}, '', '/search?q=crm');
    document.body.innerHTML = `<div id="search">${resultBlock('a.example', 0)}</div>
      <a id="pnnext" href="/search?q=crm&start=10">Next</a>`;
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    const links = [...document.querySelectorAll('.sbw-serp-collect a')].map((a) => [a.textContent, new URL(a.href).search]);
    expect(links).toEqual([['Next page →', '?q=crm&start=10']]);
    // Google fills the "More" menu after load; the button looks then.
    const more = document.createElement('a'); more.href = '/search?q=crm&udm=web'; more.textContent = 'Web';
    document.body.append(more);
    const assign = vi.fn();
    const orig = window.location;
    delete window.location; window.location = Object.assign(new URL(orig.href), { assign, search: orig.search });
    try {
      button('Web results only').click();
      expect(assign).toHaveBeenCalledWith(expect.stringContaining('udm=web'));
    } finally { window.location = orig; }
  });

  it('shows no Web results only button on a Web-only page', async () => {
    await workerStub();
    window.history.pushState({}, '', '/search?q=crm&udm=web');
    freshDom(['a.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(button('Web results only')).toBeUndefined();
  });
});

/* ---------- 1.8.2: a signed-out user's "Connect your account" ---------- */

// The overlay is a content script, so its links are navigations from
// google.com. Until 1.8.2 "Connect your account" pointed at the extension's
// options page, which Chrome blocks from a web page ("This page has been
// blocked by Chrome"). It now opens the site's connect page, a URL the worker
// builds and sends back with the no_key/unauthorized reply.
describe('1.8.2: Connect your account opens the site, not an extension page', () => {
  const CONNECT = 'https://seobandwagon.com/dashboard/api-keys'
    + '?utm_source=chrome_extension&utm_medium=extension&utm_campaign=serp_overlay';

  function replyWith(reply) {
    sendMessageImpl = (msg, cb) => {
      if (isQuickBatch(msg)) { setTimeout(() => cb(reply), 10); return; }
      defaultSendMessageImpl(msg, cb);
    };
  }

  for (const code of ['no_key', 'unauthorized']) {
    it(`links each bar to the connect page the worker sent (${code})`, async () => {
      replyWith({ ok: false, status: code === 'no_key' ? 0 : 401, data: null, code, connectUrl: CONNECT });
      freshDom(['alpha.example', 'beta.example']);
      await loadOverlay();
      await vi.advanceTimersByTimeAsync(50);

      for (const domain of ['alpha.example', 'beta.example']) {
        const link = barFor(domain).querySelector('a.sbw-serp-connect');
        expect(link).toBeTruthy();
        expect(link.textContent).toBe('Connect your account');
        expect(link.href).toBe(CONNECT);
        expect(link.href).not.toMatch(/^chrome-extension:/);
        expect(link.target).toBe('_blank');
      }
    });
  }

  it('shows the words without a link when the reply carries no usable URL', async () => {
    replyWith({ ok: false, status: 0, data: null, code: 'no_key', connectUrl: 'chrome-extension://x/src/options/options.html' });
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(statTextFor('alpha.example')).toBe('Connect your account');
    expect(barFor('alpha.example').querySelector('.sbw-serp-stat a')).toBeNull();
  });
});
