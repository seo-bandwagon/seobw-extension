# Store assets — 1.8.0

Chrome Web Store screenshots (1280×800) and promo tiles for the 1.8.0
submission, replacing the 1.7.7 set. `contact-sheet-1.8.0.png` shows them all
at once, labelled. Outside `extension/`, so `npm run zip` never ships them.

Every screen is the real 1.8.0 extension on a real page, captured 2026-10-14
(Night appearance, signed out):

| File | What it shows | Source page |
|---|---|---|
| `screenshot-1-analysis` | Popup, Analysis tab: score, sub-scores, the issue it found | https://seobandwagon.com/ |
| `screenshot-2-link-check` | Link Check after a run: OK, one real 404, Chrome Web Store links reading "Can't check" | https://seobandwagon.com/seo-chrome-extension |
| `screenshot-3-indexability` | Indexability: verdict, redirect chain, response headers, trace field | http://seobandwagon.com/seo-chrome-extension |
| `screenshot-4-serp-collect` | **New in 1.8.0.** Google results with the overlay bars, and the toolbar after pages 1–3 were added by click ("Pages 1, 2, 3 added: 24 results · 3 repeats from earlier pages left out") | Live search "best crm for nonprofits", signed out, `gl=us&hl=en&pws=0` |
| `screenshot-5-night-day` | Page-checks panel in Night and Day, with 1.7.9's "Scan this page" | https://seobandwagon.com/seo-chrome-extension |
| `promo-tile-440x280`, `promo-marquee-1400x560` | Small and marquee promo tiles | Screens 1 and 2 |

Captions make no price, user-count or competitor claims and use sentences
rather than lists of feature names. The Google search is outside SEO, so no
competitor's name or logo is in frame (CHROMEWEBSTORE.md, Screenshot Notes).

## How they were made (`capture/`)

The 1.7.7 scripts, with one change: for screenshot 4, `shots.mjs` adds pages
1–3 the way a person does, clicking **Add page N** and then Google's own
**Next page →**, with a pause to read in between (a human in the loop: nothing
in the extension walks pages by itself). `compose.mjs` lays each capture on
the 1280×800 brand frame.

```bash
cp -r extension /tmp/ext && jq '.host_permissions += ["<all_urls>"]' extension/manifest.json > /tmp/ext/manifest.json
RAW=/tmp/raw EXT=/tmp/ext CHROME=/usr/bin/chromium node store-assets/1.8.0/capture/shots.mjs
RAW=/tmp/raw node store-assets/1.8.0/capture/compose.mjs
```

Both need `puppeteer-core` (not a repo dependency) and a Chromium. Live pages
change: re-shoot rather than edit, and check the frame for competitor names
before uploading.
