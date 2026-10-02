// Unit tests for the page helper injected for full-page proof
// (src/content/page-scroller.js): measuring, scrolling, hiding fixed and
// sticky elements, restoring every inline style exactly, and the watchdog
// that puts the page back if the popup closes mid-capture.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let listener;
let scrollY;

async function load() {
  vi.resetModules();
  await import('../../extension/src/content/page-scroller.js');
}

function call(action, extra = {}) {
  return new Promise(resolve => { listener({ action, ...extra }, {}, resolve); });
}

// Fake timers for every test: each fpPrepare arms a 5 s watchdog, and with
// real timers a leftover one could fire during a later test. Switching back
// to real timers in afterEach drops them.
beforeEach(async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
  document.body.removeAttribute('style');
  delete window.__sbwPageScrollerLoaded;
  listener = null;
  scrollY = 0;
  globalThis.chrome = { runtime: { onMessage: { addListener: fn => { listener = fn; } } } };
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
  Object.defineProperty(window, 'scrollX', { configurable: true, get: () => 0 });
  window.scrollTo = vi.fn((_x, y) => { scrollY = y; });
  await load();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('page-scroller', () => {
  it('registers one message listener and is harmless when injected twice', async () => {
    expect(typeof listener).toBe('function');
    listener = null;
    await load(); // guard flag still set
    expect(listener).toBe(null);
  });

  it('ignores messages meant for other scripts', () => {
    expect(listener({ action: 'extractNap' }, {}, () => {})).toBe(undefined);
  });

  it('measures the page and forces instant scrolling', async () => {
    document.documentElement.style.setProperty('scroll-behavior', 'smooth');
    const m = await call('fpPrepare');
    expect(m).toMatchObject({ viewportHeight: window.innerHeight, dpr: window.devicePixelRatio || 1, innerScroll: false });
    expect(typeof m.scrollHeight).toBe('number');
    expect(typeof m.viewportWidth).toBe('number');
    expect(document.documentElement.style.getPropertyValue('scroll-behavior')).toBe('auto');
  });

  it('reports an inner scroll panel', async () => {
    const panel = document.createElement('div');
    panel.style.overflowY = 'auto';
    Object.defineProperty(panel, 'clientHeight', { value: window.innerHeight });
    Object.defineProperty(panel, 'scrollHeight', { value: window.innerHeight * 3 });
    document.body.appendChild(panel);
    expect((await call('fpPrepare')).innerScroll).toBe(true);
  });

  it('reports innerScroll when the body itself is the scroller', async () => {
    document.body.style.overflowY = 'auto';
    Object.defineProperty(document.body, 'clientHeight', { configurable: true, value: window.innerHeight });
    Object.defineProperty(document.body, 'scrollHeight', { configurable: true, value: window.innerHeight * 3 });
    expect((await call('fpPrepare')).innerScroll).toBe(true);
    delete document.body.clientHeight;
    delete document.body.scrollHeight;
  });

  it('scrolls, waits for the page to settle, and reports where it landed', async () => {
    await call('fpPrepare');
    const reply = call('fpScrollTo', { y: 720 });
    await vi.advanceTimersByTimeAsync(149);
    let settled = false;
    reply.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await reply).toEqual({ scrollY: 720 });
    expect(window.scrollTo).toHaveBeenCalledWith(0, 720);
  });

  it('hides only visible fixed and sticky elements', async () => {
    document.body.innerHTML = `
      <header id="h" style="position: fixed"></header>
      <nav id="n" style="position: sticky"></nav>
      <div id="d" style="position: relative"></div>
      <div id="gone" style="position: fixed; display: none"></div>`;
    await call('fpPrepare');
    expect(await call('fpHideFixed')).toEqual({ hidden: 2 });
    expect(document.getElementById('h').style.visibility).toBe('hidden');
    expect(document.getElementById('n').style.visibility).toBe('hidden');
    expect(document.getElementById('d').style.visibility).toBe('');
  });

  it('also zeroes the opacity of a hidden element, which a child cannot override', async () => {
    // Cookie banners set `visibility: visible` on their own children, which
    // beats the container's `visibility: hidden`: the background vanished but
    // the text was drawn over every frame. Opacity applies to the whole subtree.
    document.body.innerHTML = `
      <div id="banner" style="position: fixed; opacity: 0.95">
        <p id="text" style="visibility: visible">By clicking "Allow All Cookies"…</p>
      </div>`;
    await call('fpPrepare');
    expect(await call('fpHideFixed')).toEqual({ hidden: 1 });
    const banner = document.getElementById('banner').style;
    expect(banner.getPropertyValue('opacity')).toBe('0');
    expect(banner.getPropertyPriority('opacity')).toBe('important');

    await call('fpRestore');
    expect(banner.getPropertyValue('opacity')).toBe('0.95');
    expect(banner.getPropertyPriority('opacity')).toBe('');
    expect(banner.getPropertyValue('visibility')).toBe('');
  });

  it('hides the page scrollbar while capturing and puts it back', async () => {
    // macOS draws its overlay scrollbar for a moment after every scroll, and
    // it landed in each frame as a grey bar at the right edge.
    document.documentElement.style.setProperty('scrollbar-width', 'thin');
    await call('fpPrepare');
    const de = document.documentElement.style;
    expect(de.getPropertyValue('scrollbar-width')).toBe('none');
    expect(de.getPropertyPriority('scrollbar-width')).toBe('important');

    await call('fpRestore');
    expect(de.getPropertyValue('scrollbar-width')).toBe('thin');
    expect(de.getPropertyPriority('scrollbar-width')).toBe('');
  });

  it('restores scroll position and every inline style exactly, including !important', async () => {
    scrollY = 300;
    document.documentElement.style.setProperty('scroll-behavior', 'smooth', 'important');
    document.body.innerHTML = `<header id="h" style="position: fixed; visibility: visible"></header>
      <nav id="n" style="position: sticky"></nav>`;
    await call('fpPrepare');
    await call('fpHideFixed');
    expect(await call('fpRestore')).toEqual({ ok: true });

    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 300);
    const de = document.documentElement.style;
    expect(de.getPropertyValue('scroll-behavior')).toBe('smooth');
    expect(de.getPropertyPriority('scroll-behavior')).toBe('important');
    expect(document.body.style.getPropertyValue('scroll-behavior')).toBe('');
    expect(document.getElementById('h').style.visibility).toBe('visible');
    expect(document.getElementById('n').style.getPropertyValue('visibility')).toBe('');
  });

  it('restores the page by itself after 5 s without a message', async () => {
    scrollY = 120;
    document.body.innerHTML = '<header id="h" style="position: fixed"></header>';
    await call('fpPrepare');
    await call('fpHideFixed');
    await vi.advanceTimersByTimeAsync(4999);
    expect(document.getElementById('h').style.visibility).toBe('hidden');
    await vi.advanceTimersByTimeAsync(2);
    expect(document.getElementById('h').style.visibility).toBe('');
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 120);
  });

  it('treats fpRestore without fpPrepare as a no-op', async () => {
    expect(await call('fpRestore')).toEqual({ ok: true });
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('fpScrollTo before any fpPrepare replies with error and does not scroll', async () => {
    const reply = await call('fpScrollTo', { y: 720 });
    expect(reply).toEqual({ error: 'not-prepared' });
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('after fpPrepare, fpScrollTo once the watchdog has fired replies with error and does not scroll', async () => {
    await call('fpPrepare');
    await vi.advanceTimersByTimeAsync(5000);
    window.scrollTo.mockClear();
    const reply = await call('fpScrollTo', { y: 720 });
    expect(reply).toEqual({ error: 'not-prepared' });
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('if fpRestore arrives before fpScrollTo settles, no stray watchdog restores the page', async () => {
    await call('fpPrepare');
    const scrollReply = call('fpScrollTo', { y: 360 });
    await vi.advanceTimersByTimeAsync(100);
    await call('fpRestore');
    window.scrollTo.mockClear();
    await vi.advanceTimersByTimeAsync(100);
    await scrollReply;
    await vi.advanceTimersByTimeAsync(6000);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
