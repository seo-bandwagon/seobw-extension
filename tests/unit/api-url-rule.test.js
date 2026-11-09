// The API address rule is written twice (1.13.7): Options' isValidApiUrl
// (src/lib/options-logic.js), checked when the Advanced field is saved, and
// SBW.isAllowedApiUrl (src/lib/api.js), checked at every send. Options stays
// free of api.js on purpose, so this keeps the two copies in step: any input
// one accepts, the other must too.

import { describe, it, expect } from 'vitest';

await import('../../extension/src/lib/sync-state.js');
await import('../../extension/src/lib/api.js');
await import('../../extension/src/lib/options-logic.js');
const SBW = globalThis.SBW;
const SBWOptions = globalThis.SBWOptions;

const INPUTS = [
  'https://seobandwagon.com', 'https://seobandwagon.com/api', 'https://SEOBANDWAGON.COM/api/',
  'https://cf.seobandwagon.com', 'https://a.b.seobandwagon.com:8443/api',
  'http://localhost', 'http://localhost:3000/api', 'http://127.0.0.1:8787', 'HTTP://LOCALHOST:1/',
  '  https://seobandwagon.com/api  ',
  '', ' ', 'not a url', 'seobandwagon.com', '//seobandwagon.com',
  'http://seobandwagon.com/api', 'ftp://seobandwagon.com', 'javascript:alert(1)',
  'https://api.seobandwagon.dev', 'https://deploy-preview-1--seobandwagon.netlify.app',
  'https://seobandwagon.com.evil.example', 'https://evilseobandwagon.com',
  'https://seobandwagon.com@evil.example', 'https://evil.example/?h=seobandwagon.com',
  'https://evil.example#.seobandwagon.com', 'http://localhost.evil.example', 'http://127.0.0.1.evil.example',
  'https://[::1]/api', 'http://[::1]:3000'
];

describe('the API address rule: Options and the send path agree', () => {
  for (const input of INPUTS) {
    it(JSON.stringify(input), () => {
      expect(SBW.isAllowedApiUrl(input)).toBe(SBWOptions.isValidApiUrl(input));
    });
  }
});
