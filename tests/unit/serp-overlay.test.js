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

describe('1.10.2: the results page sends nothing to SEO Bandwagon', () => {
  it('asks the worker for nothing on load but what Collect already holds', async () => {
    window.history.pushState({}, '', '/search?q=confidential+search+terms&gl=us&hl=en');
    freshDom(['alpha.example', 'beta.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    // serpCollect 'get' reads session storage in the worker; it sends nothing.
    expect(sentMessages.map((m) => [m.action, m.op])).toEqual([['serpCollect', 'get']]);
    expect(sentMessages.some((m) => m.action === 'serpStats')).toBe(false);
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

describe('1.10.2: Analyze stays on Google', () => {
  const click = (el, init = {}) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
  const analyzeMessages = () => sentMessages.filter((m) => m && m.action === 'serpAnalyze');
  const lineFor = (domain) => {
    const next = barFor(domain).nextElementSibling;
    return next && next.classList.contains('sbw-serp-analysis') ? next : null;
  };

  it('a plain click hands the result to the worker and says it is analyzing in a background tab', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    const link = document.querySelector('.sbw-serp-analyze');
    const notCancelled = click(link);
    expect(notCancelled).toBe(false);
    expect(analyzeMessages()).toEqual([{ action: 'serpAnalyze', url: 'https://first.example/page-0', key: 'https://first.example/page-0' }]);
    expect(lineFor('first.example').textContent).toBe('Analyzing in a background tab…');
  });

  it('puts the on-page checklist under the result when the worker reports, with Open report', async () => {
    freshDom(['first.example', 'second.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    click(barFor('second.example').querySelector('.sbw-serp-analyze'));
    await vi.advanceTimersByTimeAsync(20);
    deliver({ action: 'serpAnalysis', key: 'https://second.example/page-1', state: 'done', tabId: 42, score: 82, grade: 'B', issues: 3 });
    const line = lineFor('second.example');
    expect(line.querySelector('.sbw-serp-analysis-text').textContent).toBe('On-page checklist: 82/100 (B) · 3 issues');
    expect(line.querySelector('.sbw-serp-analysis-text').title).toMatch(/not a ranking factor/);
    expect(lineFor('first.example')).toBeNull();

    line.querySelector('.sbw-serp-open').click();
    expect(sentMessages.at(-1)).toEqual({ action: 'serpAnalysisOpen', tabId: 42, report: true });
  });

  it('gives several quick clicks a line each, and a second click on one result the same line', async () => {
    freshDom(['first.example', 'second.example', 'third.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    ['first.example', 'second.example', 'third.example', 'first.example']
      .forEach((d) => click(barFor(d).querySelector('.sbw-serp-analyze')));
    expect(analyzeMessages().map((m) => m.key)).toEqual([
      'https://first.example/page-0', 'https://second.example/page-1', 'https://third.example/page-2', 'https://first.example/page-0']);
    expect(document.querySelectorAll('.sbw-serp-analysis')).toHaveLength(3);
    deliver({ action: 'serpAnalysis', key: 'https://third.example/page-2', state: 'done', tabId: 7, score: 60, grade: 'D', issues: 1 });
    deliver({ action: 'serpAnalysis', key: 'https://first.example/page-0', state: 'done', tabId: 5, score: 91, grade: 'A', issues: 0 });
    expect(lineFor('first.example').textContent).toMatch(/91\/100 \(A\) · 0 issues/);
    expect(lineFor('second.example').textContent).toBe('Analyzing in a background tab…');
    expect(lineFor('third.example').textContent).toMatch(/60\/100 \(D\) · 1 issue/);
  });

  it('asks for site access in the extension\'s own window when there is none, and says so', async () => {
    sendMessageImpl = (msg, cb) => {
      if (msg.action === 'serpAnalyze') { setTimeout(() => cb({ ok: true, state: 'needs_access' }), 10); return; }
      defaultSendMessageImpl(msg, cb);
    };
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    click(document.querySelector('.sbw-serp-analyze'));
    await vi.advanceTimersByTimeAsync(20);
    expect(lineFor('first.example').textContent).toMatch(/^Allow access in the SEO Bandwagon window that opened/);
    deliver({ action: 'serpAnalysis', key: 'https://first.example/page-0', state: 'declined' });
    expect(lineFor('first.example').textContent).toMatch(/needs access to other sites/);
    deliver({ action: 'serpAnalysis', key: 'https://first.example/page-0', state: 'working' });
    expect(lineFor('first.example').textContent).toBe('Analyzing in a background tab…');
  });

  it('says what went wrong, and offers the tab when there is one', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    click(document.querySelector('.sbw-serp-analyze'));
    deliver({ action: 'serpAnalysis', key: 'https://first.example/page-0', state: 'error', code: 'unreadable', title: 'PDF FILE', tabId: 9 });
    expect(lineFor('first.example').querySelector('.sbw-serp-analysis-text').textContent).toBe("Couldn't analyze this page. PDF FILE.");
    lineFor('first.example').querySelector('.sbw-serp-open').click();
    expect(sentMessages.at(-1)).toEqual({ action: 'serpAnalysisOpen', tabId: 9, report: false });
    deliver({ action: 'serpAnalysis', key: 'https://first.example/page-0', state: 'error', code: 'closed' });
    expect(lineFor('first.example').textContent).toBe('The tab was closed before the page was analyzed.');
    expect(lineFor('first.example').querySelector('.sbw-serp-open')).toBeNull();
  });

  it('never words the checklist as a ranking factor or a score of the site', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    click(document.querySelector('.sbw-serp-analyze'));
    deliver({ action: 'serpAnalysis', key: 'https://first.example/page-0', state: 'done', tabId: 1, score: 70, grade: 'C', issues: 2 });
    const text = lineFor('first.example').textContent;
    expect(text).not.toMatch(/rank|score/i);
  });

  it('sends the link as Google rendered it, so a /goto result opens through Google', async () => {
    document.body.innerHTML = `<div id="search"><div id="rso"><div class="g"><div>
      <a href="/goto?url=CAESopaque"><h3>Goto result</h3></a>
      <cite>https://goto-site.example › docs</cite>
      <div>Snippet text long enough to satisfy the qualifying-content gate, easily forty characters.</div>
    </div></div></div></div>`;
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    click(barFor('goto-site.example').querySelector('.sbw-serp-analyze'));
    expect(analyzeMessages()).toHaveLength(1);
    expect(analyzeMessages()[0].url).toMatch(/\/goto\?url=CAESopaque$/);
    expect(analyzeMessages()[0].key).toBe('/goto?url=CAESopaque');
  });

  it('leaves Ctrl, Cmd, Shift, Alt and middle clicks to the browser', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    const link = document.querySelector('.sbw-serp-analyze');
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      expect(click(link, init)).toBe(true);
    }
    expect(analyzeMessages()).toEqual([]);
  });

  it('falls back to opening the link when the extension was reloaded under the page', async () => {
    freshDom(['first.example']);
    await loadOverlay();
    await vi.advanceTimersByTimeAsync(50);
    window.chrome.runtime.sendMessage = () => { throw new Error('Extension context invalidated.'); };
    expect(click(document.querySelector('.sbw-serp-analyze'))).toBe(true);
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
    expect(header.split('\t').slice(-6)).toEqual(['Absolute position (approx.)', 'Absolute position', 'Collection notes',
      'Position counting everything', 'URL known', 'Place name']);
    // Page 1 wasn't added to Collect: it counts as Google's 10.
    expect([r1.split('\t').at(-6), r2.split('\t').at(-6)]).toEqual(['11', '12']);
    // Page 2 on its own: the exact overall rank can't be known.
    expect([r1.split('\t').at(-5), r2.split('\t').at(-5)]).toEqual(['', '']);
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
    const [, r1, r2] = copied.split('\n');
    expect([r1.split('\t').at(-6), r2.split('\t').at(-6)]).toEqual(['8', '9']);
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
