# API inventory — Phase 0

> Written 2026-09-08 against extension `main` (a4b2c60) and site `main`.

Every endpoint the extension can reach, what calls it today, what the themed
surfaces would want from it, and what each one returns. Phase 0 of the
themed-surface API wiring: **no feature code has been written**, and the
themed surfaces are **not yet in this repo** — see "Preconditions" below.

## How the shapes were derived

From the site's route handlers in `/Users/kylealm/Projects/SEOBW-home/src/app/api/`
— the literal object each handler passes to `NextResponse.json(...)`, plus its
Zod schema — **not** from live calls. No production key was used and no request
was sent. Where a shape below matters for rendering, confirm it against a real
response before Phase 1 depends on a field. Rows are marked accordingly.

## Preconditions — what the wiring prompt assumes and what is actually here

| Assumed | Reality |
|---|---|
| `extension/newtab/`, `extension/popup/`, `extension/sidepanel/` themed skins | **Absent.** They exist only in the design package at `/Users/kylealm/Projects/seo-bw-extension-design/SEO Bandwagon Chrome Theme/extension/`. |
| `extension/sbw-data.js`, `extension/theme-sync.js`, `extension/vendor/` | **Absent**, same place. |
| `src/lib/api.js`, `src/lib/sync-state.js`, `src/lib/domain-history.js` | Present, but at **`extension/src/lib/`** since the folder move (#14). The design's own `<script src="../src/lib/...">` paths already assume this layout and resolve correctly. |
| `management` permission and `chrome_url_overrides.newtab` are agreed | **Ruled out by the owner on 2026-09-07** when the theme scope was chosen. `extension/manifest.snippet.json` in the design still marks `management` "SHIPPING". |
| `MANUAL_SMOKE_TEST.md`, `tests/e2e/canary.spec.mjs`, `tests/unit/api.test.js` | All present. |

Everything the design's data bridge depends on inside this repo **does** exist:
all six service-worker message actions (`getLocalCaptures`, `getCachedAnalysis`,
`storeAnalysis`, `updateBadge`, `checkDirectory`, `openSidePanel`) are handled,
and all six `ANALYZER_FILES` injection paths resolve.

## The one HTTP layer

`extension/src/lib/api.js` (`globalThis.SBW`) is the only file in the extension
that calls `fetch`. `sbwFetch(path, {method, body, query, timeoutMs=15000})`
returns `{ ok, status, data, retryAfter, code }` and never throws. Its codes are
the vocabulary everything else reuses:

| Code | Trigger | Side effect |
|---|---|---|
| `ok` | 2xx | with a key, sets `chrome.storage.local.sbwKeyStatus = 'valid'` |
| `no_key` | wrapper short-circuits **before** fetch | none — no request is sent |
| `unauthorized` | 401 | sets `sbwKeyStatus = 'invalid'` |
| `forbidden` | 403 | none |
| `conflict` | 409 | body preserved |
| `rate_limited` | 429 | `retryAfter` = `Retry-After` header, else 60 |
| `unavailable` | 503 | none |
| `network` | fetch threw, aborted at 15s, or settings unreadable | none |
| `error` | any other non-2xx | none |

Base URL comes from `getApiSettings()`, which honours the options page's
localhost override. `isDataCollectionEnabled()` reads `dataCollection` and
defaults to **true** when unset.

### The invariant, stated accurately

"No `fetch(` outside `src/lib/api.js`" is **already false** and should not be
used as a merge gate as written. `extension/src/background/service-worker.js`
calls `fetch` twice, at lines 427 and 852, for the link checker and the raw-HTML
probe. Those are **third-party** requests, sent with `credentials: 'omit'`, and
they are the reason the optional `<all_urls>` grant exists.

The invariant that is true today, and the one worth enforcing:

> The only calls to **seobandwagon.com** come from `extension/src/lib/api.js`.
> Third-party probes go through the service worker. No content script or page
> calls `fetch` at all.

`serp-overlay.js`, `redirect-chain.js` and `render-check.js` name `fetch` only
in comments explaining why they route through the worker instead. Any themed
surface must follow the same rule: page → `sbw-data.js` → `SBW` → network.

## Endpoint table

`Auth` column: **key** = an `sbw_` key works; **session** = cookie only.
`Called today` names the wrapper in `api.js` and its caller.

### Account and captures

| Path | Method | Auth | Called today | Themed surface wants it | Response shape | Limit |
|---|---|---|---|---|---|---|
| `/v1/me` | GET | **key only** — a session cookie is rejected | `verifyKey()` → options page, popup citations tab, side panel | all three, for the account badge | `{userId, email, name\|null, plan:'free'\|'pro'\|'enterprise', key:{id,name,createdAt,lastUsedAt}, scopes[], capabilities[]}` · `Cache-Control: no-store` | `v1:me` 60/h |
| `/v1/captures` | POST | key or session, scope `captures` | `postCapture()` via `syncCapture()`/`drainPendingCaptures()` | new tab, indirectly through the drain | 201 `{id, url, createdAt}` | `captures:write` 120/h |
| `/v1/captures?url=` | GET | key or session, scope `captures` | `capturesForUrl()` → `domainHistory()` | popup + new tab history line | `{url, domain, totalCaptures, captures:[…≤50 own rows]}` | `captures:read` 60/h |
| `/v1/keys` | GET / POST / DELETE | **session only** — a key is rejected | not called | not wanted; the dashboard mints keys | GET `{keys:[{id,name,scopes,createdAt,lastUsedAt}]}` | POST `v1:keys:create` 20/h |

`POST /v1/captures` returns **409** `{error:"Duplicate — same URL captured within the last hour"}` per owner, per URL. `syncCapture` already treats that as a terminal success (`duplicate`), not a failure.

### Domain stats

| Path | Method | Auth | Called today | Themed surface wants it | Response shape | Limit |
|---|---|---|---|---|---|---|
| `/domain/:domain/quick` | GET | key or session, scope `captures` | `quickDomain()` → `domainHistory()` | popup history line | `{domain, avgWordCount, schemaPercentage, avgScore, age, sampleSize}` — **no data is a 200 with `sampleSize: 0`, never a 404** | none |
| `/domain/quick-batch` | POST | key or session, scope `captures` | `quickBatch()` — **wrapper exists, nothing calls it** | **new tab**, one request per painted list | `{results: {[domain]: QuickStats}, invalid: string[]}` · `Cache-Control: private, max-age=300` | `quick:batch` 120/h |

`quick-batch` accepts **1–20 domains**; more is a 400. This is the batched
lookup the new tab's recent-captures list needs, and it already exists on the
site — nothing to build server-side.

### Extension dashboard

| Path | Method | Auth | Called today | Themed surface wants it | Response shape | Limit |
|---|---|---|---|---|---|---|
| `/extension/dashboard` | GET | key or session, scope `captures` | **nothing — `unused`** | possible new-tab source; local captures are preferred | `{analyses: [full rows, ≤50, own only]}` | **none** |
| `/extension/stats` | GET | key or session, scope `captures` | **nothing — `unused`** | possible new-tab totals | `{totalAnalyses, avgScore, uniqueDomains, topDomains:[{domain,count,avgScore}]}` | **none** |

Both are unthrottled and both are candidates, but neither is required: the
design's new tab treats **local captures as the source of truth** and enriches
from `quick-batch`. Calling `/extension/dashboard` as well would fetch the same
records twice over the wire.

### Citations — every route gates on scope `citations`, key or session

| Path | Methods | Called today | Response shape |
|---|---|---|---|
| `/citations/businesses` | GET, POST | `ct.businesses()`, popup tab + side panel | `{data: rows[]}` |
| `/citations/businesses/:id` | GET, PATCH, DELETE | `ct.business()` | `{data: row}`; DELETE `{success:true}` |
| `/citations/businesses/:id/stats` | GET | `ct.stats()` | `{data:{total_citations, active_citations, inconsistent_citations, missing_citations, avg_nap_score, last_campaign_at}}` |
| `/citations/businesses/:id/citations` | GET, POST | `ct.citations()`, `ct.createCitation()` | GET `{data: rows[]}`; POST `{data: row, created: boolean}` — 201 new, 200 existing |
| `/citations/businesses/:id/campaigns` | GET, POST | `ct.campaigns()`, `ct.triggerCampaign()` | `{data: rows[]}` / 201 `{data: campaign}` |
| `/citations/campaigns/:id` | GET | `ct.campaign()` | `{data:{…campaign, steps: row[]}}` |
| `/citations/:id` | GET, PATCH | `ct.updateCitation()` | `{data: row}` |

Citations routes are the **only** group that wraps in `{data: …}`; `api.js`
unwraps them in `unwrapCtData()`. `POST …/citations` is limited at
`citations:write` 120/h; every citations **read** is unthrottled.

**Campaign POST runs `runCitationCampaign` synchronously** and returns 201 even
when the engine fails, with the failed row as its body. Treat a 201 as "the
campaign was recorded", not "the campaign succeeded", and read `status`.

### Link building — scope `link-building:read` or `:write`, key or session

| Path | Method | Called today | Response shape |
|---|---|---|---|
| `/link-building/prospects` | GET | `lb.prospects()`, side panel | `{prospects: rows[], counts:[{status,n}]}` |
| `/link-building/prospects` | POST | `lb.addOutlet()` | 201 `{id,domain,status,created:true}` / **200** `{…created:false}` when it already exists |
| `/link-building/prospects/review` | POST | `lb.reviewProspects()` | `{action, requested, updated}` |
| `/link-building/pitches` | GET | `lb.pitches()` | `{pitches: rows[], counts[], senderAddress, postalAddress}` |
| `/link-building/pitches/review` | POST | `lb.reviewPitch()` | `{action,id,status}`; **409** `{error:"standing checks failed", failures[]}`; 400 with `offenders[]` when an edited body adds numbers |
| `/link-building/pitches/dispatch` | POST | `lb.markSent()` | `{id,status:'sent'}`; **409** `{error:"send gates failed", failures[]}` |
| `/link-building/results` | GET | `lb.results()` | `{funnel:{…14 counts}, spend:{totalUsd}, placements[], sends[]}` |
| `/link-building/sender` | POST | **nothing — `unused`** | `{ok:true, senderAddress, postalAddress}` |

Only `POST /prospects` is limited (`link:prospects:write` 60/h). Every
link-building read is unthrottled.

### Nothing is MISSING

No themed-surface requirement in the wiring prompt needs a backend route that
does not exist. `quick-batch` — the one that looked most likely — is live.

The only other key-authenticated route on the site is `/api/mcp`, gated on the
`mcp` scope, which `EXTENSION_SCOPES` deliberately excludes. Not a candidate.

## Scopes

`api_keys.scopes` exists (`src/lib/db/schema.ts`, default `{legacy:all}`).
Vocabulary: `captures`, `citations`, `link-building:read`,
`link-building:write`, `score`, `keywords`, `mcp`. A key minted for the
extension gets everything but `mcp`; a session passes every scope check.

A key missing a scope returns **403** `{error:"insufficient_scope", required:<scope>}`,
which `sbwFetch` maps to `forbidden`. **The themed surfaces must handle
`forbidden` distinctly from `unauthorized`** — the key is valid, the permission
is not, and telling the user to reconnect would be wrong advice. This is a
seventh state the wiring prompt's six-state matrix omits.

## State matrix

What each surface shows for each outcome. `—` means the surface never reaches
that state. Nothing here is implemented yet; this is the contract Phase 1 builds
against.

| State | New tab | Popup skin | Side panel |
|---|---|---|---|
| `ok` | local captures, enriched with batch stats | score, groups, issues, tools | citations + directory match |
| `no_key` | "Connect your account" badge, link to options; local captures still listed in full | same badge; analysis unaffected | "Connect your account"; directory match still works, it is local |
| `unauthorized` | "Your key was rejected — reconnect", link to options | same | same |
| `forbidden` | "This key can't read captures" + which scope, link to the dashboard's key page | same | same |
| `rate_limited` | keep the last painted values, label them as of their timestamp, say "retrying in Xm" from `Retry-After` | same | same |
| `unavailable` | local captures only, "Account data unavailable" | same | same |
| `network` | identical to `unavailable`, worded "offline" | same | same |
| collection off | local captures only, "Syncing is off" + link to the setting; **no request is sent** | same | same |

Rules these obey: never a spinner that cannot end; never an empty panel; never a
stale number presented as live; every surface renders completely with the API
unreachable, because local captures are the source of truth for the list and the
API only enriches it.

## Caching already in place

- `chrome.storage.session` via `SBWDomainHistory.cacheKey` / `isFresh` — the
  pattern the batched lookup must reuse. One request per painted list, never one
  per row.
- `sbwUser` in `chrome.storage.local`, a 10-minute TTL cache of `/v1/me`, checked
  with `SBWCitations.isUserCacheFresh`. `accountState()` should read this rather
  than verifying on every paint; an opt-in verify with a cooldown is the Phase 1
  item.
- `quick-batch` responses carry `Cache-Control: private, max-age=300`.

## Storage keys — no new ones needed

All four keys the prompt names already exist and are already written:
`capture_<ts>` (captures), `bwThemeMode` (appearance, written by
`extension/src/lib/theme-mode.js`), and `sbwUser` / `sbwKeyStatus` /
`dataCollection` (account, written by the options page, the popup citations tab
and the side panel).

## Two collisions to resolve before Phase 1

1. **Two theme systems.** The design's `theme-sync.js` and the shipped
   `extension/src/lib/theme-mode.js` both own `bwThemeMode`, so they agree on
   storage but duplicate the logic. `theme-mode.js` ships today, has the
   localStorage mirror for a correct first paint, and needs no permission.
   `theme-sync.js` adds only `installedThemeMode()`, which requires
   `management`. Recommendation: keep `theme-mode.js`, and if the themed pages
   want ES-module imports, make `theme-sync.js` a thin re-export of it.
2. **Two token systems.** `vendor/bandwagon.css` and
   `extension/src/styles/popup.css` share `--pink`, `--navy`, `--white`,
   `--font-*`, `--radius-*`, `--surface`, `--text-strong`, `--accent-text` and
   the status colours, but diverge elsewhere: the design has `--text`,
   `--text-muted`, `--surface-raised`, `--on-pink`, `--viz-*`, `--space-*`; the
   shipped sheet has `--ink`, `--paper-*`, `--on-status`, `--surface-1/2/3`,
   `--hairline`, and the `--ink-rgb`/`--surface-rgb` pair that drives every
   alpha. One sheet has to become the source of truth.

Separately, `vendor/fonts.css` points at `fonts/space-grotesk-400.woff2` and
`fonts/space-grotesk-700.woff2`, and the design package ships **no font files**.
The repo already bundles the faces at `extension/src/styles/fonts/`, where
Space Grotesk is a single variable file covering 400–700. As written,
`vendor/fonts.css` would 404 on every face.
