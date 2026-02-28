# SEO Bandwagon Chrome Extension

Capture comprehensive SEO metrics from any webpage with one click. Works offline, syncs to seobandwagon.dev when connected.

## Features

- **Content Analysis**: Word count, readability (Flesch-Kincaid), top words/phrases
- **Meta Extraction**: Title, description, canonical, robots, Open Graph, Twitter Cards
- **Schema Detection**: JSON-LD structured data parsing
- **Heading Structure**: H1-H6 hierarchy with multiple H1 warnings
- **Link Analysis**: Internal/external counts, nofollow detection, anchor text
- **Image Audit**: Total images, missing alt text detection
- **Technical**: DOM elements, scripts, stylesheets, load time, URL depth
- **SEO Score**: 0-100 score with letter grade (A-F) based on best practices
- **SERP Preview**: See how your page appears in Google results

## Installation

1. Clone or download this repo
2. Open Chrome → `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" → select this folder
5. Pin the extension to your toolbar

## Usage

1. Navigate to any webpage
2. Click the extension icon
3. View metrics in collapsible sections
4. Data auto-saves to local storage

### History

Click "History" in the popup to see all captured pages:
- Search by URL or title
- Export URLs as .txt (for crawler seeding)
- Clear individual or all captures

### Settings

Click "Settings" to configure:
- API Key (for syncing to seobandwagon.dev)
- API sync is optional - extension works fully offline

## Local-First Architecture

All captures save to `chrome.storage.local` immediately. No network required.

When API is configured:
- New captures sync automatically
- Bulk sync available from History page
- Failed syncs retry on next capture

## Files

```
├── manifest.json      # Extension config (Manifest V3)
├── popup.html         # Main popup UI
├── popup.js           # Popup logic + accordions
├── history.html       # Capture history page
├── history.js         # History search/export
├── settings.html      # API configuration
├── settings.js        # Settings storage
├── content.js         # Page analysis (runs on active tab)
├── background.js      # Service worker
└── icons/             # Extension icons
```

## SEO Score Calculation

Score deductions:
- Missing title: -15
- Title too long (>60 chars): -5
- Missing meta description: -10
- Description too long (>160 chars): -5
- Missing H1: -15
- Multiple H1s: -10
- Low word count (<300): -10
- Missing canonical: -5
- Missing Open Graph: -5
- Images missing alt text: -5

## API Endpoints

When configured, syncs to:
- `POST https://api.seobandwagon.dev/v1/captures` - Store capture
- `GET https://api.seobandwagon.dev/v1/captures` - List captures

## Development

```bash
# Clone
git clone git@github.com:seo-bandwagon/seo-bw-extension.git
cd seo-bw-extension

# Make changes, then reload in chrome://extensions/
```

## License

Private - SEO Bandwagon internal tool
