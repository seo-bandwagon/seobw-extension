# v1.3.0 — Google SERP Overlay

**Status:** design approved 2026-04-24, pending implementation plan.

## Context

The extension is currently click-to-activate: users install it but only see value when they deliberately open the popup on a page they want to audit. That's a missed adoption opportunity. SEO users spend most of their working time on Google SERPs doing competitive research, keyword exploration, and ranking checks. An always-on overlay that adds SEO context inline on every Google result turns the extension from a tool you remember to open into a tool that earns its install-slot every time you search.

This spec covers the first batch of daily-use features, built around one killer surface: Google search result overlays.

## Goals

- Increase daily active use of the extension by putting it on screen every time a user googles
- Leverage the public-facing aggregate data already collected via `/api/v1/captures` — captures from every user contribute to the shared dataset that powers the badges
- Establish the tier-aware data-visibility model so paid-tier differentiation can ship later without touching this code

## Non-goals (explicit YAGNI)

- Google Images / News / Shopping SERPs — v1.3 targets web results only
- Localised Google TLDs (`.co.uk`, `.de`, etc.) — v1.3 is `www.google.com` only
- DataForSEO premium metrics on badges — costs scale with SERP impressions, defer until paid tier demands it
- Proactive background-analysis of unseen domains — wait for real usage signal
- Bulk / queue workflows, popup competitor compare, highlight mode — separate future features

## Scope

### In scope for v1.3.0

1. Content script on `*://www.google.com/search*` that injects a badge row under each organic search result
2. Badge content: domain age (WHOIS-cached), aggregate capture stats when data exists (avg score, schema %, sample size), and an `Analyze →` button
3. Backend batch endpoint `POST /api/domain-info/batch` so one SERP render = one API round trip
4. Keyboard shortcut `Cmd/Ctrl+Shift+O` to hide/show overlay on current tab
5. Options page rewrite: remove dead `apiUrl` field, add informational privacy banner that reflects current tier
6. Tier-aware capture visibility: `/api/v1/captures` accepts `Authorization: Bearer <apiKey>` header and tags rows `visibility: 'public' | 'private'`
7. `domain_info/batch` and `domain_stats` aggregation exclude private captures
8. GA4 Measurement Protocol telemetry from the service worker — errors, renders, captures, version ping

### Out of scope

As listed under non-goals plus: dark-mode SERP variant, inline expansion of the badge, web-worker offload, RUM / session replay, privacy policy page rewrite (light copy update only).

## User experience

### Badge placement

Immediately under each organic result's URL line (the breadcrumb row that shows `example.com › category › page`). One thin horizontal strip, reserved height injected before data arrives so there is **zero cumulative layout shift**. Brand-accent on the `Analyze →` button (`#F53796`).

### Badge content — three states

| State | Trigger | Display |
|---|---|---|
| Known domain | ≥1 public capture exists for the domain | `⧗ 14y 3m · ★ 78 · schema 90% · n=142 · [Analyze →]` |
| Unknown domain | Age known, 0 public captures | `⧗ 14y 3m · [Analyze →]` |
| Age unknown | RDAP lookup failed / privacy registration | `[Analyze →]` |

No `N/A` placeholders — hide the data point instead of showing noise.

### Interactions

- Click `Analyze →` — opens the extension popup in a new window, pre-loaded with the result URL. Reuses existing popup code paths.
- Click the stats region (known domains only) — deep-link to `https://seobandwagon.com/captures?url=<url>`.
- Hover the age chip — tooltip shows "Registered 2011-03-15 · GoDaddy" from cached WHOIS data.
- Global `Cmd/Ctrl+Shift+O` — hides or shows the overlay on the current tab. State persisted per tab in `chrome.storage.session`.

## Technical architecture

### Files

```
seo-bw-extension/
├── manifest.json                      # register content script + commands
├── background.js                      # service worker: API gateway + telemetry
├── serp-overlay.js                    # REPLACED — observer loop, tab state
├── serp-overlay.css                   # badge styles (light theme only)
├── lib/
│   ├── serp-parser.js                 # NEW — extract result rows from Google DOM
│   ├── overlay-renderer.js            # NEW — build + inject badge DOM
│   ├── domain-info-client.js          # NEW — talk to background worker
│   └── telemetry-client.js            # NEW — GA4 MP wrapper
├── popup.js                           # MODIFIED — send Authorization header if apiKey set
├── options.html                       # MODIFIED — remove apiUrl, add privacy banner
└── options.js                         # MODIFIED — informational banner only
```

### Manifest changes

- `content_scripts` gains `[{ matches: ["*://www.google.com/search*"], js: ["lib/serp-parser.js","lib/overlay-renderer.js","lib/domain-info-client.js","serp-overlay.js"], css: ["serp-overlay.css"], run_at: "document_idle" }]`
- `commands` gains `toggle-overlay` with default binding `Cmd/Ctrl+Shift+O`
- `permissions`: no change
- `host_permissions`: unchanged — existing `https://seobandwagon.com/api/*` covers the new batch endpoint

### Data flow

