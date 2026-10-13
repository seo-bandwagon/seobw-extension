# Store assets — 1.7.7

Chrome Web Store screenshots (1280×800) and promo tiles for the 1.7.7
submission, replacing the 1.6.1 set. `contact-sheet-1.7.7.png` shows them all
at once, labelled. Outside `extension/`, so `npm run zip` never ships them.

Every screen is the real 1.7.7 extension on a real page, captured 2026-10-13
(Night appearance, signed out):

| File | What it shows | Source page |
|---|---|---|
| `screenshot-1-analysis` | Popup, Analysis tab: score 95, sub-scores, the issue it found | https://seobandwagon.com/ |
| `screenshot-2-link-check` | Link Check after a run: 70 OK, one real 404, five Chrome Web Store links reading "Can't check" (1.7.6) | https://seobandwagon.com/seo-chrome-extension |
| `screenshot-3-indexability` | Indexability: verdict, redirect chain, response headers, trace field | http://seobandwagon.com/seo-chrome-extension |
| `screenshot-4-serp-overlay` | Google results overlay (signed out: "Connect your account") and the Copy results / Export CSV / Copy PAA toolbar (1.7.5) | Live search "best crm for nonprofits", signed out, `gl=us&hl=en&pws=0` |
| `screenshot-5-night-day` | Page-checks panel in Night and Day | https://seobandwagon.com/seo-chrome-extension |
| `promo-tile-440x280`, `promo-marquee-1400x560` | Small and marquee promo tiles | Screens 1 and 2 |

Captions make no price, user-count or competitor claims, name issues rather
than fixes (as `tests/unit/listing-copy.test.js` requires of the listing), and
use sentences rather than lists of feature names. The Google search is outside
SEO, so no competitor's name or logo is in frame (CHROMEWEBSTORE.md,
Screenshot Notes).

## How they were made (`capture/`)

- `shots.mjs` launches Chromium with a copy of `extension/` whose
  `host_permissions` add `<all_urls>`, standing in for the optional grant a
  headless run can't click. It opens the **real action popup** with
  `chrome.action.openPopup()` (no `chrome.tabs.query` shim, unlike 1.6.1), the
  side panel with a click gesture, and a live signed-out Google results page.
  Analysis, Link Check, Indexability and the overlay all run for real.
- `compose.mjs` lays each capture on the 1280×800 brand frame of 1.6.1, with
  the fonts bundled in `extension/src/styles/fonts/`.
- Both need `puppeteer-core` (not a repo dependency) and a Chromium:

```bash
cp -r extension /tmp/ext && jq '.host_permissions += ["<all_urls>"]' extension/manifest.json > /tmp/ext/manifest.json
RAW=/tmp/raw EXT=/tmp/ext CHROME=/usr/bin/chromium node store-assets/1.7.7/capture/shots.mjs
RAW=/tmp/raw node store-assets/1.7.7/capture/compose.mjs
```

Live pages change: re-shoot rather than edit, and check the frame for
competitor names before uploading.
