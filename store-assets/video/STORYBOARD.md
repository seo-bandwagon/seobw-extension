# Demo video — storyboard and script (draft 1, 2026-10-13)

A narrated walkthrough of the SEO Bandwagon extension as it ships in 1.7.7.
Owner records the voiceover; the screen footage is captured from the real build
on real pages, then cut to the voice and captioned.

## Where it goes

- **Chrome Web Store** listing: the promo video field takes a YouTube URL
  (unlisted is fine; public helps discovery).
- **Website** `/seo-chrome-extension`: either replaces the 28.8 s Arcade tour
  (keepkalm/platform `src/lib/marketing/extension-video.ts`, which holds its
  transcript and captions) or sits beside it as the "full tour". Owner's call.
- Later: Product Hunt, social cut-downs (scenes are self-contained so a
  15–20 s vertical cut can reuse them).

## Spec

| | |
|---|---|
| Length | about 75 s (store and site viewers drop off after a minute or so; every scene can be trimmed) |
| Picture | 1920×1080, 30 fps, H.264 High, `+faststart`, the website's existing encode settings (CRF 22) |
| Sound | Owner's voiceover, mono or stereo, AAC 128k; no music in draft 1 (optional low bed later) |
| Captions | WebVTT from the script below, timed to the recorded voice, as the website tour does |
| Appearance | Night, signed out (except scene 7) |
| Build | The store build of the day (1.7.7), unpacked, nothing staged or mocked |

## Rules for every frame and line

Same rules as the store listing and screenshots (`docs/CWS-LISTING.md` §2,
`CHROMEWEBSTORE.md` Screenshot Notes, platform `brand-copy.test.ts`):
- No competitor names or logos in frame (pick neutral Google searches and pages).
- No ranking, speed, accuracy or "best" claims; no prices or user counts.
- The extension finds **issues**; never say it **fixes** anything.
- Only features that ship in the build being shown.
- Real pages: our own (seobandwagon.com) for the on-page scenes, so no third
  party's site is shown failing a check.

## Scenes

Timings are targets for a calm read (~2.4 words a second); the cut follows the
recorded voice.

