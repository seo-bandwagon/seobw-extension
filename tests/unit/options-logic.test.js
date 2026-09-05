// Unit tests for the pure Options page helpers (src/lib/options-logic.js).
// Covers: Advanced API URL validation/normalisation and the
// SBW.verifyKey() result → status message/class mapping.

import { describe, it, expect } from 'vitest';

await import('../../src/lib/options-logic.js');
const SBWOptions = globalThis.SBWOptions;

describe('SBWOptions — dual export', () => {
  it('attaches to globalThis and exports via CommonJS', () => {
    expect(SBWOptions).toBeTruthy();
    expect(typeof SBWOptions.isValidApiUrl).toBe('function');
  });
});

describe('isValidApiUrl', () => {
  it('accepts the production API host', () => {
    expect(SBWOptions.isValidApiUrl('https://seobandwagon.com/api')).toBe(true);
    expect(SBWOptions.isValidApiUrl('https://seobandwagon.com')).toBe(true);
  });

  it('accepts any seobandwagon.com subdomain', () => {
    expect(SBWOptions.isValidApiUrl('https://staging.seobandwagon.com/api')).toBe(true);
    expect(SBWOptions.isValidApiUrl('https://api.seobandwagon.com')).toBe(true);
  });

  it('accepts a Netlify deploy-preview host for this site', () => {
    expect(SBWOptions.isValidApiUrl('https://deploy-preview-123--seobandwagon.netlify.app/api')).toBe(true);
  });

  it('accepts http://localhost, with or without a port', () => {
    expect(SBWOptions.isValidApiUrl('http://localhost/api')).toBe(true);
    expect(SBWOptions.isValidApiUrl('http://localhost:8000/api')).toBe(true);
    expect(SBWOptions.isValidApiUrl('http://localhost')).toBe(true);
  });

  it('accepts http://127.0.0.1, with or without a port', () => {
    expect(SBWOptions.isValidApiUrl('http://127.0.0.1/api')).toBe(true);
    expect(SBWOptions.isValidApiUrl('http://127.0.0.1:3000/api')).toBe(true);
  });

  it('rejects plain http to a real host', () => {
    expect(SBWOptions.isValidApiUrl('http://seobandwagon.com/api')).toBe(false);
  });

  it('rejects a host that merely starts with localhost as a substring', () => {
    expect(SBWOptions.isValidApiUrl('http://localhost.evil.com/api')).toBe(false);
  });

  it('rejects an unrelated https host', () => {
    expect(SBWOptions.isValidApiUrl('https://staging.example.com/api')).toBe(false);
    expect(SBWOptions.isValidApiUrl('https://evil.com/api')).toBe(false);
  });

  it('rejects a host that merely contains seobandwagon.com as a substring', () => {
    expect(SBWOptions.isValidApiUrl('https://evilseobandwagon.com/api')).toBe(false);
    expect(SBWOptions.isValidApiUrl('https://seobandwagon.com.evil.com/api')).toBe(false);
  });

  it('rejects a Netlify host that is not a seobandwagon deploy preview', () => {
    expect(SBWOptions.isValidApiUrl('https://some-other-site.netlify.app/api')).toBe(false);
  });

  it('rejects a userinfo/hostname trick', () => {
    expect(SBWOptions.isValidApiUrl('https://seobandwagon.com@evil.com/api')).toBe(false);
  });

  it('rejects empty/garbage input', () => {
    expect(SBWOptions.isValidApiUrl('')).toBe(false);
    expect(SBWOptions.isValidApiUrl('   ')).toBe(false);
    expect(SBWOptions.isValidApiUrl('not a url')).toBe(false);
    expect(SBWOptions.isValidApiUrl(undefined)).toBe(false);
  });
});

describe('isLocalhostUrl', () => {
  it('is true for localhost/127.0.0.1 http URLs', () => {
    expect(SBWOptions.isLocalhostUrl('http://localhost:8000/api')).toBe(true);
    expect(SBWOptions.isLocalhostUrl('http://127.0.0.1/api')).toBe(true);
  });

  it('is false for a normal https URL', () => {
    expect(SBWOptions.isLocalhostUrl('https://seobandwagon.com/api')).toBe(false);
  });
});

