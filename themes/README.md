# SEO Bandwagon — Chrome themes

Two Chrome Web Store items. A Chrome theme is images and colours only — it cannot
run code and cannot follow the OS light/dark setting — so light and dark ship
separately and cross-link in their listings. The extension's popup, side panel and
options page follow the same Night / Day palette (Appearance control in the side
panel and on the options page; Auto follows the OS setting).

    themes/
      bandwagon-neon-night/   dark theme package (manifest.json + images/)
      bandwagon-neon-day/     light theme package
      store/                  listing assets at the required sizes + LISTING.md
      art/                    generators — nothing here ships

## Test locally
`chrome://extensions` → Developer mode → **Load unpacked** → pick `themes/bandwagon-neon-night`
(or `-day`). Chrome runs one theme at a time; loading the other replaces it.

## Package
`npm run zip:themes` writes `seo-bw-theme-neon-night.zip` and `seo-bw-theme-neon-day.zip`
at the repo root, each with `manifest.json` at the zip root (the usual mistake is
zipping the folder instead of its contents). Upload each as a **new item** in the
developer dashboard; category Themes → Dark & Black / Light & White.

## Listing
Text and the asset table are in `store/LISTING.md`. Assets:

| Field | Night | Day |
|---|---|---|
| Store icon 128 × 128 | `store/icon-128-night.png` | `store/icon-128-day.png` |
| Small promo tile 440 × 280 | `store/tile-440x280-night.png` | `store/tile-440x280-day.png` |
| Marquee 1400 × 560 | `store/marquee-1400x560-night.png` | `store/marquee-1400x560-day.png` |
| Screenshot 1280 × 800 | install the theme, open a new tab, capture the window | same |

After the first upload of each item, put its Item ID into `THEME_IDS` in
`extension/src/lib/theme-mode.js` and paste each listing's URL into the other's
"Prefer light? / Prefer dark?" line.

## Regenerating art
- `node themes/art/render.mjs [seed]` — both wallpapers, 3840 × 1250, from
  `render-city.js` (deterministic; default seed 20260906). `ntp_background` is
  bottom-aligned and never scaled by Chrome, so the composition lives in the
  bottom 620 px and the edges fade to the exact `ntp_background` colour.
- `node themes/art/frames.mjs` — `theme_frame` / `theme_frame_inactive` strips in
  the manifest's frame colours.
- `node themes/art/store-assets.mjs` — icons, tiles and marquees, rendered from
  the design board's own markup with the brand fonts (needs network for Google Fonts).

The icons, frame strips and store assets were regenerated from the design's
generator and markup rather than copied byte-for-byte from the Claude Design
project ("Chrome Theme.dc.html"); the manifests and colour map are the design's.
