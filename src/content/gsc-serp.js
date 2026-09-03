// SEO Bandwagon — Google Search Console "Search in Incognito" injector
//
// Adds a magnifying-glass action icon to every row in the GSC Performance
// report (Queries / Pages tabs). Clicking it opens the row's query or URL as a
// Google Search in a new incognito window.
//
// Resilience strategy: GSC ships React with auto-generated, frequently-rotated
// CSS class names. We never hardcode those. Instead we locate the native action
// icons structurally via role="button" and *copy* their class list onto our own
// button so it inherits GSC's exact sizing, spacing and hover/visibility rules.

(function () {
  'use strict';

  if (window.__seoBwGscSerpLoaded) return;
  window.__seoBwGscSerpLoaded = true;

  const FLAG = 'seoBwSerp';            // -> cell.dataset.seoBwSerp (inject-once guard)
  const ICON_CLASS = 'seo-bw-serp-icon';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Build the magnifying-glass icon via namespaced DOM (no innerHTML).
  // Inherits color from the native icon via stroke="currentColor".
  function buildIcon() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', '11');
    circle.setAttribute('cy', '11');
    circle.setAttribute('r', '7');

    const handle = document.createElementNS(SVG_NS, 'line');
    handle.setAttribute('x1', '20');
    handle.setAttribute('y1', '20');
    handle.setAttribute('x2', '16.05');
    handle.setAttribute('y2', '16.05');

    svg.append(circle, handle);
    return svg;
  }

  // Minimal styling: only size/center the SVG inside the (native-classed) box and
  // make sure the glyph color tracks the native icons. Box geometry comes from
  // the copied native classes, so we deliberately don't touch width/height here.
  function ensureStyles() {
    if (document.getElementById('seo-bw-serp-styles')) return;
    const style = document.createElement('style');
    style.id = 'seo-bw-serp-styles';
    style.textContent =
      '.' + ICON_CLASS + ' { cursor: pointer; color: inherit; }' +
      '.' + ICON_CLASS + ' svg { display: block; width: 18px; height: 18px; margin: auto; }';
    (document.head || document.documentElement).appendChild(style);
  }

  // Pull the clean row text. Prefer a [title] attribute (GSC sets it to the full,
  // untruncated query/URL) to avoid picking up hidden or ellipsized DOM text.
  // Skip titles that belong to action icons (native "Copy"/"Open in new tab",
  // and our own injected button) — those are tooltips, not the row's query.
  function extractQuery(cell) {
    for (const el of cell.querySelectorAll('[title]')) {
      if (el.closest('[role="button"]')) continue;
      const t = (el.getAttribute('title') || '').trim();
      if (t) return t;
    }
    return (cell.textContent || '').trim();
  }

  function injectInto(cell) {
    // Liveness check first: React can re-render a row's children (wiping our
    // button) while KEEPING the <td> node — so the dataset flag alone would go
    // stale and block re-injection forever. Presence of the icon is the truth;
    // the flag is just the "injected once" marker for intact rows.
    if (cell.querySelector('.' + ICON_CLASS)) return;

    // Native action icons (Copy, Open in new tab) expose role="button".
    const nativeButtons = cell.querySelectorAll('[role="button"]');
    if (!nativeButtons.length) return; // row not ready / not an action row

    const reference = nativeButtons[0];
    const container = reference.parentElement;
    if (!container) return;

    if (!extractQuery(cell)) return; // header/checkbox cell — nothing to search

    // Inject-once marker per row (re-set on re-injection after a React wipe).
    cell.dataset[FLAG] = '1';

    const btn = document.createElement('div');
    btn.className = ICON_CLASS;
    // Copy the EXACT native class names (classList works for HTML + SVG nodes).
    if (reference.classList.length) btn.classList.add(...reference.classList);
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', 'Open in Google (Incognito)');
    btn.setAttribute('title', 'Open in Google (Incognito)');
    btn.appendChild(buildIcon());

    const trigger = (e) => {
      // Stop GSC from treating this as a row click (which filters the report).
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      // Extract at CLICK time, not inject time: React recycles cells for
      // different rows, so a query captured in a closure could go stale.
      const query = extractQuery(cell);
      if (query) {
        chrome.runtime.sendMessage({ action: 'openIncognitoSearch', query });
      }
    };

    // Capture phase + swallow mousedown so the row's own handlers never fire.
    btn.addEventListener('click', trigger, true);
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }, true);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') trigger(e);
    });

    container.appendChild(btn);
  }

  function scan() {
    // Only act on the Performance report (GSC is an SPA — re-check live).
    if (!/\/performance\b/.test(location.pathname)) return;
    // First cell of each data row holds the query/URL and its action icons.
    document.querySelectorAll('td:first-child').forEach(injectInto);
  }

  // Coalesce bursty React re-renders into one scan per frame.
  let scheduled = false;
  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      ensureStyles();
      scan();
    });
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Initial pass (rows may already be present on load).
  ensureStyles();
  scan();
})();