describe('normalizeApiUrl', () => {
  it('appends /api when missing', () => {
    expect(SBWOptions.normalizeApiUrl('https://seobandwagon.com')).toBe('https://seobandwagon.com/api');
  });

  it('leaves a URL that already ends in /api unchanged', () => {
    expect(SBWOptions.normalizeApiUrl('https://seobandwagon.com/api')).toBe('https://seobandwagon.com/api');
  });

  it('strips trailing slashes before checking the suffix', () => {
    expect(SBWOptions.normalizeApiUrl('https://seobandwagon.com/api///')).toBe('https://seobandwagon.com/api');
  });

  it('falls back to the default URL when empty', () => {
    expect(SBWOptions.normalizeApiUrl('')).toBe('https://seobandwagon.com/api');
    expect(SBWOptions.normalizeApiUrl('   ')).toBe('https://seobandwagon.com/api');
  });

  it('normalises a localhost URL the same way', () => {
    expect(SBWOptions.normalizeApiUrl('http://localhost:8000')).toBe('http://localhost:8000/api');
  });
});

describe('dashboardOrigin', () => {
  it('strips the /api suffix', () => {
    expect(SBWOptions.dashboardOrigin('https://seobandwagon.com/api')).toBe('https://seobandwagon.com');
  });

  it('falls back to the default origin when apiUrl is missing', () => {
    expect(SBWOptions.dashboardOrigin('')).toBe('https://seobandwagon.com');
    expect(SBWOptions.dashboardOrigin(undefined)).toBe('https://seobandwagon.com');
  });

  it('works for a localhost API URL', () => {
    expect(SBWOptions.dashboardOrigin('http://localhost:8000/api')).toBe('http://localhost:8000');
  });
});

describe('verifyStatusMessage', () => {
  it('reports the connected user, key name, and scopes on success', () => {
    const res = {
      ok: true,
      data: {
        email: 'kyle@seobandwagon.com',
        key: { name: 'Chrome extension' },
        scopes: ['captures:write', 'citations:write']
      }
    };
    expect(SBWOptions.verifyStatusMessage(res)).toBe(
      'Connected as kyle@seobandwagon.com · key "Chrome extension" · scopes: captures:write, citations:write'
    );
  });

  it('falls back to "unnamed" and an empty scope list when missing', () => {
    const res = { ok: true, data: { email: 'a@b.com' } };
    expect(SBWOptions.verifyStatusMessage(res)).toBe('Connected as a@b.com · key "unnamed" · scopes: ');
  });

  it('reports rejection on unauthorized', () => {
    expect(SBWOptions.verifyStatusMessage({ ok: false, code: 'unauthorized' })).toBe(
      'This key was rejected — create a new one'
    );
  });

  it('reports unreachable on unavailable or network', () => {
    expect(SBWOptions.verifyStatusMessage({ ok: false, code: 'unavailable' })).toBe(
      'Could not reach SEO Bandwagon (try again)'
    );
    expect(SBWOptions.verifyStatusMessage({ ok: false, code: 'network' })).toBe(
      'Could not reach SEO Bandwagon (try again)'
    );
  });

  it('falls back to a generic message for any other code', () => {
    expect(SBWOptions.verifyStatusMessage({ ok: false, code: 'forbidden' })).toBe(
      'Could not verify key (try again)'
    );
    expect(SBWOptions.verifyStatusMessage(null)).toBe('Could not verify key (try again)');
  });
});

describe('verifyStatusClass', () => {
  it('is "success" when ok, "error" otherwise', () => {
    expect(SBWOptions.verifyStatusClass({ ok: true })).toBe('success');
    expect(SBWOptions.verifyStatusClass({ ok: false, code: 'unauthorized' })).toBe('error');
    expect(SBWOptions.verifyStatusClass(null)).toBe('error');
  });
});

describe('keyChanged', () => {
  it('is false when the trimmed values are identical', () => {
    expect(SBWOptions.keyChanged('sbw_abc123', 'sbw_abc123')).toBe(false);
    expect(SBWOptions.keyChanged('sbw_abc123', '  sbw_abc123  ')).toBe(false);
  });

  it('is true when rotating from one key to a different one', () => {
    expect(SBWOptions.keyChanged('sbw_abc123', 'sbw_xyz789')).toBe(true);
  });

  it('treats empty and empty as unchanged, but empty vs. non-empty as changed', () => {
    expect(SBWOptions.keyChanged('', '')).toBe(false);
    expect(SBWOptions.keyChanged('', '   ')).toBe(false);
    expect(SBWOptions.keyChanged(undefined, '')).toBe(false);
    expect(SBWOptions.keyChanged('sbw_abc123', '')).toBe(true);
    expect(SBWOptions.keyChanged('', 'sbw_abc123')).toBe(true);
  });
});
