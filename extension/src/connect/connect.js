// SEO Bandwagon — the page that asks before Connect stores a key (1.13.7)
//
// seobandwagon.com hands the extension a key to connect it to an account
// (service-worker.js answerSiteMessage). When that key is for a different
// account than the one connected, or no account is connected yet, the worker
// stores nothing and opens this page in a small window of its own
// (src/lib/site-connect.js). It names the account, and the one it replaces;
// only the person's Connect here stores the key. Cancel, or closing the
// window, leaves everything as it was. The request's id is in the hash; the
// key itself stays in the worker's session storage and is never shown here.

(function () {
  'use strict';

  const id = decodeURIComponent(location.hash.slice(1));
  const title = document.getElementById('connectTitle');
  const lead = document.getElementById('connectLead');
  const warn = document.getElementById('connectWarn');
  const yes = document.getElementById('connectYes');
  const no = document.getElementById('connectNo');
  const status = document.getElementById('connectStatus');

  // The buttons stay off until the window has been shown and focused for
  // ARM_MS (src/lib/site-connect.js), and go off again whenever it loses
  // focus or is hidden: a page can time a connect to the person's double
  // click, and the second click must not land on Connect.
  const ARM_MS = 1000;
  let asking = false;
  let armTimer = null;
  function disarm() {
    clearTimeout(armTimer);
    armTimer = null;
    if (!asking) return;
    yes.disabled = true;
    no.disabled = true;
  }
  function arm() {
    disarm();
    if (!asking) return;
    armTimer = setTimeout(() => {
      if (asking && document.visibilityState === 'visible' && document.hasFocus()) {
        yes.disabled = false;
        no.disabled = false;
      }
    }, ARM_MS);
  }
  window.addEventListener('focus', arm);
  window.addEventListener('blur', disarm);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') arm();
    else disarm();
  });

  function ask(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          void chrome.runtime.lastError;
          resolve(response || { ok: false });
        });
      } catch (e) {
        resolve({ ok: false });
      }
    });
  }

  function say(text, tone) {
    status.textContent = text;
    status.className = `status ${tone}`;
  }

  function ended() {
    asking = false;
    disarm();
    title.textContent = 'This request has ended';
    lead.textContent = 'Nothing was changed. To connect an account, start again from seobandwagon.com.';
    warn.hidden = true;
    yes.hidden = true;
    no.textContent = 'Close';
    no.disabled = false;
    no.onclick = () => window.close();
  }

  function show(pending) {
    const email = pending.email || 'an SEO Bandwagon account';
    title.textContent = `Connect to ${email}?`;
    if (pending.replacing === null || pending.replacing === undefined) {
      lead.textContent = `seobandwagon.com asked to connect this extension to ${email}. Once it is connected, the analyses you send go to that account, and so do analyses saved earlier that haven't been sent yet.`;
    } else if (pending.replacing) {
      lead.textContent = `seobandwagon.com asked to switch this extension from ${pending.replacing} to ${email}. The analyses you send from now on, and analyses saved earlier that haven't been sent yet, would go to ${email} instead.`;
    } else {
      lead.textContent = `seobandwagon.com asked to connect this extension to ${email}, in place of the key it has now.`;
    }
    asking = true;
    arm();
  }

  if (!id) {
    ended();
    return;
  }

  ask({ action: 'connectPending', id }).then((pending) => {
    if (!pending.ok) ended();
    else show(pending);
  });

  yes.addEventListener('click', async () => {
    if (!asking || yes.disabled) return;
    asking = false;
    disarm();
    yes.disabled = true;
    no.disabled = true;
    say('Connecting…', 'success');
    const result = await ask({ action: 'connectDecision', id, approve: true });
    if (result.ok) {
      say(`Connected to ${result.email || 'your account'}. This window closes by itself.`, 'success');
      setTimeout(() => window.close(), 1500);
      return;
    }
    if (result.error === 'expired') {
      ended();
      return;
    }
    say(`Could not connect (${result.error || 'no answer'}). Nothing was changed; try again from seobandwagon.com.`, 'error');
    no.textContent = 'Close';
    no.disabled = false;
    no.onclick = () => window.close();
  });

  no.addEventListener('click', async () => {
    if (no.onclick) return;
    if (!asking || no.disabled) return;
    asking = false;
    disarm();
    no.disabled = true;
    yes.disabled = true;
    await ask({ action: 'connectDecision', id, approve: false });
    window.close();
  });
})();
