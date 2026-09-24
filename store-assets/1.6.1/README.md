# Store assets — 1.6.1

Chrome Web Store screenshots (1280×800) and promo tiles for the 1.6.1
submission. `contact-sheet-1.6.1.png` shows them all at once, labelled.
Outside `extension/`, so `npm run zip` never ships them.

Every screen is the real extension on a real page, captured 2026-09-24:

| File | What it shows | Source page |
|---|---|---|
| `screenshot-1-analysis` | Popup, Analysis tab: score 95, sub-scores, issues | https://seobandwagon.com/ |
| `screenshot-2-link-check` | Link Check after a run: 54 OK, 1 × 403 (x.com refuses bots) | https://seobandwagon.com/ |
| `screenshot-3-indexability` | Indexability: verdict, redirect chain, response headers | http://seobandwagon.com/seo-chrome-extension |
| `screenshot-4-serp-overlay` | Google results overlay, signed out | A saved "best crm for nonprofits" results page (2026-09-16) |
| `screenshot-5-night-day` | Page-checks panel in Night and Day | https://seobandwagon.com/seo-chrome-extension |
| `promo-tile-440x280`, `promo-marquee-1400x560` | Small and marquee promo tiles | Screens 1 and 2 |

## How they were made (`capture/`)

- `shots.cjs` launches Playwright's Chromium with a copy of `extension/` loaded
  (`--load-extension`). The copy adds `<all_urls>` to `host_permissions`, which
  stands in for granting the optional permission, because a headless run can't
  click the permission prompt. It opens the page, then opens `popup.html` or
  `panel.html` in a second tab. The only shim is `chrome.tabs.query`, so that
  "the active tab" means the page tab and not the extension tab itself. The
  analysis, Link Check probes and Indexability capture all run for real.
  - Environment: `S=<scratch dir with ext/>`, and optionally `SECTION`,
    `CLICK` and `WAIT`.
- `serp.cjs` serves a saved Google results page at a `google.com/search` URL,
  so the real content script injects. It makes three changes to the saved page:
  - strips Google's scripts
  - removes the overlay copy that was saved along with the page (the page was
    saved with the extension running)
  - hides the saver's Google account avatar
- `compose.cjs` lays each capture on the 1280×800 brand frame, using the fonts
  bundled in `extension/src/styles/fonts/`.

Captions make no price, user-count or competitor claims.
