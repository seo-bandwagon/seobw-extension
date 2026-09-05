# Design gaps — for the next Claude Design pass

Everything in the approved composition (**1a** shell + **1e** header + **1g** actions + **1j** side panel + states **1k–1n**) is implemented. This is what the mockups either didn't cover, or specified in a way the current backend can't honour.

---

## 1. Mockup features with no backend behind them

### `FIX ON THIS SITE` (1a, NAP result footer)
The mockup's primary action after a drift check. There is no API for editing a third-party listing — that's a manual task on Yelp/BBB/etc.
**Shipped instead:** `FILE THIS CITATION`, which logs the citation with its measured NAP score and `inconsistent` status.
**Needs design:** what the real remediation flow looks like — a copy-to-clipboard "corrected NAP" block? A deep link to the directory's edit page? A task queued for a human?

### `Undo` on the citation-filed alert (1m)
Mockup shows `Filed to Northside Dental · Q3 campaign. Undo`.
There is no citation-delete endpoint, and no concept of filing *into a named campaign* — campaigns are automated discovery runs, not buckets you file into.
**Shipped instead:** success alert without Undo, and copy that says which business it was filed to.
**Needs:** either a delete endpoint + undo affordance, or drop the pattern.

### Full-page capture (1n: `FULL PAGE · 1440×2100`)
`chrome.tabs.captureVisibleTab` only captures the **visible viewport**. Full-page needs scroll-and-stitch, which is a real feature, not a label change.
**Shipped instead:** honest `VIEWPORT · 1280×720 · 214 KB`.
**Needs decision:** build scroll-stitching, or keep viewport capture and design the label around it.

### `ATTACH TO REPORT` (1n)
Wired: it saves the screenshot, then files a citation carrying `screenshot_url`. But the mockup implies attaching to an *existing* report/campaign, which doesn't exist as a concept.
**Needs design:** if "report" is meant to be a persistent document, it needs a data model.

---

## 2. States the mockups didn't cover

These were invented to ship; they should be reviewed.

| State | What ships now |
|---|---|
| **No businesses on the account** | Empty state: "NO BUSINESSES YET" + Open Dashboard button |
| **Backend unreachable** | Empty state: "CAN'T REACH CITATIONFORGE" + Try Again |
| **Untracked site** (1e is directory-only) | Muted header variant: grey surface, `?` mark, hostname at 20px, "Not a tracked directory". 1m's `UNKNOWN SITE` alert only appears when filing. |
| **Side panel, not connected** | "NOT CONNECTED" empty state + Connect button |
| **Side panel, no business selected** | Per-section "PICK A BUSINESS" empty state |
| **Screenshot saved vs. captured** | Two variants of the proof card — chips change from `SAVE TO CITATIONFORGE` to `VIEW` once uploaded |

---

## 3. Side panel: sections 1j left as placeholder rows

1j only detailed the **citations** list. The other three were designed by extension of its rhythm:

- **Businesses** — initials mark, name + city, NAP average rail, citation-count badge
- **Campaigns** — pink `RUN NEW CAMPAIGN` trigger + history rows with status badges (RUNNING / COMPLETED / FAILED)
- **Proof** — 2-up thumbnail gallery with date + hostname

**Needs review:** campaign rows currently show only date + type + status. The LangGraph pipeline has 4 steps (Discovery → Scanner → Auditor → Prioritizer) with per-step status — a running campaign could show step progress inline. No mockup for that.

---

## 4. SEO Analysis tab — derived, not specified

1a showed four sub-score bars (`{{ subScores }}`) but not what they measure. The analyzer produces a single 0–100 score by deduction, so the four categories were derived from the raw signals:

- **META** — title length, description length, canonical, OG, schema (5 checks)
- **CONTENT** — word count, readability, single H1 (3 checks)
- **LINKS** — internal depth, external presence, image alt coverage (3 checks)
- **TECH** — DOM size, HTTPS, mixed content (3 checks)

**Needs confirmation:** are these the right four buckets, and the right weightings?

Section badges (`1 WARNING`, `INP POOR`, `1 BROKEN`) were also derived per section. `1 BROKEN` for links has no data source — the analyzer doesn't check link liveness — so the links badge shows alt-text failures or total link count instead.

---

## 5. Smaller open questions

- **Recent checks panel (1a idle)** reads "Last 3 checks · this business" but is backed by the 3 most recent **citations**, not a check history. There's no NAP-check log — repeated checks of the same listing overwrite nothing and record nothing until you file.
- **Signed-out proof strip (1k)** shows `40 DIRECTORIES / NAP MATCH SCORING / 1-CLICK PROOF CAPTURE`. The mockup's numbers were placeholders; these are the real capabilities. Worth a copy pass.
- **`Start free →`** links to `seobandwagon.com/citationforge` — that page needs to exist.
- **Keyboard shortcuts** — 1h (action list) showed keyboard hints; 1g won, so no shortcuts ship. Worth adding for Check NAP.
- **Directory glyph** is the first letter of the directory name. Real favicons would be stronger but need fetching/caching.
