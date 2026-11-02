// SEO Bandwagon — the popup on a Google results page (1.11.0)
//
// The page analyzer is noise on a results page (it's not a page a client
// owns), so since Task 6 the popup said only "SEARCH RESULTS PAGE". It is
// now that page's panel:
//   - what the search shows (AI Overview, local pack, People also ask, ads,
//     shopping, videos and the rest), read by the overlay from the page;
//   - the exports, made by the overlay with the same columns as its own
//     buttons (figures, features, AI Overview sources, result type);
//   - the account: connected or not, the figures accepted or not, the plan
//     and what is left of today's allowance, the limit or the monthly pause,
//     each with the one link that helps;
//   - the "Google results" settings (src/lib/serp-settings-ui.js).
// Everything here is asked of the overlay in the tab ('serpStatus',
// 'serpExport', 'serpLoadFigures') or of the worker ('serpFiguresStatus');
// nothing is sent anywhere by opening the popup.

(function () {
  'use strict';

  const KEY_FEATURES = ['ai_overview', 'local_pack', 'people_also_ask', 'ads', 'shopping', 'videos'];
  const FEATURE_NAMES = {
    ai_overview: 'AI Overview', local_pack: 'Local pack', people_also_ask: 'People also ask', ads: 'Ads',
    shopping: 'Shopping', videos: 'Videos'
  };

  const esc = (t) => globalThis.SBWPopup.esc(t);

  function ask(tabId, msg) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, msg, (reply) => { void chrome.runtime.lastError; resolve(reply); });
      } catch (e) { resolve(undefined); }
    });
  }

  function askWorker(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (reply) => { void chrome.runtime.lastError; resolve(reply); });
      } catch (e) { resolve(undefined); }
    });
  }

  async function openSite(path) {
    const settings = await SBW.getApiSettings();
    chrome.tabs.create({ url: SBWSiteLinks.siteUrl(SBWOptions.dashboardOrigin(settings.apiUrl), path, 'popup') });
  }

  function openSettings() {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html#google-results') });
  }

  function noticeLine(status) {
    if (!status || typeof status.rows !== 'number') return 'This is a search results page.';
    const n = status.rows;
    if (n > 0) {
      return `Found ${n} result${n === 1 ? '' : 's'} on this page, each with an SEO Bandwagon bar under it. ` +
        'Copy results, Export CSV, Copy PAA and Collect pages are in the SEO Bandwagon panel on the page, and the exports below.';
    }
    if (status.headings > 0) {
      return "Couldn't read the results on this page. Google may have changed its layout; please let us know at seobandwagon.com.";
    }
    return 'No web results to read on this page (an Images, Videos or News tab, or no results).';
  }

  function featuresHtml(status) {
    if (!status || !Array.isArray(status.features)) return '<span class="srp-muted">No overlay on this page, so nothing to read. Reload the page.</span>';
    const found = new Map(status.features.map((f) => [f.key, f]));
    const items = KEY_FEATURES.map((key) => {
      const f = found.get(key);
      const label = FEATURE_NAMES[key] + (f && f.count ? ` (${f.count})` : '');
      return `<li class="srp-feature" data-present="${f ? 'true' : 'false'}"><span class="srp-feature-mark" aria-hidden="true">${f ? '●' : '○'}</span> ${esc(label)}<span class="srp-sr"> ${f ? 'shown' : 'not shown'}</span></li>`;
    });
    status.features.filter((f) => !KEY_FEATURES.includes(f.key)).forEach((f) => {
      items.push(`<li class="srp-feature" data-present="true"><span class="srp-feature-mark" aria-hidden="true">●</span> ${esc(f.label)}<span class="srp-sr"> shown</span></li>`);
    });
    let extra = '';
    const cited = Number(status.aiCitations) || 0;
    if (cited) extra += `<p class="srp-line">The AI Overview cites ${cited} page${cited === 1 ? '' : 's'}.</p>`;
    const own = Array.isArray(status.ownSites) ? status.ownSites.map(Number).filter(Number.isFinite) : [];
    if (own.length) extra += `<p class="srp-line">Your sites in these results: ${own.map((p) => '#' + p).join(', ')}.</p>`;
    return `<ul class="srp-features">${items.join('')}</ul>${extra}`;
  }

  // The account part: one line for each thing that is true, and the one
  // button that helps with it.
  async function accountHtml(tab, status) {
    const F = globalThis.SBWSerpFigures;
    const [{ apiKey }, local, record, last] = await Promise.all([
      new Promise((resolve) => chrome.storage.sync.get({ apiKey: '' }, resolve)),
      chrome.storage.local.get(['sbwKeyStatus', 'sbwUser']),
      SBWConsent.acceptance('serpFigures'),
      askWorker({ action: 'serpFiguresStatus' })
    ]);
    const fig = (status && status.figures) || {};
    const lines = [];
    const buttons = [];
    const user = local.sbwUser && local.sbwUser.data;
    if (!apiKey) {
      lines.push('Not connected. Position, Analyze and the exports work without an account; figures need a free one.');
      buttons.push(['connect', 'Connect free']);
    } else if (local.sbwKeyStatus === 'invalid' || fig.code === 'unauthorized') {
      lines.push('Your SEO Bandwagon key was refused.');
      buttons.push(['connect', 'Reconnect']);
    } else {
      lines.push(user && (user.email || user.name) ? `Connected as ${user.email || user.name}.` : 'Connected.');
    }
    if (!record) {
      lines.push('Figures are off: they send the address of each result to SEO Bandwagon, and are turned on in Settings.');
      buttons.push(['settings', 'Turn on figures in Settings']);
    } else if (fig.state === 'error' && fig.code === 'forbidden') {
      lines.push(F.errorWords('forbidden').text + '.');
      buttons.push(['connect', 'Reconnect']);
    } else if (fig.state === 'error' && fig.code) {
      lines.push(F.errorWords(fig.code).text + '.');
    }
    const standing = fig.allowance ? fig : (last || null);
    const allowance = F.allowanceLine(standing);
    if (allowance) lines.push(allowance);
    const notice = F.lookupNotice(standing);
    if (notice) {
      lines.push(notice.text);
      if (notice.upgrade) buttons.push(['upgrade', 'Upgrade for more figures']);
    }
    if (record && apiKey && fig.state === 'idle') {
      buttons.push(['load', 'Load figures']);
    }
    return `${lines.map((l) => `<p class="srp-line">${esc(l)}</p>`).join('')}
      <div class="srp-actions">${buttons.map(([a, label]) => `<button type="button" class="srp-btn" data-account="${a}">${esc(label)}</button>`).join('')}</div>`;
  }

  function copy(text) {
    return navigator.clipboard.writeText(text).then(() => true, () => false);
  }

  function download(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportAction(tab, kind, out) {
    const reply = await ask(tab.id, { action: 'serpExport', kind });
    const nothing = { tsv: 'No results to copy.', csv: 'No results to export.', paa: 'No People also ask questions on this page.', ai: 'No AI Overview sources on this page.' };
    if (!reply || !reply.text) { out.textContent = reply === undefined ? 'Reload the results page first.' : nothing[kind]; return; }
    if (kind === 'csv') {
      download(reply.text, reply.filename || 'serp-results.csv');
      out.textContent = 'Downloaded ' + (reply.filename || 'the CSV') + '.';
      return;
    }
    out.textContent = (await copy(reply.text)) ? 'Copied.' : 'Copy failed.';
  }

  async function render(container, tab) {
    container.innerHTML = `
      <div class="serp-panel">
        <div class="empty sbw-serp-notice">
          <div class="empty-title">SEARCH RESULTS PAGE</div>
          <div class="empty-sub" id="serpNoticeText">This is a search results page.</div>
        </div>
        <section class="srp-block" aria-labelledby="spFeaturesTitle">
          <div class="srp-block-title" id="spFeaturesTitle">What this search shows</div>
          <div id="serpFeatures"><span class="srp-muted">Reading the page…</span></div>
        </section>
        <section class="srp-block" aria-labelledby="spExportTitle">
          <div class="srp-block-title" id="spExportTitle">Export</div>
          <div class="srp-actions">
            <button type="button" class="srp-btn" data-export="tsv">Copy results</button>
            <button type="button" class="srp-btn" data-export="csv">Download CSV</button>
            <button type="button" class="srp-btn" data-export="paa">Copy People also ask</button>
            <button type="button" class="srp-btn" data-export="ai">Copy AI Overview sources</button>
          </div>
          <p class="srp-line srp-muted">With each result’s type, its figures where loaded, and the search’s features.</p>
          <p class="srp-line" id="serpExportStatus" role="status"></p>
        </section>
        <section class="srp-block" aria-labelledby="spAccountTitle">
          <div class="srp-block-title" id="spAccountTitle">Figures and your account</div>
          <div id="serpAccount"><span class="srp-muted">Checking…</span></div>
        </section>
        <section class="srp-block" aria-labelledby="spSettingsTitle">
          <div class="srp-block-title" id="spSettingsTitle">Google results settings</div>
          <div id="serpSettingsPopup"></div>
        </section>
      </div>`;

    const out = container.querySelector('#serpExportStatus');
    container.querySelectorAll('[data-export]').forEach((b) => {
      b.addEventListener('click', () => exportAction(tab, b.getAttribute('data-export'), out));
    });
    SBWSerpSettingsUI.render(container.querySelector('#serpSettingsPopup'), { idPrefix: 'pop', compact: true });

    const status = await ask(tab.id, { action: 'serpStatus' });
    container.querySelector('#serpNoticeText').textContent = noticeLine(status);
    container.querySelector('#serpFeatures').innerHTML = featuresHtml(status);
    const account = container.querySelector('#serpAccount');
    account.innerHTML = await accountHtml(tab, status);
    account.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-account]');
      if (!b) return;
      const a = b.getAttribute('data-account');
      if (a === 'connect') openSite('/dashboard/api-keys');
      else if (a === 'upgrade') openSite('/pricing');
      else if (a === 'settings') openSettings();
      else if (a === 'load') {
        await ask(tab.id, { action: 'serpLoadFigures' });
        b.disabled = true;
        b.textContent = 'Loading figures…';
        setTimeout(async () => {
          account.innerHTML = await accountHtml(tab, await ask(tab.id, { action: 'serpStatus' }));
        }, 1500);
      }
    });
    return status;
  }

  globalThis.SBWSerpPanel = { render, noticeLine, featuresHtml, KEY_FEATURES };
})();
