// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://seobandwagon.com/dashboard/api-keys/"}
// The Connect bridge's content script (src/content/site-bridge.js, 1.13.6):
// what it takes from the page, what it sends the worker, what it answers.
// The worker's half and the whole round trip run in a real browser in
// tests/e2e/edge-bridge.spec.mjs.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const sent = [];
let answer = (msg, cb) => cb({ ok: true, version: '1.13.6' });

beforeAll(async () => {
  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: vi.fn((msg, cb) => { sent.push(msg); answer(msg, cb); })
    }
  };
  await import('../../extension/src/content/site-bridge.js');
});
beforeEach(() => {
  sent.length = 0;
  chrome.runtime.lastError = undefined;
  answer = (msg, cb) => cb({ ok: true, version: '1.13.6' });
});

function port() {
  return { postMessage: vi.fn(), close: vi.fn() };
}

// A window message as the page would post it; any field can be overridden.
function post({ data = { sbwBridge: 1, message: { type: 'ping' } }, origin = 'https://seobandwagon.com', source = window, ports } = {}) {
  const ev = new MessageEvent('message', { data, origin, source });
  Object.defineProperty(ev, 'ports', { value: ports === undefined ? [port()] : ports });
  window.dispatchEvent(ev);
  return ev.ports;
}

describe('the marker', () => {
  it('sets data-sbw-bridge="1" on the root element', () => {
    expect(document.documentElement.getAttribute('data-sbw-bridge')).toBe('1');
  });
});

describe('a message the bridge takes', () => {
  it('goes to the worker as siteBridge with the page\'s message, and the answer comes back on the port', () => {
    const [p] = post({ data: { sbwBridge: 1, message: { type: 'ping' } } });
    expect(sent).toEqual([{ action: 'siteBridge', message: { type: 'ping' } }]);
    expect(p.postMessage).toHaveBeenCalledWith({ response: { ok: true, version: '1.13.6' } });
    expect(p.close).toHaveBeenCalled();
  });

  it('passes connect and status through unchanged', () => {
    const key = 'sbw_' + '0'.repeat(48);
    post({ data: { sbwBridge: 1, message: { type: 'connect', apiKey: key } } });
    post({ data: { sbwBridge: 1, message: { type: 'status' } } });
    expect(sent).toEqual([
      { action: 'siteBridge', message: { type: 'connect', apiKey: key } },
      { action: 'siteBridge', message: { type: 'status' } }
    ]);
  });

  it('answers { error } when the worker can\'t be reached', () => {
    answer = (msg, cb) => { chrome.runtime.lastError = { message: 'Could not establish connection.' }; cb(undefined); };
    const [p] = post();
    expect(p.postMessage).toHaveBeenCalledWith({ error: 'Could not establish connection.' });
  });

  it('answers { error } when the extension was reloaded under the page', () => {
    answer = () => { throw new Error('Extension context invalidated.'); };
    const [p] = post();
    expect(p.postMessage).toHaveBeenCalledWith({ error: 'Extension context invalidated.' });
  });
});

describe('a message the bridge ignores, unanswered', () => {
  it.each([
    ['no source window', { source: null }],
    ['another origin', { origin: 'https://evil.example' }],
    ['the www host', { origin: 'https://www.seobandwagon.com' }],
    ['plain http', { origin: 'http://seobandwagon.com' }],
    ['no sbwBridge', { data: { message: { type: 'ping' } } }],
    ['sbwBridge "1"', { data: { sbwBridge: '1', message: { type: 'ping' } } }],
    ['sbwBridge true', { data: { sbwBridge: true, message: { type: 'ping' } } }],
    ['a string', { data: 'ping' }],
    ['null', { data: null }],
    ['no port', { ports: [] }],
    ['two ports', { ports: [port(), port()] }]
  ])('%s', (_, init) => {
    const ports = post(init);
    expect(sent).toEqual([]);
    for (const p of ports) expect(p.postMessage).not.toHaveBeenCalled();
  });
});
