// First-run guide — popup UI (1.14.0)
//
// Shown at the top of the ANALYSIS tab the first time the popup opens after
// a fresh install (src/lib/first-run.js decides), above the analysis so it
// never covers it. "Got it" dismisses it for good; About & credits reopens
// it (SBWGuide.show, wired in src/popup/structured-data.js). "Your data"
// opens the extension's own Your data page; "Connect an account" opens
// Settings, where connecting starts. Nothing here sends anything.

(function () {

  const DATA_PAGE = '../your-data/your-data.html';

  function el() {
    return document.getElementById('firstRunGuide');
  }

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else node.setAttribute(k, v);
    });
    children.flat().forEach((c) => node.append(c));
    return node;
  }

  function render() {
    const box = el();
    const G = globalThis.SBWFirstRun && SBWFirstRun.GUIDE;
    if (!box || !G) return;
    const ok = h('button', { type: 'button', class: 'guide-btn guide-ok', id: 'guideOk' }, 'Got it');
    const connect = h('button', { type: 'button', class: 'guide-btn guide-connect', id: 'guideConnect' }, 'Connect an account');
    box.replaceChildren(
      h('div', { class: 'guide-head' }, h('span', { class: 'guide-title' }, G.title)),
      h('ol', { class: 'guide-steps' }, G.steps.map((s) => h('li', { class: 'guide-step', dataset: { step: s.id } },
        h('span', { class: 'guide-step-h' }, s.heading),
        h('span', { class: 'guide-step-p' }, s.text)))),
      h('div', { class: 'guide-actions' },
        ok,
        h('a', { class: 'guide-btn guide-data', id: 'guideData', href: DATA_PAGE, target: '_blank', rel: 'noopener' }, 'Your data'),
        connect)
    );
    ok.addEventListener('click', dismiss);
    connect.addEventListener('click', () => chrome.runtime.openOptionsPage());
    box.hidden = false;
  }

  async function dismiss() {
    const box = el();
    if (box) box.hidden = true;
    try {
      await chrome.storage.local.set({ [SBWFirstRun.KEY]: SBWFirstRun.dismissedRecord() });
    } catch (e) {
      // Storage refused: the guide shows again next time, which is harmless.
    }
  }

  // Reopened from About & credits: on the ANALYSIS tab, scrolled into view.
  function show() {
    document.querySelector('.switcher button[data-tab="seo"]')?.click();
    render();
    el()?.scrollIntoView({ block: 'start' });
  }

  async function init() {
    if (!globalThis.SBWFirstRun) return;
    let record = null;
    try {
      record = (await chrome.storage.local.get(SBWFirstRun.KEY))[SBWFirstRun.KEY];
    } catch (e) {
      return;
    }
    if (SBWFirstRun.shouldShow(record)) render();
  }

  init();

  globalThis.SBWGuide = { show, dismiss, DATA_PAGE };
})();
