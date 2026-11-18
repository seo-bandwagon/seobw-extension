// SEO Bandwagon — the "Your data" page's facts (1.14.0)
//
// One page of the extension's own (src/your-data/your-data.html) that says,
// in four parts:
//   1. what runs on the device and stays there;
//   2. what is sent, when and to whom: one row per flow in
//      src/lib/consent.js (FLOWS), each with the switch that governs it, then
//      the sends a click makes (no switch: the click is the yes) and the two
//      page visits the extension opens;
//   3. what seobandwagon.com keeps and for how long, in the words of
//      seobandwagon.com/privacy (read 2026-11-17, last updated November 16,
//      2026);
//   4. what the browser syncs: the account key and the API address, the two
//      values the extension keeps in storage.sync; every setting is in
//      storage.local and stays on the device.
//
// The rows for the consent flows are built from FLOWS itself, so a flow
// added there shows here (tests/unit/your-data.test.js fails on one with no
// row). Nothing on this page is sent anywhere.
//
// Pure: no DOM, no chrome. Dual-export pattern (see src/lib/sync-state.js):
// attaches to `globalThis.SBWYourData` when loaded as a classic <script>
// after src/lib/consent.js, and exports via CommonJS when loaded by Vitest.

(function (factory) {
  var consent = (typeof globalThis !== 'undefined' && globalThis.SBWConsent) ||
    (typeof require === 'function' ? require('./consent.js') : null);
  var api = factory(consent);
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWYourData = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function (consent) {

  // The privacy policy link is a static href in your-data.html, which the
  // build tags for each browser (see src/lib/site-links.js).
  const CONTACT_EMAIL = 'info@seobandwagon.com';

  // 1. On this device.
  const ON_DEVICE = [
    {
      id: 'analysis',
      title: 'The analysis',
      text: 'Every check runs in your browser, on the page you have open. With no account connected, nothing it finds leaves this device.'
    },
    {
      id: 'history',
      title: 'Your recent analyses',
      text: 'The last 500 analyses (up to 8 MB) are kept in this browser for the History page and the new tab, the oldest going first. Clear History removes them, and so does removing the extension.'
    },
    {
      id: 'screenshots',
      title: 'Proof screenshots',
      text: 'The full-page screenshots the Citations tab takes are kept on this device and never uploaded.'
    },
    {
      id: 'other-pages',
      title: 'Pages the checks read',
      text: 'Link Check, Indexability, Hreflang and Rendering, and Analyze on Google’s results pages, request those pages from the sites they are on, from your browser and without your cookies. Nothing they read is sent to SEO Bandwagon.'
    },
    {
      id: 'figures-cache',
      title: 'Figures already looked up',
      text: 'Figures and keyword data the extension has already received are kept in this browser only until you close it.'
    }
  ];

  // 2a. The consent flows: what each switch is, read by the page.
  //   'dataCollection': the "Send analyses to SEO Bandwagon" switch (on
  //     unless turned off), the same one as in the popup and Settings.
  //   'consent': the flow's own yes, SBWConsent.accept / withdraw, the
  //     same as the buttons in Settings.
  const SWITCHES = {
    captureSync: { kind: 'dataCollection', label: 'Send analyses to SEO Bandwagon' },
    serpFigures: { kind: 'consent', label: 'Send result addresses and show figures' },
    keywordData: { kind: 'consent', label: 'Send my searches for keyword data' },
    aioStudy: { kind: 'consent', label: 'Study sends (invited testers only)' }
  };

  const TO = {
    captureSync: 'seobandwagon.com, into your account',
    serpFigures: 'seobandwagon.com, which looks the figures up with DataForSEO',
    keywordData: 'seobandwagon.com, which looks the figures up with DataForSEO',
    aioStudy: 'seobandwagon.com, to the study, apart from your account'
  };

  /** One row per consent flow: `{ name, title, sends, why, to, switch }`. */
  function flowRows() {
    if (!consent || !consent.FLOWS) return [];
    return Object.keys(consent.FLOWS).map(function (name) {
      const f = consent.FLOWS[name];
      return {
        name: name,
        title: f.title,
        sends: f.sends,
        why: f.why,
        to: TO[name] || 'seobandwagon.com',
        switch: SWITCHES[name] || { kind: 'consent', label: f.title }
      };
    });
  }

  // 2b. Sent on a click, with an account connected: the click is the yes.
  const ON_CLICK = [
    {
      id: 'citation',
      title: 'Filing a citation',
      text: 'When you file a citation from the Citations tab: the directory’s name and address, the business name, address, phone and website found on the listing, the match score, its status and your notes. Never the screenshot.',
      to: 'seobandwagon.com, into your account'
    },
    {
      id: 'outlet',
      title: 'Adding an outlet',
      text: 'When you click + Add as outlet, in the popup or the Link Building panel: the tab’s address and title, as a link-building prospect.',
      to: 'seobandwagon.com, into your account'
    },
    {
      id: 'key',
      title: 'Your account key',
      text: 'When you connect an account, the key goes to seobandwagon.com to check it. From then on it goes with each request the extension makes to seobandwagon.com, and to no one else.',
      to: 'seobandwagon.com only'
    }
  ];

  // 2c. Pages the extension opens.
  const VISITS = [
    {
      id: 'welcome',
      title: 'On install',
      text: 'One tab opens SEO Bandwagon’s welcome page: an ordinary visit to seobandwagon.com. The extension adds only campaign tags to its address.'
    },
    {
      id: 'survey',
      title: 'On removal',
      text: 'Your browser opens a one-question page on seobandwagon.com, with the extension’s version in its address. Answering is optional.'
    }
  ];

  // 3. What seobandwagon.com keeps, and for how long (seobandwagon.com/privacy).
  const KEPT = [
    {
      id: 'captures',
      title: 'Analyses you save',
      text: 'Kept in your account, seen only by your account, until you ask us to delete them at ' + CONTACT_EMAIL + '.'
    },
    {
      id: 'figures',
      title: 'Result addresses, for figures',
      text: 'Each address is kept with its figures for 30 days, to answer later requests, without who asked. Your account keeps only a count of searches with new figures, for its allowance.'
    },
    {
      id: 'keywords',
      title: 'Your searches, for keyword data',
      text: 'Each search’s words, in lower case without punctuation, are kept with their figures for 30 days, then deleted, without who asked. Your account keeps only a count. A search you add with Add to my keywords is kept in your rank tracker like any keyword you track.'
    },
    {
      id: 'account-items',
      title: 'Citations and outlets',
      text: 'Kept in your account with the rest of it, until you delete them or ask us to.'
    },
    {
      id: 'study',
      title: 'AI Overview study (invited testers)',
      text: 'Each capture is kept in the study’s storage under a study code, never under your name or email, and apart from your account. We delete what you sent on request.'
    }
  ];

  // 4. What the browser syncs.
  const SYNCED = {
    items: ['Your SEO Bandwagon account key', 'The API address it is sent to'],
    text: 'If you are signed in to your browser with sync on, it copies these two to your other computers, so a second one is connected too. Every setting and switch, and every analysis, stays on this device.'
  };

  return {
    CONTACT_EMAIL,
    ON_DEVICE,
    SWITCHES,
    flowRows,
    ON_CLICK,
    VISITS,
    KEPT,
    SYNCED
  };
});
