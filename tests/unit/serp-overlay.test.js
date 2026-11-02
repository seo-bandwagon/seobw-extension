// jsdom tests for the SERP overlay content script (src/overlay/serp-overlay.js).
//
// 1.10.2: the bar shows the result's position (no request to SEO Bandwagon),
// sits below the whole result, and Analyze hands the result to the worker,
// whose answer becomes one line under that result. Also covers the toolbar
// count spans surviving a Copy flash (fix round 1, item 9), skipping the
// toolbar on non-organic tabs (item 11), the dropped #sbw-analyze hash (item
// 16), copying, empty pages, and Collect.
//
// Every scenario stubs chrome.runtime.sendMessage to CAPTURE every message,
// and chrome.storage.session to throw as it does in a real content script.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

await import('../../extension/src/lib/serp.js');
await import('../../extension/src/lib/serp-figures.js');
await import('../../extension/src/lib/serp-settings.js');
await import('../../extension/src/lib/serp-table.js');

let sentMessages;
let sendMessageImpl;
let messageListeners;

// The worker's answer to a click on Analyze: it has started. The outcome
// comes later as a 'serpAnalysis' message (deliver(), below).
function defaultSendMessageImpl(msg, cb) {
  if (msg && msg.action === 'serpAnalyze') {
    setTimeout(() => cb({ ok: true, state: 'working' }), 10);
    return;
  }
  setTimeout(() => cb(undefined), 10);
}

