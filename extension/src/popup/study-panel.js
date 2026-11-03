// SEO Bandwagon: the popup's STUDY tab (1.13.3)
//
// For people invited to the AI Overview study, who said yes to study sends in
// Options. The tab lists the day's terms, opens each in a private window (the
// worker does that, and refuses with a reason when it can't), and has a
// "Google stopped me" button for a day Google stops the searches. Every word
// about why something can't happen is SBWAioStudy.message's, so the popup, the
// results page and the worker say the same thing.
//
// Everything is asked of the worker ('aioStudyToday', 'aioStudyOpen',
// 'aioStudyStop'); nothing is sent to the study from here. The DOM is built
// with createElement and textContent: a term's keyword comes from the server.
//
// shouldShow() decides whether popup.js shows the STUDY button at all;
// render(container, deps) fills the tab. `deps` lets tests replace the
// worker (askWorker) and the tab opener (openUrl).

(function () {
  'use strict';

  const STATUS_WORDS = { open: 'To do', late: 'Carried over', sent: 'Sent' };

  function askWorker(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (reply) => { void chrome.runtime.lastError; resolve(reply); });
      } catch (e) { resolve(undefined); }
    });
  }

  function openUrl(url) {
    chrome.tabs.create({ url });
  }

  // A page on seobandwagon.com (or the staging site the person set), tagged
  // as opened from the popup.
  async function siteUrl(path) {
    const settings = await SBW.getApiSettings();
    return SBWSiteLinks.siteUrl(SBWOptions.dashboardOrigin(settings.apiUrl), path, 'popup');
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // The one button that helps with a state or a refusal, if there is one:
  // [label, what a click does].
  function helpFor(code, deps) {
    const S = globalThis.SBWAioStudy;
    switch (code) {
      case 'incognito_off':
        return ["Open SEO Bandwagon's Details page", async () => deps.openUrl('chrome://extensions/?id=' + chrome.runtime.id)];
      case 'not_enrolled':
        return ['Join on seobandwagon.com', async () => deps.openUrl(await siteUrl(S.JOIN_PATH))];
      case 'no_key':
        return ['Connect', async () => deps.openUrl(await siteUrl(S.CONNECT_PATH))];
      case 'reconnect':
        return ['Reconnect', async () => deps.openUrl(await siteUrl(S.CONNECT_PATH))];
      case 'not_accepted':
        return ['Open settings', async () => deps.openUrl(chrome.runtime.getURL('src/options/options.html#aio-study'))];
      default:
        return null;
    }
  }

  function button(label, onClick) {
    const b = el('button', 'srp-btn', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  // A line of words that is read out when it changes, and the row of buttons
  // that goes with it.
  function noticeArea() {
    const line = el('p', 'srp-line study-notice');
    line.setAttribute('role', 'status');
    return { line, actions: el('div', 'srp-actions') };
  }

  function say(area, code, text, deps) {
    area.line.textContent = text;
    area.actions.replaceChildren();
    const help = helpFor(code, deps);
    if (help) area.actions.appendChild(button(help[0], help[1]));
  }

  function termRow(term, area, deps, container) {
    const S = globalThis.SBWAioStudy;
    const row = el('li', 'study-term');
    row.dataset.status = term.status;
    row.appendChild(el('span', 'study-keyword', term.keyword));
    row.appendChild(el('span', 'study-status', STATUS_WORDS[term.status]));
    if (term.status === 'open' || term.status === 'late') {
      const search = button('Search', async () => {
        search.disabled = true;
        const reply = await deps.askWorker({ action: 'aioStudyOpen', termId: term.term_id });
        if (reply && reply.ok === true) {
          say(area, null, 'Opened in a private window.', deps);
          search.disabled = false;
          return;
        }
        const reason = reply && typeof reply.reason === 'string' ? reply.reason : 'error';
        // The list on screen is out of date: ask for it again, and draw it
        // with the words.
        if (reason === 'already_sent' || reason === 'not_on_list') {
          await draw(container, deps, { code: reason, text: S.message(reason) }, true);
          return;
        }
        say(area, reason, S.message(reason), deps);
        search.disabled = false;
      });
      row.appendChild(search);
    }
    return row;
  }

  function readyBody(today, area, deps, container) {
    const S = globalThis.SBWAioStudy;
    const body = document.createDocumentFragment();
    const head = el('div', 'study-head');
    const week = S.weekLabel(today.week);
    if (week) head.appendChild(el('span', 'study-week', week));
    head.appendChild(el('span', 'study-date', today.date + ' (UTC)'));
    body.appendChild(head);
    if (today.terms.length) {
      const list = el('ul', 'study-terms');
      today.terms.forEach((term) => list.appendChild(termRow(term, area, deps, container)));
      body.appendChild(list);
    } else {
      body.appendChild(el('p', 'srp-line', 'No terms for today.'));
    }
    return body;
  }

  // A stop moves the rest of the day's terms to tomorrow, so the first click
  // only asks: the button says so for a few seconds, and a second click in
  // that time records the stop.
  function stopBlock(deps, container) {
    const S = globalThis.SBWAioStudy;
    const block = el('div', 'srp-block study-stop');
    let asking = null;
    const stop = button(S.STOP_LABEL, async () => {
      if (asking === null) {
        stop.textContent = S.STOP_CONFIRM_LABEL;
        asking = setTimeout(() => {
          asking = null;
          stop.textContent = S.STOP_LABEL;
        }, S.STOP_CONFIRM_MS);
        return;
      }
      clearTimeout(asking);
      asking = null;
      stop.disabled = true;
      const reply = await deps.askWorker({ action: 'aioStudyStop' });
      const state = reply && typeof reply.state === 'string' ? reply.state : 'error';
      await draw(container, deps, { code: state, text: S.message(state) }, true);
    });
    block.appendChild(stop);
    return block;
  }

  // Fills the tab: asks for the day's list, then draws it or the words for
  // why there isn't one. `notice` ({ code, text }) is the words of the click
  // that made this drawing, shown with the list. The worker keeps the list a
  // few minutes and the site limits requests for the whole account, so it is
  // asked for afresh (`fresh`) only when what is on screen is known to be
  // wrong: after a refusal that says so, and after a stop.
  async function draw(container, deps, notice, fresh) {
    const S = globalThis.SBWAioStudy;
    container.replaceChildren(el('div', 'loading', 'Loading…'));
    const today = await deps.askWorker(fresh ? { action: 'aioStudyToday', fresh: true } : { action: 'aioStudyToday' });
    let state = today && typeof today.state === 'string' ? today.state : 'unavailable';
    if (state === 'ready' && !Array.isArray(today.terms)) state = 'unavailable';

    const panel = el('div', 'study-panel');
    const area = noticeArea();
    if (state === 'ready') {
      panel.appendChild(readyBody(today, area, deps, container));
      panel.appendChild(area.line);
      panel.appendChild(area.actions);
      // With no terms there is nothing for Google to have stopped.
      if (today.terms.length) panel.appendChild(stopBlock(deps, container));
      if (notice) say(area, notice.code, notice.text, deps);
    } else {
      // Why there is no list comes first; a click's words follow, unless
      // they are the same words.
      say(area, state, S.message(state), deps);
      panel.appendChild(area.line);
      panel.appendChild(area.actions);
      if (notice && notice.code !== state) {
        const after = noticeArea();
        say(after, notice.code, notice.text, deps);
        panel.appendChild(after.line);
        panel.appendChild(after.actions);
      }
    }
    container.replaceChildren(panel);
  }

  // Whether the STUDY tab shows at all: only after the yes to study sends.
  async function shouldShow() {
    try {
      return !!(await SBWConsent.acceptance('aioStudy'));
    } catch (e) {
      return false;
    }
  }

  async function render(container, deps) {
    await draw(container, Object.assign({ askWorker, openUrl }, deps));
  }

  globalThis.SBWStudyPanel = { shouldShow, render };
})();
