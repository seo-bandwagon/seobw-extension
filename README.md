# SEO Bandwagon Browser Extension

Comprehensive SEO analysis tool. Capture page metrics, detect issues, and save to SEO Bandwagon.

## Install (Developer Mode)

1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select: `~/.openclaw/workspace/projects/seo-bw-extension`

## Features

### Data Captured
- **Content:** Word count, character count, sentences, readability scores, top words & phrases
- **Meta:** Title, description, canonical, robots, Open Graph, Twitter Cards, Schema.org/JSON-LD
- **Headings:** Full H1-H6 hierarchy with multiple-H1 detection
- **Links:** Internal/external counts, URLs, domains, anchor text, nofollow
- **Images:** Total count, missing alt text detection, alt text content
- **Technical:** DOM size, scripts, stylesheets, load time, URL depth

### Issue Detection
Automatically flags:
- Missing or malformed title/description
- Multiple H1 tags
- Images without alt text
- Missing canonical URL
- No structured data
- Missing Open Graph tags
- Large DOM size

### UI Tabs
- **Overview:** Quick stats + issues panel
- **Meta:** Full meta tag details
- **Content:** Readability, headings, keywords
- **Links:** Link analysis + images
- **Tech:** Performance metrics

### Tools
- **Save to API:** Send to api.seobw.dev
- **Copy JSON:** Copy full data to clipboard
- **Export:** Download as JSON file
- **Local Backup:** Auto-saves captures locally
- **History:** View all local captures (`history.html`)

### Keyboard Shortcut
`Ctrl+Shift+S` (Mac: `Cmd+Shift+S`) — Analyze current page

### Context Menu
Right-click → "Analyze this page with SEO Bandwagon"

## Settings

Right-click extension icon → Options, or open `options.html`

- **API Key:** Your seobw.dev API key
- **API Endpoint:** Default `https://api.seobw.dev`
- **Auto-save:** Automatically save without clicking
- **Notifications:** Show save confirmations
- **Local backup:** Keep local copies of captures

## API Endpoint

Backend: `POST https://api.seobw.dev/v1/captures`

See `API_SPEC.md` for full payload specification.

## Files

```
├── manifest.json      # Extension config
├── popup.html/js      # Main UI
├── content.js         # Page analysis (injected)
├── background.js      # Service worker
├── options.html/js    # Settings page
├── history.html/js    # Local capture history
├── icons/             # Extension icons
├── API_SPEC.md        # API specification
└── ROADMAP.md         # Project roadmap
```