function installChromeStub() {
  sentMessages = [];
  sendMessageImpl = defaultSendMessageImpl;

  messageListeners = [];
  window.chrome = {
    runtime: {
      sendMessage: (msg, cb) => {
        sentMessages.push(msg);
        sendMessageImpl(msg, cb || (() => {}));
      },
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
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

// A message from the worker, as chrome.tabs.sendMessage delivers it.
function deliver(msg) {
  messageListeners.forEach((fn) => fn(msg, {}, () => {}));
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

/* ---------- 1.10.2: nothing goes to SEO Bandwagon from Google ---------- */

describe('the results page sends only what the figures need, and never the search', () => {
  // 1.10.2 sent nothing from Google. 1.11.0 asks the worker for figures,
  // which sends nothing without a key and the figures accepted in Options
  // (tests/unit/serp-figures-service.test.js); what it is asked for is each
  // result's address and site, never the search terms.
  it('asks the worker for Collect and for the figures of each result, and nothing else', async () => {
    window.history.pushState({}, '', '/search?q=confidential+search+terms&gl=us&hl=en');
    freshDom(['alpha.example', 'beta.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    // serpCollect 'get' reads session storage in the worker; it sends nothing.
    expect(sentMessages.map((m) => [m.action, m.op])).toEqual([['serpCollect', 'get'], ['serpFigures', undefined]]);
    expect(sentMessages.some((m) => m.action === 'serpStats')).toBe(false);
    const figures = sentMessages.find((m) => m.action === 'serpFigures');
    expect(figures.items.map(({ url, domain }) => ({ url, domain }))).toEqual([
      { url: 'https://alpha.example/page-0', domain: 'alpha.example' },
      { url: 'https://beta.example/page-1', domain: 'beta.example' }
    ]);
    // Collect keys its session storage by the search, in the worker; the
    // figures, which leave the browser, carry no part of it.
    expect(JSON.stringify(figures)).not.toMatch(/confidential/);
  });

  it('never touches chrome.storage from the content script (#50)', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(window.chrome.storage.session.get).not.toHaveBeenCalled();
    expect(window.chrome.storage.session.set).not.toHaveBeenCalled();
  });
});

/* ---------- 1.10.2: the bar shows the position ---------- */

describe('1.10.2: each bar shows its result\'s position, below the whole result', () => {
  it('drops the pooled score for the organic position, with the whole-page position in its tooltip', async () => {
    document.body.innerHTML = `<div id="tads"><div data-text-ad="1"><a href="https://ad.example/"><h3>An ad</h3></a><div>Ad copy here.</div></div></div>
      <div id="search">${resultBlock('first.example', 0)}${resultBlock('second.example', 1)}</div>`;
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    const pos = (d) => barFor(d).querySelector('.sbw-serp-pos');
    expect([pos('first.example').textContent, pos('second.example').textContent]).toEqual(['#1', '#2']);
    expect(pos('second.example').title).toMatch(/^Organic position 2 on this page\. Counting everything on the page .*: 3\.$/);
    expect(document.querySelector('.sbw-serp-stat')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Score|captures|No data/);
  });

  it('says the same positions as Copy results', async () => {
    let copied = '';
    document.execCommand = vi.fn(() => { copied = document.querySelector('textarea[aria-hidden="true"]').value; return true; });
    document.body.innerHTML = `<div id="tads"><div data-text-ad="1"><a href="https://ad.example/"><h3>An ad</h3></a><div>Ad copy.</div></div></div>
      <div id="search">${resultBlock('first.example', 0)}${resultBlock('second.example', 1)}</div>`;
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    Array.from(document.querySelectorAll('.sbw-serp-tools button')).find((b) => b.textContent.startsWith('Copy results')).click();
    const [header, ...lines] = copied.split('\n');
    const cols = header.split('\t');
    const at = (l, name) => l.split('\t')[cols.indexOf(name)];
    expect(lines.map((l) => [at(l, 'Position'), at(l, 'Position counting everything')])).toEqual([['1', '2'], ['2', '3']]);
    expect(bars().map((b) => b.querySelector('.sbw-serp-pos').title.match(/(\d+)\.$/)[1])).toEqual(['2', '3']);
    delete document.execCommand;
  });

  it('goes after the description, not between the title and the description', async () => {
    document.body.innerHTML = `<div id="search"><div id="rso"><div class="MjjYud"><div class="g">
      <div class="title"><a href="https://first.example/page"><h3>A title</h3></a><cite>https://first.example</cite></div>
      <div class="VwiC3b">A description long enough to count as a real snippet for this result.</div>
      </div></div></div></div>`;
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    const bar = barFor('first.example');
    const desc = document.querySelector('.VwiC3b');
    expect(desc.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('.title').contains(bar)).toBe(false);
  });

  it('marks a result it can\'t place as an unknown site, and counts on past it', async () => {
    document.body.innerHTML = `<div id="search"><div id="rso">
      <div class="g"><div><a href="/goto?url=CAESabc"><h3>A forum thread</h3></a><cite>10+ comments · 3 years ago</cite>
        <div>Snippet text long enough to satisfy the qualifying-content gate, easily forty characters.</div></div></div>
      ${resultBlock('second.example', 1)}</div></div>`;
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(bars().map((b) => [b.querySelector('.sbw-serp-pos').textContent, b.querySelector('.sbw-serp-domain').textContent]))
      .toEqual([['#1', 'unknown site'], ['#2', 'second.example']]);
    // Analyze still opens it, through Google's own link.
    expect(bars()[0].querySelector('.sbw-serp-analyze').getAttribute('href')).toMatch(/\/goto\?url=CAESabc$/);
  });
});

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

describe('1.12.0: Analyze opens the page\'s checks under the result, on Google', () => {
  const click = (el, init = {}) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
  const checkMessages = () => sentMessages.filter((m) => m && m.action === 'serpPageCheck');
  // The newest copy of the overlay draws its row right under its own bar.
  const checkFor = (domain) => {
    const next = barFor(domain).nextElementSibling;
    return next && next.classList.contains('sbw-serp-check') ? next : null;
  };
  const ROW = {
    url: 'https://second.example/page-1', finalUrl: 'https://second.example/page-1', status: 200, redirected: false,
    title: { text: 'Second result, a title of a fair length', chars: 39, px: 372, cut: false, count: 1 },
    description: { text: '', chars: 0, px: 0, cut: false, count: 0 },
    h1: { count: 1, first: 'Second result' }, words: 1240, language: 'en', schema: ['Organization', 'FAQPage'],
    canonical: { href: 'https://second.example/page-1', target: 'self', count: 1 },
    indexable: { ok: false, reasons: ['noindex in the robots meta'] }, hreflang: { count: 0, issues: [] },
    tech: ['WordPress'], robots: { found: true, status: 200, blocked: ['GPTBot', 'ClaudeBot'], allowed: [] },
    llms: { found: false }, checklist: { score: 82, grade: 'B', issues: 3, top: ['Set to noindex'] }, source: 'html',
    checkedAt: '2026-11-02T10:04:00Z'
  };

  it('a plain click asks the worker for that page\'s checks and says it is checking', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    const notCancelled = click(document.querySelector('.sbw-serp-analyze'));
    expect(notCancelled).toBe(false);
    expect(checkMessages()).toEqual([{ action: 'serpPageCheck', items: [{ key: 'https://first.example/page-0', url: 'https://first.example/page-0' }] }]);
    expect(checkFor('first.example').textContent).toBe('Checking the page from its HTML…');
    expect(sentMessages.some((m) => m.action === 'serpAnalyze')).toBe(false);
  });

  it('shows the page\'s checks when the worker reports, from its HTML, with Full report', async () => {
    freshDom(['first.example', 'second.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    click(barFor('second.example').querySelector('.sbw-serp-analyze'));
    await vi.advanceTimersByTimeAsync(20);
    deliver({ action: 'serpPageChecked', key: 'https://second.example/page-1', state: 'done', row: ROW });
    const row = checkFor('second.example');
    const text = row.textContent;
    expect(text).toContain('from the page’s HTML');
    expect(text).toContain('Title39 chars · 372 px');
    expect(text).toContain('Descriptionmissing');
    expect(text).toContain('Words1,240');
    expect(text).toContain('SchemaOrganization, FAQPage');
    expect(text).toContain('Canonicalpoints to itself');
    expect(text).toContain('Indexableno: noindex in the robots meta');
    expect(text).toContain('AI crawlersblocked: GPTBot, ClaudeBot');
    expect(text).toContain('llms.txtno');
    expect(text).toContain('On-page checklist82/100 (B) · 3 issues');
    expect(row.querySelector('[data-flag="bad"] dt').textContent).toBe('Indexable');
    const checklist = Array.from(row.querySelectorAll('.sbw-check-item')).find((i) => i.querySelector('dt').textContent === 'On-page checklist');
    expect(checklist.querySelector('dd').title).toMatch(/not a ranking factor/);
    Array.from(row.querySelectorAll('button')).find((b) => b.textContent === 'Full report').click();
    expect(sentMessages.at(-1)).toEqual({ action: 'analyzeResult', url: 'https://second.example/page-1' });
  });

  it('a hidden result asks to sign in to Google or open it, and sends nothing', async () => {
    window.history.pushState({}, '', '/search?q=x');
    document.body.innerHTML = `<div id="search"><div id="rso"><div class="g"><div>
      <a href="/goto?url=CAESopaque"><h3>Goto result</h3></a>
      <cite>https://goto-site.example › docs</cite>
      <div>Snippet text long enough to satisfy the qualifying-content gate, easily forty characters.</div>
    </div></div></div></div>`;
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(click(barFor('goto-site.example').querySelector('.sbw-serp-analyze'))).toBe(false);
    expect(checkMessages()).toEqual([]);
    const row = checkFor('goto-site.example');
    expect(row.textContent).toMatch(/signed out of Google, so it can’t be checked here\. Sign in to Google, or open the result\./);
    expect(row.querySelector('a').getAttribute('href')).toMatch(/\/goto\?url=CAESopaque$/);
  });

  it('asks for site access in the extension\'s own window when there is none, and says so', async () => {
    sendMessageImpl = (msg, cb) => {
      if (msg.action === 'serpPageCheck') { setTimeout(() => cb({ state: 'needs_access' }), 5); return; }
      defaultSendMessageImpl(msg, cb);
    };
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    click(document.querySelector('.sbw-serp-analyze'));
    await vi.advanceTimersByTimeAsync(20);
    expect(checkFor('first.example').textContent).toMatch(/Allow access in the SEO Bandwagon window that opened/);
    deliver({ action: 'serpPageChecked', key: 'https://first.example/page-0', state: 'declined' });
    expect(checkFor('first.example').textContent).toMatch(/needs access to other sites/);
  });

  it('says what went wrong', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    click(document.querySelector('.sbw-serp-analyze'));
    deliver({ action: 'serpPageChecked', key: 'https://first.example/page-0', state: 'error', code: 'not_html' });
    expect(checkFor('first.example').textContent).toMatch(/isn't a web page/);
  });

  it('leaves Ctrl, Cmd, Shift, Alt and middle clicks to the browser', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    const link = document.querySelector('.sbw-serp-analyze');
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      expect(click(link, init)).toBe(true);
    }
    expect(checkMessages()).toEqual([]);
  });

  it('falls back to opening the link when the extension was reloaded under the page', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    window.chrome.runtime.sendMessage = () => { throw new Error('Extension context invalidated.'); };
    expect(click(document.querySelector('.sbw-serp-analyze'))).toBe(true);
  });

  it('Analyze top 10 asks for every result\'s page at once, hidden ones aside', async () => {
    window.history.pushState({}, '', '/search?q=x');
    const gotoBlock = `<div class="g"><div><a href="/goto?url=CAESh"><h3>Hidden</h3></a><cite>https://hidden.example › p</cite>
      <div>Snippet text long enough to satisfy the qualifying-content gate, easily forty characters.</div></div></div>`;
    document.body.innerHTML = `<div id="search"><div id="rso">${resultBlock('a.example', 0)}${gotoBlock}${resultBlock('b.example', 2)}</div></div>`;
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    Array.from(document.querySelectorAll('.sbw-serp-tools button')).find((b) => b.textContent === 'Analyze top 10').click();
    expect(checkMessages().at(-1).items.map((i) => i.url)).toEqual(['https://a.example/page-0', 'https://b.example/page-2']);
    expect(document.querySelector('[data-role="analyze-line"]').textContent).toMatch(/Checking 2 pages, three at a time/);
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
  // A result heading the parser can't read: a /goto link with neither a URL
  // line nor a site name (1.10.2 keeps a result with either as an unknown
  // site). The toolbar still renders (there is an organic h3).
  function unreadableDom() {
    document.body.innerHTML = `<div id="search"><div id="rso"><div class="g"><div>
      <a href="/goto?url=CAESopaque"><h3>Unplaceable result</h3></a>
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

  // 1.10.2: on the page too, not only in the console.
  it('shows a notice on the page when it reads no results from a page that has them', async () => {
    unreadableDom();
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    const notice = document.querySelector('.sbw-serp-tools [data-role="unread-notice"]');
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toMatch(/couldn't read the results on this page/);

    // Google finishes drawing: a rescan reads a result, and the notice goes.
    document.querySelector('#rso').insertAdjacentHTML('beforeend', resultBlock('late.example', 1));
    // Past the 500 ms debounce, twice over: an earlier test's copy of the
    // overlay still watches document.body and its own bar restarts it.
    await vi.advanceTimersByTimeAsync(1500);
    expect(notice.hidden).toBe(true);
  });

  it('keeps the notice hidden on a page it reads', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('[data-role="unread-notice"]').hidden).toBe(true);
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
    // 1.11.0's columns follow these six.
    const end = header.split('\t').indexOf('Result type');
    expect(header.split('\t').slice(end - 6, end)).toEqual(['Absolute position (approx.)', 'Absolute position', 'Collection notes',
      'Position counting everything', 'URL known', 'Place name']);
    // Page 1 wasn't added to Collect: it counts as Google's 10.
    expect([r1.split('\t').at(end - 6), r2.split('\t').at(end - 6)]).toEqual(['11', '12']);
    // Page 2 on its own: the exact overall rank can't be known.
    expect([r1.split('\t').at(end - 5), r2.split('\t').at(end - 5)]).toEqual(['', '']);
  });

  it('1.10.2: counts page 1\'s organic results, once page 1 was added to Collect', async () => {
    sendMessageImpl = (msg, cb) => {
      if (msg.action === 'serpCollect') { setTimeout(() => cb({ rows: [], summary: { pages: [] }, line: '', earlierOrganic: 7 }), 5); return; }
      defaultSendMessageImpl(msg, cb);
    };
    window.history.pushState({}, '', '/search?q=x&start=10');
    freshDom(['first.example', 'second.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    button('Copy results').click();
    const [header, r1, r2] = copied.split('\n');
    const at = header.split('\t').indexOf('Absolute position (approx.)');
    expect([r1.split('\t').at(at), r2.split('\t').at(at)]).toEqual(['8', '9']);
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
    expect(reply).toMatchObject({ rows: 1, headings: 1, questions: 1 });
    // 1.11.0: and what the popup's results panel shows.
    expect(reply.features.map((f) => f.key)).toContain('people_also_ask');
    expect(reply.figures).toMatchObject({ loaded: 0 });
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
    // 1.10.2: Google's Web filter is udm=14 (until then only udm=web was
    // looked for, and the button found nothing).
    const more = document.createElement('a'); more.href = '/search?q=crm&udm=14'; more.textContent = 'Web';
    document.body.append(more);
    const assign = vi.fn();
    const orig = window.location;
    delete window.location; window.location = Object.assign(new URL(orig.href), { assign, search: orig.search });
    try {
      button('Web results only').click();
      expect(assign).toHaveBeenCalledWith(expect.stringContaining('udm=14'));
    } finally { window.location = orig; }
  });

  it.each(['14', 'web'])('shows no Web results only button on a Web-only page (udm=%s)', async (udm) => {
    await workerStub();
    window.history.pushState({}, '', '/search?q=crm&udm=' + udm);
    freshDom(['a.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(button('Web results only')).toBeUndefined();
  });

  // 1.10.2: signed out, Google links most results through /goto and only the
  // site's home address is known, so two results from one site share a URL.
  it('keeps two results from one site that only Google\'s link tells apart', async () => {
    await workerStub();
    window.history.pushState({}, '', '/search?q=crm');
    const gotoBlock = (token, n) => `<div class="g"><div><a href="/goto?url=CAES${token}"><h3>Result ${n}</h3></a>
      <cite>https://same-site.example › page-${n}</cite>
      <div>Snippet text long enough to satisfy the qualifying-content gate, easily forty characters.</div></div></div>`;
    document.body.innerHTML = `<div id="search"><div id="rso">${gotoBlock('one', 1)}${gotoBlock('two', 2)}${resultBlock('other.example', 3)}</div></div>`;
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    button('Add page 1').click();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('[data-role="collect-count"]').textContent).toBe('3');
    const added = sentMessages.find((m) => m.action === 'serpCollect' && m.op === 'add');
    expect(added.page.rows.map((r) => r.link)).toEqual([
      expect.stringMatching(/\/goto\?url=CAESone$/), expect.stringMatching(/\/goto\?url=CAEStwo$/), 'https://other.example/page-3']);
    button('Copy collected').click();
    const [header, ...lines] = copied.split('\n');
    const at = (l, name) => l.split('\t')[header.split('\t').indexOf(name)];
    expect(lines.map((l) => [at(l, 'URL'), at(l, 'URL known')])).toEqual([
      ['https://same-site.example/', 'site only'], ['https://same-site.example/', 'site only'], ['https://other.example/page-3', 'yes']]);
  });
});

/* ---------- 1.11.0: figures under each result, the panel, the look ---------- */

describe('1.11.0: figures under each result', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const answer = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/serp-metrics', name + '.json'), 'utf8'));
  const F = globalThis.SBWSerpFigures;
  const figuresText = (domain) => barFor(domain).querySelector('[data-role="figures"]').textContent;
  const panelButton = (label) => Array.from(document.querySelectorAll('.sbw-serp-tools button')).find((b) => b.textContent.startsWith(label));

  // The worker's answer to 'serpFigures', as the service gives it for the
  // saved route answer `name`, or a state of its own.
  function figuresReply(reply) {
    sendMessageImpl = (msg, cb) => {
      if (msg.action === 'serpFigures') {
        const r = typeof reply === 'function' ? reply(msg) : reply;
        setTimeout(() => cb(r), 5);
        return;
      }
      defaultSendMessageImpl(msg, cb);
    };
  }

  function okReply(name, msg) {
    const data = answer(name);
    const results = {};
    msg.items.forEach((item, i) => { results[item.key] = F.resultFigures(data.results[i]); });
    const s = F.standing(data);
    return Object.assign({ state: 'ok', results }, s, { notice: F.lookupNotice(s) });
  }

  function storageLocal(settings) {
    window.chrome.storage.local = { get: vi.fn(async () => ({ serpSettings: settings })), set: vi.fn(async () => {}) };
  }

  it('shows the page\'s and the site\'s figures, labeled DataForSEO\'s, with domain age and your checklist', async () => {
    figuresReply((msg) => okReply('done', msg));
    freshDom(['alpha.example', 'beta.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    const text = figuresText('alpha.example');
    expect(text).toContain('Page412 ref. domains9.1K backlinksrank 382.3K visits/mo');
    expect(text).toContain('Siterank 6115.2K ref. domains');
    const source = barFor('alpha.example').querySelector('.sbw-fig-source');
    expect(source.hidden).toBe(false);
    expect(source.textContent).toBe('DataForSEO');
    expect(text).toContain('age 28y 1m');
    expect(text).toContain('your checklist 92/100');
    const age = barFor('alpha.example').querySelector('[data-figure="domainAge"]');
    expect(age.title).toMatch(/Registered 1998-09-15, registrar Example Registrar, Inc\., expires 2028-09-14/);
    expect(source.title).toMatch(/0 to 100/);
    expect(document.querySelector('[data-role="figures-line"]').textContent).toMatch(/Free plan: 17 of 20 searches with new figures left today/);
  });

  it('signed out of Google, a row known only by its site: the site\'s figures and "sign in to Google to see page figures"', async () => {
    figuresReply((msg) => okReply('done', msg));
    window.history.pushState({}, '', '/search?q=x');
    const gotoBlock = `<div class="g"><div><a href="/goto?url=CAEShidden"><h3>Hidden</h3></a><cite>https://beta.example › page</cite>
      <div>Snippet text long enough to satisfy the qualifying-content gate, easily forty characters.</div></div></div>`;
    document.body.innerHTML = `<div id="search"><div id="rso">${resultBlock('alpha.example', 0)}${gotoBlock}</div></div>`;
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    const sent = sentMessages.find((m) => m.action === 'serpFigures');
    expect(sent.items[1]).toMatchObject({ url: null, domain: 'beta.example' });
    expect(figuresText('beta.example')).toContain('Siterank 44830 ref. domains');
    expect(figuresText('beta.example')).toContain('sign in to Google to see page figures');
    expect(figuresText('beta.example')).not.toMatch(/Page/);
  });

  it('signed out of SEO Bandwagon: position and Analyze, and "Connect free to see figures"', async () => {
    figuresReply({ state: 'no_key' });
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    const bar = barFor('alpha.example');
    expect(bar.querySelector('.sbw-serp-pos').textContent).toBe('#1');
    expect(bar.querySelector('.sbw-serp-analyze')).not.toBeNull();
    const connect = bar.querySelector('[data-role="figures"] button');
    expect(connect.textContent).toBe('Connect free to see figures');
    connect.click();
    expect(sentMessages.at(-1)).toEqual({ action: 'serpOpen', page: 'connect' });
  });

  it('figures not accepted yet: "Turn on figures", which opens Settings', async () => {
    figuresReply({ state: 'needs_consent', reason: 'not_accepted' });
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    const btn = barFor('alpha.example').querySelector('[data-role="figures"] button');
    expect(btn.textContent).toBe('Turn on figures');
    expect(btn.title).toMatch(/send each result’s address/);
    btn.click();
    expect(sentMessages.at(-1)).toEqual({ action: 'serpOpen', page: 'settings' });
  });

  it('a 403 (a key without the serp scope) says Reconnect', async () => {
    figuresReply({ state: 'error', code: 'forbidden', results: {} });
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(figuresText('alpha.example')).toMatch(/^Reconnect to see figures/);
    expect(document.querySelector('[data-role="figures-actions"]').textContent).toBe('Reconnect');
  });

  it('offline: says so on the bar; position, Analyze and the exports still work', async () => {
    figuresReply({ state: 'error', code: 'network', results: {} });
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(figuresText('alpha.example')).toMatch(/^Offline/);
    expect(figuresText('alpha.example')).not.toMatch(/Could not reach/i);
    expect(panelButton('Copy results').textContent).toBe('Copy results (1)');
  });

  it('the allowance reached: the bar and the panel say so and link to upgrading; cached figures stay', async () => {
    figuresReply((msg) => okReply('limit-reached', msg));
    freshDom(['alpha.example']);
    window.history.pushState({}, '', '/search?q=x');
    const gotoBlock = `<div class="g"><div><a href="/goto?url=CAEShidden"><h3>Hidden</h3></a><cite>https://beta.example › page</cite>
      <div>Snippet text long enough to satisfy the qualifying-content gate, easily forty characters.</div></div></div>`;
    document.querySelector('#search').insertAdjacentHTML('beforeend', gotoBlock);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(figuresText('alpha.example')).toBe('No figures: today’s limit is reachedUpgrade');
    expect(figuresText('beta.example')).toContain('rank 44'); // from the site's cache
    expect(document.querySelector('[data-role="figures-line"]').textContent).toMatch(/searches with new figures are used/);
    panelButton('Upgrade for more figures').click();
    expect(sentMessages.at(-1)).toEqual({ action: 'serpOpen', page: 'upgrade' });
  });

  it('paused at the monthly ceiling: says so, with no upgrade', async () => {
    figuresReply((msg) => okReply('paused', msg));
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(figuresText('alpha.example')).toBe('New figures paused until next month');
    expect(document.querySelector('[data-role="figures-line"]').textContent).toMatch(/paused for everyone until next month/);
    expect(panelButton('Upgrade')).toBeUndefined();
  });

  it('figures on a click: nothing asked until "Show figures" or "Load figures"', async () => {
    storageLocal({ load: 'click' });
    figuresReply((msg) => okReply('done', msg));
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(sentMessages.some((m) => m.action === 'serpFigures')).toBe(false);
    barFor('alpha.example').querySelector('[data-role="figures"] button').click();
    await vi.advanceTimersByTimeAsync(20);
    expect(sentMessages.filter((m) => m.action === 'serpFigures')).toHaveLength(1);
    expect(figuresText('alpha.example')).toContain('412 ref. domains');
  });

  it('asks once per result: a page that keeps changing does not ask again after an error', async () => {
    figuresReply({ state: 'error', code: 'error', results: {} });
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    const asked = () => sentMessages.filter((m) => m.action === 'serpFigures').length;
    // Google redraws something beside the results, again and again. (An
    // earlier test's copy of the overlay still watches document.body and
    // asks once for itself, so the count is read after the first redraw.)
    document.querySelector('#search').insertAdjacentHTML('beforeend', '<div class="google-redraw"></div>');
    await vi.advanceTimersByTimeAsync(1500);
    const once = asked();
    expect(once).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 4; i++) {
      document.querySelector('#search').insertAdjacentHTML('beforeend', '<div class="google-redraw"></div>');
      await vi.advanceTimersByTimeAsync(700);
    }
    expect(asked()).toBe(once);
  });

  it('our own redraws never cause a rescan', async () => {
    figuresReply((msg) => okReply('done', msg));
    freshDom(['alpha.example']);
    await loadOverlay();
    // Let every rescan the page's own setup scheduled run first.
    await vi.advanceTimersByTimeAsync(1500);
    const parse = vi.spyOn(globalThis.SBWSerp, 'parseResults');
    panelButton('Copy results').click(); // flashes its label: a change inside the panel
    await vi.advanceTimersByTimeAsync(2000);
    // The click itself parses once; no rescan follows it.
    expect(parse.mock.calls.length).toBeLessThanOrEqual(1);
    parse.mockRestore();
  });

  it('figures turned off in settings: no figures asked, no figures shown', async () => {
    storageLocal({ figuresOn: false });
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(sentMessages.some((m) => m.action === 'serpFigures')).toBe(false);
    expect(figuresText('alpha.example')).toBe('');
  });

  it('the overlay turned off: no bars, no panel, nothing asked', async () => {
    storageLocal({ overlay: false });
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('.sbw-serp-bar')).toBeNull();
    expect(document.querySelector('.sbw-serp-tools')).toBeNull();
    expect(sentMessages).toEqual([]);
  });

  it('exports carry each result\'s figures, its type and the search\'s features', async () => {
    figuresReply((msg) => okReply('done', msg));
    let copied = null;
    document.execCommand = vi.fn(() => { copied = document.querySelector('textarea[aria-hidden="true"]').value; return true; });
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    panelButton('Copy results').click();
    const [header, line] = copied.split('\n');
    const cell = (name) => line.split('\t')[header.split('\t').indexOf(name)];
    expect(cell('Result type')).toBe('web');
    expect(cell('Page referring domains (DataForSEO)')).toBe('412');
    expect(cell('Site rank 0-100 (DataForSEO)')).toBe('61');
    expect(cell('Domain age (RDAP)')).toBe('28y 1m');
    expect(cell('Registrar (RDAP)')).toBe('Example Registrar, Inc.');
    expect(cell('Your on-page checklist')).toBe('92');
    delete document.execCommand;
  });
});

describe('1.11.0: the panel and the look', () => {
  function storageLocal(settings) {
    window.chrome.storage.local = { get: vi.fn(async () => ({ serpSettings: settings })), set: vi.fn(async () => {}) };
  }
  const groups = () => Array.from(document.querySelectorAll('.sbw-serp-tools .sbw-group')).map((g) => g.getAttribute('data-group'));

  it('is one panel with groups: Figures, Analyze, Table, AI Overview sources, Export, People also ask, Collect pages, Location', async () => {
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(groups()).toEqual(['figures', 'analyze', 'table', 'sources', 'export', 'paa', 'collect', 'location']);
    expect(document.querySelector('.sbw-serp-tools').getAttribute('aria-label')).toBe('SEO Bandwagon');
    // No <h3> of ours: the parser reads h3s as result headings.
    expect(document.querySelectorAll('.sbw-serp-tools h3')).toHaveLength(0);
  });

  it('sits below the results by default, and above them by setting, in the page\'s flow', async () => {
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('#search').nextElementSibling.classList.contains('sbw-serp-tools')).toBe(true);
    document.body.innerHTML = '';

    storageLocal({ placement: 'top' });
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    const panel = document.querySelector('#search').previousElementSibling;
    expect(panel.classList.contains('sbw-serp-tools')).toBe(true);
    expect(panel.getAttribute('data-placement')).toBe('top');
  });

  it('folds to its header line, and remembers it', async () => {
    const set = vi.fn(async () => {});
    window.chrome.storage.local = { get: vi.fn(async () => ({})), set };
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    const toggle = document.querySelector('.sbw-panel-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    await vi.advanceTimersByTimeAsync(10);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.sbw-panel-body').hidden).toBe(true);
    expect(set).toHaveBeenCalledWith({ serpSettings: expect.objectContaining({ collapsed: true }) });
  });

  it('Match Google follows Google\'s own light or dark page; Night and Day are fixed', async () => {
    freshDom(['alpha.example']);
    document.body.style.backgroundColor = 'rgb(31, 31, 31)';
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('.sbw-serp-bar').getAttribute('data-sbw-look')).toBe('google-dark');
    expect(document.querySelector('.sbw-serp-tools').getAttribute('data-sbw-look')).toBe('google-dark');
    document.body.innerHTML = '';

    document.body.style.backgroundColor = 'rgb(255, 255, 255)';
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('.sbw-serp-bar').getAttribute('data-sbw-look')).toBe('google-light');
    document.body.innerHTML = '';

    storageLocal({ look: 'dark' });
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('.sbw-serp-bar').getAttribute('data-sbw-look')).toBe('dark');
    document.body.style.backgroundColor = '';
  });

  it('marks your own sites on their bars, from the list in Options', async () => {
    storageLocal({ ownSites: ['beta.example'] });
    freshDom(['alpha.example', 'beta.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(barFor('beta.example').getAttribute('data-own')).toBe('true');
    expect(barFor('beta.example').querySelector('.sbw-serp-own').textContent).toBe('Your site');
    expect(barFor('alpha.example').hasAttribute('data-own')).toBe(false);
  });

  it('answers the popup\'s exports', async () => {
    let handler = null;
    window.chrome.runtime.onMessage = { addListener: (fn) => { handler = fn; } };
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    let csv = null;
    handler({ action: 'serpExport', kind: 'csv' }, {}, (r) => { csv = r; });
    expect(csv.filename).toMatch(/^serp-plumbers-near-austin-p1-/);
    expect(csv.text).toContain('Result type');
    let ai = 'unset';
    handler({ action: 'serpExport', kind: 'ai' }, {}, (r) => { ai = r; });
    expect(ai).toEqual({ text: null });
  });
});

describe('1.11.0: the open page follows Options', () => {
  it('asks again as soon as the figures are accepted, without a reload', async () => {
    let changed = null;
    window.chrome.storage.local = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) };
    window.chrome.storage.onChanged = { addListener: (fn) => { changed = fn; } };
    let accepted = false;
    sendMessageImpl = (msg, cb) => {
      if (msg.action === 'serpFigures') { setTimeout(() => cb(accepted ? { state: 'ok', results: {}, plan: 'free', allowance: null, lookups: 'done', notice: null } : { state: 'needs_consent' }), 5); return; }
      defaultSendMessageImpl(msg, cb);
    };
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(barFor('alpha.example').querySelector('[data-role="figures"]').textContent).toBe('Turn on figures');
    accepted = true;
    changed({ sbwConsent: { newValue: { serpFigures: { acceptedAt: 'x', version: 1 } } } }, 'local');
    await vi.advanceTimersByTimeAsync(50);
    expect(sentMessages.filter((m) => m.action === 'serpFigures')).toHaveLength(2);
    expect(barFor('alpha.example').querySelector('[data-role="figures"]').textContent).toBe('No figures for this result yet');
    delete window.chrome.storage.onChanged;
  });
});

describe('1.11.0 review: retries, cosmetic settings, a new account', () => {
  it('asks again after a 429, after Retry-After, and says "Try again" meanwhile', async () => {
    // Rate limited for the first 3 s; earlier tests' copies of the overlay
    // may ask too, so the answer goes by the clock, not by a count.
    const limitedUntil = Date.now() + 3000;
    let calls = 0;
    sendMessageImpl = (msg, cb) => {
      if (msg.action === 'serpFigures') {
        calls += 1;
        setTimeout(() => cb(Date.now() < limitedUntil ? { state: 'error', code: 'rate_limited', retryAfter: 5, results: {} }
          : { state: 'ok', results: Object.fromEntries(msg.items.map((i) => [i.key, { page: { rank: 40 }, domain: null, whois: null, checklist: null }])), plan: 'free', allowance: null, lookups: 'done', notice: null }), 5);
        return;
      }
      defaultSendMessageImpl(msg, cb);
    };
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    const box = () => barFor('alpha.example').querySelector('[data-role="figures"]');
    expect(box().textContent).toBe('Too many figure requests in a minute. They load again shortlyTry again');
    const before = calls;
    await vi.advanceTimersByTimeAsync(5100);
    expect(calls).toBeGreaterThan(before);
    // An earlier test's copy of the overlay may draw a bar of its own for
    // the same result; this copy's bar is the one that now has figures.
    const all = Array.from(document.querySelectorAll('.sbw-serp-bar')).filter((b) => b.querySelector('.sbw-serp-domain').textContent === 'alpha.example');
    expect(all.some((b) => b.querySelector('[data-role="figures"]').textContent.includes('rank 40'))).toBe(true);
  });

  it('folding the panel never sends the figures again', async () => {
    let changed = null;
    window.chrome.storage.local = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) };
    window.chrome.storage.onChanged = { addListener: (fn) => { changed = fn; } };
    sendMessageImpl = (msg, cb) => {
      if (msg.action === 'serpFigures') { setTimeout(() => cb({ state: 'error', code: 'forbidden', results: {} }), 5); return; }
      defaultSendMessageImpl(msg, cb);
    };
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    const before = sentMessages.filter((m) => m.action === 'serpFigures').length;
    changed({ serpSettings: { newValue: { collapsed: true } } }, 'local');
    changed({ serpSettings: { newValue: { collapsed: false, placement: 'top' } } }, 'local');
    await vi.advanceTimersByTimeAsync(50);
    expect(sentMessages.filter((m) => m.action === 'serpFigures').length).toBe(before);
    delete window.chrome.storage.onChanged;
  });

  it('a new account drops the old one\'s figures from the open page', async () => {
    let changed = null;
    window.chrome.storage.local = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) };
    window.chrome.storage.onChanged = { addListener: (fn) => { changed = fn; } };
    let account = 'old';
    sendMessageImpl = (msg, cb) => {
      if (msg.action === 'serpFigures') {
        const checklist = account === 'old' ? { score: 92, capturedAt: '2026-10-28' } : null;
        setTimeout(() => cb({ state: 'ok', results: Object.fromEntries(msg.items.map((i) => [i.key, { page: null, domain: null, whois: null, checklist }])), plan: 'free', allowance: null, lookups: 'done', notice: null }), 5);
        return;
      }
      defaultSendMessageImpl(msg, cb);
    };
    freshDom(['alpha.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    expect(barFor('alpha.example').textContent).toContain('your checklist 92/100');
    account = 'new';
    changed({ apiKey: { newValue: 'sbw_new' } }, 'sync');
    await vi.advanceTimersByTimeAsync(50);
    expect(barFor('alpha.example').textContent).not.toContain('your checklist');
    delete window.chrome.storage.onChanged;
  });
});

describe('1.12.0: the results table, a pinned page and the AI Overview\'s sources', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const table = () => document.querySelector('[data-role="table"] table');
  const headers = () => Array.from(table().querySelectorAll('thead th')).map((th) => th.textContent);
  const cellsOf = (label) => {
    const i = headers().indexOf(label);
    return Array.from(table().querySelectorAll('tbody tr')).map((tr) => tr.children[i]);
  };
  function withFigures(byDomain) {
    sendMessageImpl = (msg, cb) => {
      if (msg.action === 'serpFigures') {
        const results = {};
        msg.items.forEach((i) => { results[i.key] = byDomain[i.domain] || { page: null, domain: null, whois: null, checklist: null }; });
        setTimeout(() => cb({ state: 'ok', results, plan: 'free', allowance: { limit: 20, used: 1, remaining: 19 }, lookups: 'done', notice: null }), 5);
        return;
      }
      defaultSendMessageImpl(msg, cb);
    };
  }
  const f = (rd, rank) => ({ page: { referringDomains: rd, backlinks: null, rank, etv: null, keywords: null }, domain: null, whois: { age: '10y' }, checklist: null });

  it('one row per result with its figures, each cell marked against the median', async () => {
    withFigures({ 'a.example': f(400, 40), 'b.example': f(100, 20), 'c.example': f(50, 10) });
    freshDom(['a.example', 'b.example', 'c.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(200);
    expect(headers().slice(0, 4)).toEqual(['#', 'On page', 'Result', 'Type']);
    const rd = cellsOf('Page ref. domains');
    expect(rd.map((td) => td.textContent)).toEqual(['400 ▲', '100', '50 ▼']);
    expect(rd[0].getAttribute('data-mark')).toBe('above');
    expect(rd[0].title).toMatch(/above the median of these results \(100\)/);
    expect(document.querySelector('.sbw-table-note').textContent).toMatch(/DataForSEO’s \(rank 0 to 100\)/);
  });

  it('sorts by a column when its header is clicked', async () => {
    withFigures({ 'a.example': f(50, 40), 'b.example': f(400, 20), 'c.example': f(100, 10) });
    freshDom(['a.example', 'b.example', 'c.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(200);
    const sortBy = (label) => Array.from(table().querySelectorAll('thead button')).find((b) => b.textContent === label).click();
    sortBy('Page ref. domains');
    await vi.advanceTimersByTimeAsync(100);
    expect(cellsOf('Page ref. domains').map((td) => parseInt(td.textContent, 10))).toEqual([50, 100, 400]);
    sortBy('Page ref. domains');
    await vi.advanceTimersByTimeAsync(100);
    expect(cellsOf('Page ref. domains').map((td) => parseInt(td.textContent, 10))).toEqual([400, 100, 50]);
    expect(table().querySelector('th[aria-sort]').getAttribute('aria-sort')).toBe('descending');
  });

  it('shows only the columns chosen in settings', async () => {
    window.chrome.storage.local = { get: vi.fn(async () => ({ serpSettings: { tableColumns: { overall: false, type: false, inUrl: false } } })), set: vi.fn(async () => {}) };
    freshDom(['a.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(200);
    expect(headers()).not.toContain('On page');
    expect(headers()).not.toContain('In URL');
    expect(headers()).toContain('In title');
  });

  it('pins your page as the first row: its checks from its HTML, and its figures', async () => {
    withFigures({ 'mine.example': f(300, 30), 'a.example': f(400, 40), 'b.example': f(100, 20) });
    freshDom(['a.example', 'b.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(200);
    const input = document.querySelector('.sbw-pin-input');
    input.value = 'https://mine.example/plumbing#top';
    Array.from(document.querySelectorAll('.sbw-serp-tools button')).find((b) => b.textContent === 'Pin').click();
    await vi.advanceTimersByTimeAsync(200);
    expect(sentMessages.find((m) => m.action === 'serpPageCheck').items).toEqual([{ key: 'pin:https://mine.example/plumbing', url: 'https://mine.example/plumbing' }]);
    expect(sentMessages.filter((m) => m.action === 'serpFigures').at(-1).items).toEqual([{ key: 'pin:https://mine.example/plumbing', url: 'https://mine.example/plumbing', domain: 'mine.example' }]);
    const first = table().querySelector('tbody tr');
    expect(first.getAttribute('data-pinned')).toBe('true');
    expect(first.textContent).toMatch(/^Your page:/);
  });

  it('exports the table with the same columns', async () => {
    withFigures({ 'a.example': f(400, 40) });
    freshDom(['a.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(200);
    let blob = null;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = (b) => { blob = b; return 'blob:x'; };
    URL.revokeObjectURL = () => {};
    Array.from(document.querySelectorAll('.sbw-serp-tools button')).find((b) => b.textContent === 'Export table CSV').click();
    URL.createObjectURL = origCreate;
    const text = await blob.text();
    expect(text.split('\r\n')[0]).toContain('Page ref. domains (DataForSEO)');
    expect(text).toContain('https://a.example/page-0');
  });

  it('lists the AI Overview\'s sources with the same figures, loaded on a click', async () => {
    withFigures({ 'seobandwagon.com': f(900, 55) });
    window.history.pushState({}, '', '/search?q=seo+bandwagon');
    document.body.innerHTML = fs.readFileSync(path.join(__dirname, '../fixtures/serp-google-social-profiles.html'), 'utf8');
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(200);
    const group = document.querySelector('[data-group="sources"]');
    expect(group.hidden).toBe(false);
    expect(group.querySelectorAll('tbody tr')).toHaveLength(9);
    const before = sentMessages.filter((m) => m.action === 'serpFigures').length;
    Array.from(group.querySelectorAll('button')).find((b) => b.textContent === 'Load figures for sources').click();
    await vi.advanceTimersByTimeAsync(200);
    const sent = sentMessages.filter((m) => m.action === 'serpFigures');
    expect(sent.length).toBe(before + 1);
    expect(sent.at(-1).items[0]).toMatchObject({ key: 'ai:https://seobandwagon.com/pricing', domain: 'seobandwagon.com' });
    expect(group.querySelector('tbody tr').textContent).toContain('900');
  });
});
