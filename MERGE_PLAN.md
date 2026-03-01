# Feature Merge Plan

Merge missing features from `/home/kyle-alm/seo-extension/src/` into current extension before Chrome Web Store publish.

## Phase 1: Content Script (content.js)
- [ ] Add `detectTechStack()` function (WordPress, Shopify, Wix, Squarespace, Webflow, Next.js, React, Vue, Angular, Gatsby)
- [ ] Add `highlightElement(type)` function for visual highlighting
- [ ] Add `showCharCounter()` / `hideCharCounter()` for text selection
- [ ] Ensure char count is captured

## Phase 2: Popup UI (popup.js + popup.html)
- [ ] Add Quick Stats bar at top (Words | Reading Level | Links)
- [ ] Add Title length badge (0/60)
- [ ] Add Description length badge (0/160)
- [ ] Add Tech Stack section with badges
- [ ] Add Highlight buttons (Show H1s, Show Links, etc.)
- [ ] Consider Tab UI vs keeping accordions (accordions work, tabs looked better)

## Phase 3: SERP Overlay (serp-overlay.js)
- [ ] Copy serp-overlay.js to current extension
- [ ] Update manifest.json to include it as content script on Google
- [ ] Add CSS for overlay styling

## Phase 4: Styling
- [ ] Merge popup.css (8947 bytes of styling) or inline critical styles
- [ ] Ensure consistent look

## Phase 5: Testing & Push
- [ ] Test all features locally
- [ ] Commit and push
- [ ] Create new release ZIP

## Files to copy/merge:
- `/home/kyle-alm/seo-extension/src/content/content.js` → merge detectTechStack, highlightElement
- `/home/kyle-alm/seo-extension/src/content/serp-overlay.js` → copy entirely
- `/home/kyle-alm/seo-extension/src/popup/popup.css` → merge styles
- `/home/kyle-alm/seo-extension/src/popup/popup.html` → extract quick stats, badges, highlight buttons
- `/home/kyle-alm/seo-extension/src/popup/popup.js` → merge UI logic

## Estimated work:
- Phase 1: 30 min
- Phase 2: 45 min
- Phase 3: 20 min
- Phase 4: 15 min
- Phase 5: 10 min
- **Total: ~2 hours**
