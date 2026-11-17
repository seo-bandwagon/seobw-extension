// Your data — the extension's own page (1.14.0)
//
// Draws src/lib/your-data.js's four parts and wires each consent flow's
// switch. The switches are the same ones Settings and the popup have, not
// copies: "Send analyses to SEO Bandwagon" writes `dataCollection` in
// chrome.storage.local, and each other flow's switch calls SBWConsent.accept
// or SBWConsent.withdraw (src/lib/consent.js), right under the flow's own
// words of what it sends, so turning one on here is the same specific action
// as its button in Settings. On a browser that asks for data categories
// itself, accept() asks inside this click, before any await.
//
// The status under each switch is what every send checks first,
// SBWConsent.check(), so the page says what the extension will do, not
// just what the switch shows.

(function () {

  const D = globalThis.SBWYourData;

  // Builds an element: h('div', { class: 'x', dataset: { row: 'y' } }, child, 'text').
  // Every string goes in as text, never as markup.
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v);
    });
    children.flat().forEach((c) => { if (c !== null && c !== undefined && c !== false) el.append(c); });
    return el;
  }

  function line(cls, key, text) {
    return h('div', { class: cls }, h('span', { class: 'yd-k' }, key), ' ' + text);
  }

  function rowEl(r, extra) {
    return h('div', { class: 'yd-row', dataset: { row: r.id || r.name } },
      h('div', { class: 'yd-row-title' }, r.title),
      h('div', { class: 'yd-row-text' }, r.text || r.sends),
      r.to ? line('yd-row-to', 'To', r.to) : null,
      extra || []);
  }

  function flowEl(f) {
    const id = 'yd-switch-' + f.name;
    return rowEl({ name: f.name, title: f.title, sends: f.sends, to: f.to }, [
      line('yd-row-why', 'Why', f.why),
      h('div', { class: 'checkbox-row yd-switch' },
        h('input', { type: 'checkbox', id, dataset: { flow: f.name, kind: f.switch.kind } }),
        h('label', { for: id }, f.switch.label)),
      h('p', { class: 'yd-status', id: id + '-status', role: 'status' })
    ]);
  }

  function fill(id, nodes) {
    document.getElementById(id).replaceChildren(...nodes);
  }

  async function hasKey() {
    try {
      const s = await SBW.getApiSettings();
      return !!(s && s.apiKey);
    } catch (e) {
      return false;
    }
  }

  async function isOn(input) {
    if (input.dataset.kind === 'dataCollection') {
      const got = await chrome.storage.local.get('dataCollection');
      return got.dataCollection !== false;
    }
    return !!(await SBWConsent.acceptance(input.dataset.flow));
  }

  function statusText(flow, on, decision, keyed) {
    if (!keyed) return on ? 'On, but no account is connected: nothing is sent.' : 'Off: nothing is sent.';
    if (decision.ok) return 'On: sent when you use it, as described above.';
    if (on && decision.reason === 'category_off') return 'Accepted, but switched off in Settings under Google results: nothing is sent.';
    return 'Off: nothing is sent.';
  }

  async function paint(input) {
    const flow = input.dataset.flow;
    const keyed = await hasKey();
    const on = await isOn(input);
    const decision = await SBWConsent.check(flow, { hasKey: keyed });
    input.checked = on;
    const status = document.getElementById(input.id + '-status');
    if (status) status.textContent = statusText(flow, on, decision, keyed);
  }

  function wire(input) {
    input.addEventListener('change', () => {
      const want = input.checked;
      let done;
      if (input.dataset.kind === 'dataCollection') {
        done = chrome.storage.local.set({ dataCollection: want });
      } else {
        // No await before accept(): a browser that asks for the flow's data
        // categories must ask inside this click.
        done = want ? SBWConsent.accept(input.dataset.flow) : SBWConsent.withdraw(input.dataset.flow);
      }
      Promise.resolve(done).catch(() => {}).then(() => paint(input));
    });
  }

  async function render() {
    if (!D) return;
    fill('ydDevice', D.ON_DEVICE.map((r) => rowEl(r)));
    fill('ydFlows', D.flowRows().map(flowEl));
    fill('ydClicks', D.ON_CLICK.map((r) => rowEl(r)));
    fill('ydVisits', D.VISITS.map((r) => rowEl(r)));
    fill('ydKept', D.KEPT.map((r) => rowEl(r)));
    fill('ydSyncedItems', D.SYNCED.items.map((i) => h('li', null, i)));
    document.getElementById('ydSyncedText').textContent = D.SYNCED.text;

    const keyed = await hasKey();
    document.getElementById('ydAccountLine').textContent = keyed
      ? 'An account is connected. Each flow below is sent only while its switch is on.'
      : 'No account is connected, so the extension sends nothing at all. Each flow below needs an account and its switch on.';

    document.querySelectorAll('#ydFlows input[data-flow]').forEach((input) => {
      wire(input);
      paint(input);
    });
  }

  // Another page (Settings, the popup) changing a switch shows here too.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' && area !== 'sync') return;
    if (!('dataCollection' in changes) && !(SBWConsent.STORAGE_KEY in changes) && !('serpSettings' in changes) && !('apiKey' in changes)) return;
    document.querySelectorAll('#ydFlows input[data-flow]').forEach(paint);
  });

  render();

  globalThis.SBWYourDataPage = { render, paint };
})();