```
Google SERP loads
  └─► MutationObserver on <div id="search">
      └─► serp-parser.js extracts [{ rowElement, url, domain }, …]
          └─► overlay-renderer.js inserts placeholder badges (reserves height)
              └─► domain-info-client.js sends BATCH_DOMAIN_INFO message
                  └─► background.js checks caches (L1→L2→L3)
                      └─► POST /api/domain-info/batch for uncached domains
                          └─► response merged into caches
                              └─► service worker replies to content script
                                  └─► overlay-renderer.js fills badges
```

### Backend endpoint

**`POST /api/domain-info/batch`** — public, no auth required.

Request: `{ "domains": ["example.com", "other.org", …] }` — max 20 entries.

Response: `{ "example.com": { "age": "14y 3m", "registrar": "GoDaddy", "captureStats": { "avgScore": 78, "schemaPercentage": 90, "sampleSize": 142 } | null }, … }`

Implementation: one `SELECT` from `whois_cache` (filtered by domain list, non-expired), one `SELECT` from `domain_stats` (same list, `WHERE visibility = 'public'`), merged in memory. Any domains missing from `whois_cache` trigger background RDAP fetches on the server side, but the API response does not wait on them — they will be available on the next batch call.

### Tier-aware capture visibility

- `extension_analyses` gains two new columns: `visibility text NOT NULL DEFAULT 'public'` (values: `'public'` | `'private'`) and `user_id uuid NULL REFERENCES users(id)` (nullable — only set for private paid-tier captures). Generated Drizzle migration covers both.
- `domain_stats` rolling-average UPSERT in `/api/v1/captures` only updates when `visibility = 'public'`.
- `/api/v1/captures` POST: if a valid `Authorization: Bearer <apiKey>` header is present, look up the owning `user_id` from the `api_keys` table (introduced by the paid-tier feature — not in this spec), insert the capture with `visibility = 'private'` and a `user_id` foreign key. If header is absent or invalid (no matching key), insert with `visibility = 'public'` and `user_id = null`.
- For v1.3.0 ship: the backend does not yet validate API keys (paid tier isn't live). Any non-empty `Authorization` header will still insert `visibility = 'public'` because no account matches. When paid-tier validation lands, existing hook automatically flips to `'private'` for valid keys.

### Privacy model

Data collection is tier-independent: every capture and every GA event is collected and stored. Tier determines only whether a user's contributions are aggregated into the shared public dataset.

| | Capture collected? | Appears in public aggregate? | Usage event collected? | Appears in shared dashboards? |
|---|---|---|---|---|
| Free (no apiKey) | Yes | Yes | Yes | Yes |
| Paid (apiKey set) | Yes | No | Yes | No |

This is enforced at the backend by the `visibility` column and a GA custom dimension `tier: 'free' | 'paid'` that dashboards filter on.

### Options page — no checkboxes

The privacy section becomes an informational banner only. Current tier is inferred from presence of `apiKey` in `chrome.storage.sync`. Banner text switches between free and paid copy based on that presence.

The dead `apiUrl` field is removed. The `apiKey` field stays and is now load-bearing: its presence determines tier and it is sent as `Authorization: Bearer <apiKey>` on capture POSTs.

## Performance

### Budget

- Zero cumulative layout shift on Google SERPs (badges reserve their height before data arrives)
- No single main-thread task exceeds 50 ms during SERP render (measured via Performance API `longtask` entries)
- Time-to-first-badge under 500 ms after the MutationObserver sees the first result `div.g` appear

### Four-layer cache

1. **L1** — content script `Map<domain, info>`: per-tab, cleared on navigation
2. **L2** — service worker `Map<domain, info>`: cross-tab, cleared when SW idles (~30 s)
3. **L3** — `chrome.storage.session`: TTL 15 min per entry, survives SW restarts, cleared on browser close
4. **L4** — backend `whois_cache` (24 h TTL) + `domain_stats` (always fresh)

### Debounce + batching

- MutationObserver collects results over a 150 ms debounce window, then emits one batch
- Max 20 domains per batch
- One in-flight batch per tab (queue subsequent requests)
- If the tab navigates away while a request is outstanding, the response is discarded (tagged with originating URL)

### Rate limits

- Client: at most 2 batches per 10 s per tab
- Backend `/api/domain-info/batch`: 60 requests per minute per IP. On 429, client respects `Retry-After` and continues rendering age-only badges from L3 cache

## Error handling

**Guiding principle: never break the user's Google search.**

| Failure | Detection | Behavior |
|---|---|---|
| Network offline | `fetch` throws `TypeError` | No badges rendered. `console.debug` once. |
| Backend 500 | 5xx response | No badges. SW caches the 500 for 60 s to avoid hammering. |
| Backend 429 | 429 response | Respect `Retry-After`; continue from L3 cache |
| Backend timeout | 5 s `AbortController` | Treat as no-data; next fresh SERP will retry |
| WHOIS malformed | Missing fields in RDAP response | Render partial badge. Never show all-`N/A`. |
| CORS blocked | Browser-level block | Same as network offline |
| Invalid `apiKey` | 401 on capture POST | Silently fail the POST; local capture still saved. No user notification in v1.3. |
| Google DOM selector fails | `parseResults()` empty after 3 retries / 3 s | Exit silently on this page. `console.debug` once. |
| Google DOM partial fail | Some rows matched, others not | Badge only the matched rows |
| Malformed backend JSON | JSON.parse throws | No badges this batch. Does not poison later batches. |
| SW crashed mid-request | Promise never resolves | 5 s client timeout fires, treat as timeout |
| `chrome.storage.sync` quota | `chrome.runtime.lastError` on set | Silent in-memory fallback |

All logs are `console.debug` only. No `console.error` or `console.warn` in production.

## Telemetry

GA4 Measurement Protocol POSTs from the service worker. Separate GA4 property dedicated to the extension (not the platform's website property) — keeps website funnels clean and scopes the API-secret blast radius.

### Events

| Event | When | Params |
|---|---|---|
| `ext_serp_overlay_error` | Any failure from the table above | `error_type`, `status_code`, `layer` |
| `ext_serp_overlay_render` | Badge row rendered | `badges_count`, `cache_hit_ratio`, `batch_duration_ms` |
| `ext_capture_failed` | `/api/v1/captures` POST fails | `status_code`, `is_paid_tier` |
| `ext_capture_success` | `/api/v1/captures` POST returns 201 | (none) |
| `ext_version_ping` | Once per session on first SW boot | `extension_version`, `chrome_version` |

Every event auto-tags `client_id` (anonymous persistent ID in `chrome.storage.sync`), `engagement_time_msec`, and custom dimension `tier: 'free' | 'paid'`. No URLs, no domain names, no page contents — only aggregate counters and error shapes.

Telemetry client wraps everything in try/catch that swallows silently. Analytics never breaks the extension.

## Testing

### Unit

- `serp-parser.js` — given fixture Google SERP HTML snapshots, returns correct `[{ rowElement, url, domain }]` arrays
- `overlay-renderer.js` — given a mock result row + data, produces the expected DOM structure
- `domain-info-client.js` — cache-hit logic, timeout behavior, dedup across concurrent calls
- `telemetry-client.js` — fire-and-forget, never throws on network failure

Jest or Vitest with JSDOM — pick whichever existing testing pattern fits the repo (extension has no test harness today; introducing one is part of this work).

### Integration / e2e

A weekly GitHub Actions job that runs a Puppeteer script:
1. Loads the unpacked extension with a dummy apiKey unset
2. Navigates to `https://www.google.com/search?q=seobandwagon`
3. Waits for `.seobw-badge` selectors
4. Asserts **≥5 badges rendered** on the page
5. On three consecutive failures, auto-creates a GitHub issue titled "SERP overlay may be broken"

This is the canary for Google silently changing its SERP HTML.

### Manual pre-ship smoke checklist

- Install unpacked. Fresh Chrome profile, no apiKey.
- Search `site:nytimes.com`. Confirm ≥5 badges render with age + analyze button.
- Search a mix of popular and obscure domains. Confirm three-state rendering matches expectation.
- Click `Analyze →` on one result. Popup opens pre-loaded with URL. Capture saves. Verify row appears in Neon `extension_analyses` with `visibility = 'public'`.
- Set a non-empty apiKey in options. Repeat a capture. Verify row still saves (paid-tier validation not live yet; all still public).
- Press `Cmd/Ctrl+Shift+O`. Badges hide. Press again. Badges show.
- Disconnect network. Search. No errors shown in user-visible UI; badges do not render.
- Confirm privacy banner in options page reflects current `apiKey` presence.

## Open items / follow-ups

- **Paid tier backend validation** — out of scope here; extension ships with hooks in place, backend work tracked separately.
- **Dark-mode badge theme** — target v1.4 once users ask.
- **Localized Google TLDs** — target v1.4.
- **Dashboard `/captures?url=<url>` deep-link route** — exists already per platform recon, but verify it supports URL-prefilled analysis. If not, small platform ticket.
- **SERP overlay on Google Images / News / Shopping** — later; different DOM selectors per surface.

## Rollout

1. Backend PR: add `visibility` column + migration, `/api/domain-info/batch` endpoint, update `/api/v1/captures` header handling, update `/api/domain/[domain]/quick` to filter on `visibility = 'public'`.
2. Extension PR: new content script, lib/ files, options page rewrite, popup.js Authorization header, telemetry client. Bump `manifest.json` version to `1.3.0`.
3. Merge backend first; verify production deploy stable for 24 hours.
4. Merge extension; package `.zip` from main; submit to Chrome Web Store.
5. Create new GA4 property, stash `measurement_id` + `api_secret` as constants before packaging.

## Verification

End-to-end after deploy + CWS publish:

- `curl -X POST https://seobandwagon.com/api/domain-info/batch -H 'Content-Type: application/json' -d '{"domains":["google.com","nytimes.com"]}'` returns expected shape with age + captureStats
- Install published v1.3.0 on a fresh Chrome profile; run through manual smoke checklist above
- In GA4 real-time view, verify events flowing with correct `tier` dimension
- Weekly Puppeteer CI job passes on initial run
