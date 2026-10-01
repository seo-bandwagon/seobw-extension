// SEO Bandwagon — page helper for full-page proof screenshots
//
// Injected on demand by the popup (src/popup/fullpage-capture.js), the same
// way src/content/nap-extractor.js is. The popup drives it one message at a
// time: measure, scroll to each frame, hide fixed/sticky elements after the
// first frame (so a sticky header appears once, at the top), then restore.
//
// Every inline style it touches is saved with its priority and put back
// exactly. If the popup closes mid-capture, no fpRestore ever arrives, so a
// watchdog restores the page 5 s after the last message.

(function () {
  // Guard against double-injection
  if (window.__sbwPageScrollerLoaded) return;
  window.__sbwPageScrollerLoaded = true;

  const WATCHDOG_MS = 5000;
  const SETTLE_MS = 150;

  let saved = null; // { x, y, styles: [{ el, prop, value, priority }] }
  let watchdog = null;

  function arm() {
    clearTimeout(watchdog);
    watchdog = setTimeout(restore, WATCHDOG_MS);
  }

  function remember(el, prop) {
    saved.styles.push({
      el, prop,
      value: el.style.getPropertyValue(prop),
      priority: el.style.getPropertyPriority(prop)
    });
  }

  function hasInnerScroller() {
    const minHeight = window.innerHeight * 0.5;
    for (const el of document.querySelectorAll('body, body *')) {
      if (el.clientHeight < minHeight || el.scrollHeight <= el.clientHeight + 2) continue;
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') return true;
    }
    return false;
  }

  function prepare() {
    if (saved) restore();
    saved = { x: window.scrollX, y: window.scrollY, styles: [] };
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      remember(el, 'scroll-behavior');
      el.style.setProperty('scroll-behavior', 'auto', 'important');
    }
    const de = document.documentElement;
    const se = document.scrollingElement || de;
    return {
      scrollHeight: Math.max(se.scrollHeight, de.scrollHeight),
      viewportWidth: de.clientWidth || window.innerWidth,
      // clientHeight leaves out a horizontal scrollbar, which a screenshot doesn't show.
      viewportHeight: se.clientHeight || window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      innerScroll: hasInnerScroller()
    };
  }

  function nextFrame() {
    return new Promise(resolve => {
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 16);
    });
  }

  async function scrollToY(y) {
    window.scrollTo(0, y);
    // Two frames so the scroll paints, then a pause for lazy images.
    await nextFrame();
    await nextFrame();
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS));
    return { scrollY: window.scrollY };
  }

  function hideFixed() {
    if (!saved) return { hidden: 0 };
    let hidden = 0;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      remember(el, 'visibility');
      el.style.setProperty('visibility', 'hidden', 'important');
      hidden++;
    }
    return { hidden };
  }

  function restore() {
    clearTimeout(watchdog);
    watchdog = null;
    if (!saved) return { ok: true };
    // Scroll back while scroll-behavior is still forced to auto, so it's instant.
    window.scrollTo(saved.x, saved.y);
    for (const s of saved.styles.reverse()) {
      if (s.value) s.el.style.setProperty(s.prop, s.value, s.priority);
      else s.el.style.removeProperty(s.prop);
    }
    saved = null;
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg && msg.action) {
      case 'fpPrepare': {
        const metrics = prepare();
        arm();
        sendResponse(metrics);
        return false;
      }
      case 'fpScrollTo':
        if (!saved) {
          sendResponse({ error: 'not-prepared' });
          return false;
        }
        arm();
        scrollToY(msg.y).then(reply => { if (saved) arm(); sendResponse(reply); });
        return true;
      case 'fpHideFixed':
        arm();
        sendResponse(hideFixed());
        return false;
      case 'fpRestore':
        sendResponse(restore());
        return false;
      default:
        return undefined;
    }
  });
})();
