// Every extension page and the worker load src/lib/browser.js before the code
// that reads it (tests/unit/browser.test.js checks the pages), so the tests
// do too: globalThis.SBWBrowser holds the Chrome values, as the source does.
// A test of another target sets globalThis.SBWBrowser to
// SBWBrowser.withValues(<that target's values>) and puts it back after.
await import('../../extension/src/lib/browser.js');
