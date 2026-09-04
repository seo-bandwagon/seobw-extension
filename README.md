# SEO Bandwagon Chrome Extension

Instant on-page SEO analysis, local-SEO citation checks, and link-building review, in one toolbar icon. Works fully offline; connect an SEO Bandwagon account to sync captures, check citations, and manage outreach without leaving the page.

## What it does

- **SEO Analysis** — score ring (0–100, A–F grade) with four sub-scores (Meta, Content, Links, Tech), page meta with a SERP preview, Core Web Vitals (LCP/INP/CLS/FCP/TTFB), heading structure, link and image audit with on-page highlighting, content stats and n-grams, tech stack detection, and a domain-history strip showing this domain's and URL's past captures.
- **Citations** — detects 40 curated local-SEO directories on the current page, extracts the page's NAP (JSON-LD → microdata → heuristic) and scores it against your business record, captures a proof screenshot, and files the citation to your account in one click.
- **Link Building** — side panel view of your outlets (qualified prospects), pitches (draft/approved), and results (placements, funnel, spend), plus "Add current tab as outlet."

## Installation

### From the Chrome Web Store

Search "SEO Bandwagon" in the Chrome Web Store, or use the one-click "Connect Chrome extension" button on [seobandwagon.com/dashboard/api-keys](https://seobandwagon.com/dashboard/api-keys) once it's installed.

### Load unpacked (development)

1. Clone this repo
2. Open Chrome → `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" → select this folder
5. Pin the extension to your toolbar

## Connect your account

Citations, Link Building, domain history, and capture sync all need an API key.

- **One-click**: visit [seobandwagon.com/dashboard/api-keys](https://seobandwagon.com/dashboard/api-keys) with the extension installed and click "Connect Chrome extension." The site messages the extension directly (`externally_connectable`) and saves the key for you.
- **Manual**: mint a key on the same page, then paste it into the extension's Options page and click Verify.

A key carries scopes (what it's allowed to do) set when it was created; Options shows the connected account, key name, and scopes once verified.

## Permissions, and why

| Permission | Why |
|---|---|
| `activeTab` | Read the current tab's URL/title when you click the icon or a keyboard shortcut — no access to tabs you haven't interacted with |
| `storage` | Save captures locally, cache API responses, and store your API key/settings |
| `contextMenus` | The right-click "Analyze this page" / "Analyze linked page" / "Count words & characters" entries |
| `scripting` | Inject the page-analysis script into the active tab on demand |
| `sidePanel` | The Link Building and Citations side panel |
| `tabs` | Read the active tab's URL to match it against citation directories and open dashboard links in new tabs |
| `alarms` | The 15-minute background retry drainer for captures that failed to sync |
| `host_permissions: https://seobandwagon.com/*` | Talk to the SEO Bandwagon API |
| `optional_host_permissions: http://localhost/*, http://127.0.0.1/*` | Only requested if you point the Advanced API URL setting at a local dev server; never requested otherwise |

There is no `identity` permission and no OAuth — connecting an account is just an API key.

## Privacy

Page analysis runs entirely in your browser. Nothing is sent anywhere unless an API key is set in Options.

With a key set, a capture sends: the page URL, extracted metadata (title, description, word/char/sentence counts, readability, top words/phrases), the extension version, and your browser's user agent. Screenshots captured for citation proof stay on your device — they are never uploaded (see `preview/DESIGN-GAPS.md` for the full-page-capture roadmap). Citation checks send the NAP fields extracted from the current page plus your business ID.

Nothing is sent without a key configured, and the data-collection toggle in Options/the popup footer can disable capture sync entirely while keeping local-only analysis working.

## Local-first + sync/retry behaviour

Every analyzed page saves to `chrome.storage.local` immediately — no network required. When an API key is configured:

- A new capture posts to `POST /api/v1/captures` right after it's saved.
- A failed post (network error, 5xx, or a `503` from the server) is marked `pending` and retried with exponential backoff (15 min → 6 hr cap, 5 attempts) by a `chrome.alarms`-driven drainer that runs every 15 minutes.
- A `429` doesn't burn a retry attempt — it just waits until the server's `Retry-After` window.
- A `401`/`403` marks the capture `skipped` rather than retrying forever against a bad key.
- After 5 failed attempts a capture is marked `failed` and stops auto-retrying; the History page's "Retry failed" button resets it back to `pending` and drains again.
- The History page's "Sync to SEO Bandwagon" button runs a bounded manual drain (up to 60 captures) across your full local backlog.

## Files

```
manifest.json           # Extension config (Manifest V3)
lib/                     # Shared pure modules (content-analysis, dom-extraction) injected before analyzer.js
src/
  background/            # Service worker: context menus, badge, capture-sync alarm, external connect handler
  content/                # Page analyzer + GSC Search Console helper
  history/                # Capture history page (search, export, sync, retry)
  lib/                    # api.js (SBW client), sync-state.js, domain-history.js, citations-ui.js,
                           # link-building-ui.js, nap-compare.js, directory-matcher.js, options-logic.js
  options/                # Settings page (API key, Advanced endpoint, dashboard links)
  overlay/                # SERP overlay (written, not yet wired into manifest — see ROADMAP)
  popup/                  # Popup UI: SEO Analysis tab + Citations tab
  sidepanel/              # Side panel: Citations mode + Link Building mode
  styles/                 # popup.css (shared across popup/side panel/history/options)
  icons/
```

## Development

```bash
# Clone
git clone git@github.com:seo-bandwagon/seo-bw-extension.git
cd seo-bw-extension

# Install dev deps (test harness)
npm install

# Run the automated suite
npm test                 # vitest — unit + integration, ~1s
npm run test:e2e         # Playwright canary against production, ~15s

# Make changes, then reload in chrome://extensions/
```

## Testing

Three layers of automated test cover this extension, plus a manual dev harness:

| Layer | Runner | Where | When |
|---|---|---|---|
| Unit | vitest + JSDOM | `tests/unit/` | Every PR + push |
| Integration | vitest + JSDOM + fixture HTML | `tests/integration/` | Every PR + push |
| E2E canary | Playwright + real Chromium + real prod | `tests/e2e/` | Weekly cron + push to main |

CI workflows in `.github/workflows/`. The weekly canary auto-creates a GitHub issue on scheduled failure.

**Manual preview harness** — `preview/index.html` renders every popup/side-panel UI state against the real render code with stubbed APIs (`preview/stub.js`); `preview/verify.html` asserts all of them plus shell-drift checks against the real `src/` HTML. Open both directly in a browser (no build, no server) after any UI change. This harness is not run by Playwright or CI — it's a dev-only visual/DOM check you run and read yourself.

Before every Chrome Web Store submission, also walk through [MANUAL_SMOKE_TEST.md](./MANUAL_SMOKE_TEST.md) end-to-end (~10 min). It covers UI regressions, keyboard shortcuts, offline behaviour, and edge-case pages that the automated suite can't reach.

## Releasing

```bash
npm run zip   # manifest.json lib/ src/ README.md ROADMAP.md → seo-bw-extension.zip
```

Bump `version` and `version_name` in `manifest.json` first (see `ROADMAP.md`'s versioning policy). Unzip and inspect the listing before uploading to the Chrome Web Store — it should contain `manifest.json`, `lib/`, `src/`, `README.md`, `ROADMAP.md` and nothing else (no `preview/`, `tests/`, `node_modules/`, or internal docs).

## API contract

The full request/response contract for every endpoint this extension calls lives in the site repo: `docs/API.md` on seobandwagon.com.

## License

Private - SEO Bandwagon internal tool