| # | Time | On screen (capture) | Caption (lower third) | Voiceover |
|---|---|---|---|---|
| 1 | 0:00–0:05 | Title card on the brand frame (as in `store-assets/1.7.7` tiles), the seobandwagon.com page dimmed behind | SEO BANDWAGON · ON-PAGE SEO IN ONE CLICK | Every page has something holding it back. Here's how to find it in one click. |
| 2 | 0:05–0:16 | A seobandwagon.com page; cursor clicks the toolbar icon; popup opens on the score; scroll the issues; open HEADINGS and click "Highlight headings" so they're marked on the page | Score, issues and every check behind them | Click the SEO Bandwagon icon and you get a score, the issues it found, and every check behind them: headings, links, images, speed and more. |
| 3 | 0:16–0:27 | Same page; LINK CHECK → "Check N links" → counts climb → "Highlight broken on page" shows the broken link outlined on the page; click away (popup closes), reopen: results still there | Every link checked. Keeps going if you close the popup | Check every link on the page. Broken ones light up where they sit, and the check keeps running even if you close the popup. |
| 4 | 0:27–0:37 | INDEXABILITY verdict and redirect chain (http:// address), then RENDERING "Compare raw HTML with rendered DOM" summary | Indexable? Redirects? What scripts changed? | See whether search engines may index a page, the redirects that led there, and what changed after scripts ran. |
| 5 | 0:37–0:45 | STRUCTURED DATA: items listed by type, "Eligible for" line, one item's properties | Structured data, checked by type | Structured data is checked against what each type needs, so you know which rich results a page qualifies for. |
| 6 | 0:45–0:57 | Google results (neutral query, e.g. "best crm for nonprofits", signed out): bars under results; scroll to the toolbar; Copy results → paste into a blank spreadsheet; Copy PAA → paste the questions | On Google itself: copy or export the results | On Google itself, each result gets a bar, and one click copies the results or the People Also Ask questions, or exports them to a spreadsheet. |
| 7 | 0:57–1:07 | **Needs the test account and a test business.** A directory listing for the test business; Citations tab: NAP match score; SCREENSHOT runs the full-page proof; the finished proof card | Local citations, with full-page proof | With a free account, check a business listing against your own details, and save a full-page screenshot as proof. |
| 8 | 1:07–1:13 | Popup footer / options page with the "Help improve SEO insights" box; then back to the score | Free. No account needed for the checks | No account is needed for the checks, and signed out, nothing is sent. |
| 9 | 1:13–1:18 | End card: logo, "Free on the Chrome Web Store", seobandwagon.com/seo-chrome-extension | FREE ON THE CHROME WEB STORE | SEO Bandwagon. Free on the Chrome Web Store. |

### Voiceover script (for recording)

Read at a relaxed pace; leave a beat between scenes (the cut absorbs it).
168 words, about 70 s of speech at 2.4 words a second.

> 1. Every page has something holding it back. Here's how to find it in one click.
>
> 2. Click the SEO Bandwagon icon and you get a score, the issues it found, and every check behind them: headings, links, images, speed and more.
>
> 3. Check every link on the page. Broken ones light up where they sit, and the check keeps running even if you close the popup.
>
> 4. See whether search engines may index a page, the redirects that led there, and what changed after scripts ran.
>
> 5. Structured data is checked against what each type needs, so you know which rich results a page qualifies for.
>
> 6. On Google itself, each result gets a bar, and one click copies the results or the People Also Ask questions, or exports them to a spreadsheet.
>
> 7. With a free account, check a business listing against your own details, and save a full-page screenshot as proof.
>
> 8. No account is needed for the checks, and signed out, nothing is sent.
>
> 9. SEO Bandwagon. Free on the Chrome Web Store.

Recording tips: one take per numbered line (easier to re-time), a quiet room,
the same mic as the existing tour so the two can sit on one page. Name files
`vo-01.wav` … `vo-09.wav`.

## How the footage is made

- **Real browser window, recorded.** A headed Chromium with the unpacked
  build, alone on its own Hyprland workspace at 1920×1200 physical pixels,
  recorded with `gpu-screen-recorder` (window capture) and cropped to
  1920×1080. This shows Chrome's own toolbar and the real popup, unlike a
  headless capture. Scenes are driven by a script (the agent harness's CDP
  control, no synthetic keystrokes into other windows), so each take is
  repeatable; the cursor is drawn in edit (`ffmpeg` overlay) where a real one
  would sit.
- **Rough cut (silent, scenes 1–6, 8, 9): headless capture instead.** So the
  rough cut could be shot without taking over the owner's screen,
  `capture/record.mjs` drives the real build in headless Chromium at 1.5×
  device scale and records the page and the real action popup as timestamped
  CDP screencast frames, plus a log of clicks, addresses and popup open/close.
  `capture/build.mjs` resamples the frames to 30 fps, draws a browser toolbar
  (tab, address, the extension icon) above the page, places the popup under
  the icon, marks clicks with a ring, adds the caption and the voiceover line
  as a subtitle, fits each scene to its slot and renders the cards. Scene 6
  pastes into `capture/sheet.html`, a local blank sheet; the final cut uses a
  real spreadsheet. Scene 7 waits for the test account. The final cut can
  switch to the real-window recording above, with the owner present.
  ```bash
  # from a directory where puppeteer-core resolves (the harness)
  OUT=/tmp/shoot EXT=/path/to/unpacked-build node record.mjs [s2-analysis ...]
  SHOOT=/tmp/shoot OUT=/tmp/cut REPO=/path/to/seobw-extension node build.mjs
  ```
- **Cards** (scenes 1 and 9) use the `store-assets/1.7.7/capture/compose.mjs`
  frame and fonts, rendered at 1920×1080.
- **Edit**: `ffmpeg` concat of scene clips, each trimmed to its voice line;
  lower-thirds burned in from the captions above; WebVTT exported for the site
  and YouTube.
- Sources and the edit script will live in `store-assets/video/` with this
  file; the rendered MP4 goes to the YouTube channel and (if chosen) the
  website, not into this repo (size).

## Dependencies and open decisions

- **Scene 7** needs the test account key (`~/Work/sbw-extension-testing/.sbw-test-key`)
  and a test business with a directory listing among the 40 the Citations tab
  recognizes. Without them, cut scene 7 (the video still runs about 65 s).
- **Scene 3's broken link**: the product page's real 404
  (`nicklaunches.com/products/seo-chrome-extension/`) shows the highlight well;
  if it is fixed on the site first, use another of our pages with an outbound
  dead link, or keep the 404 for the shoot.
- **Spreadsheet in scene 6**: a blank Google Sheet in the recording profile, or
  LibreOffice Calc; no personal account visible.
- **Website**: replace the 28.8 s tour, or add this as the full tour.
- **Music**: none in draft 1.
- **YouTube**: which channel; public or unlisted.
