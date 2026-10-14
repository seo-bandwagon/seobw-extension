// The release scripts: Chrome Web Store upload/submit (staged) and the
// GitHub release notes. The store is a fake fetch; nothing leaves the test.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publishRelease, itemName } from '../../scripts/cws-publish.mjs';
import { whatsNew, notes } from '../../scripts/release-notes.mjs';

const ITEM = 'abcdefghijklmnopabcdefghijklmnop';
let zip;
beforeAll(() => { zip = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cws-')), 'x.zip'); fs.writeFileSync(zip, 'PK fake'); });
afterAll(() => fs.rmSync(path.dirname(zip), { recursive: true, force: true }));

// A fake store: replies in order per (method, path suffix).
function store(replies) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    const key = `${init.method} ${url.split(':').pop().split('?')[0]}`;
    calls.push({ key, url, init });
    const queue = replies[key];
    const r = queue && queue.length ? queue.shift() : { status: 500, body: { error: { message: 'unexpected ' + key } } };
    return { ok: r.status < 300, status: r.status || 200, statusText: '', text: async () => JSON.stringify(r.body || {}) };
  });
  return { fetchImpl, calls };
}
const ok = (body) => ({ status: 200, body });
const base = (f, extra) => Object.assign({ fetchImpl: f, token: 't', publisherId: 'pub-1', itemId: ITEM, zip, expectVersion: '1.8.0', log: () => {}, sleep: async () => {} }, extra);

describe('cws-publish', () => {
  it('uploads, then submits as a staged publish that blocks on warnings', async () => {
    const s = store({
      'GET fetchStatus': [ok({ publishedItemRevisionStatus: { state: 'PUBLISHED', distributionChannels: [{ crxVersion: '1.7.1', deployPercentage: 100 }] } })],
      'POST upload': [ok({ uploadState: 'SUCCEEDED', crxVersion: '1.8.0' })],
      'POST publish': [ok({ state: 'PENDING_REVIEW' })]
    });
    const r = await publishRelease(base(s.fetchImpl));
    expect(r).toEqual({ uploaded: true, submitted: true, state: 'PENDING_REVIEW' });
    const pub = s.calls.find(c => c.key === 'POST publish');
    expect(JSON.parse(pub.init.body)).toEqual({ publishType: 'STAGED_PUBLISH', blockOnWarnings: true });
    expect(pub.url).toBe(`https://chromewebstore.googleapis.com/v2/publishers/pub-1/items/${ITEM}:publish`);
    expect(s.calls.find(c => c.key === 'POST upload').url).toContain(`/upload/v2/publishers/pub-1/items/${ITEM}:upload`);
  });

  it('check mode only reads the status', async () => {
    const s = store({ 'GET fetchStatus': [ok({ submittedItemRevisionStatus: { state: 'PENDING_REVIEW' } })] });
    expect(await publishRelease(base(s.fetchImpl, { mode: 'check' }))).toEqual({ uploaded: false, submitted: false });
    expect(s.calls.map(c => c.key)).toEqual(['GET fetchStatus']);
  });

  it('upload mode never submits', async () => {
    const s = store({ 'GET fetchStatus': [ok({})], 'POST upload': [ok({ uploadState: 'SUCCEEDED', crxVersion: '1.8.0' })] });
    await publishRelease(base(s.fetchImpl, { mode: 'upload' }));
    expect(s.calls.map(c => c.key)).toEqual(['GET fetchStatus', 'POST upload']);
  });

  it('stops, without uploading, when a submission is already in review', async () => {
    const s = store({ 'GET fetchStatus': [ok({ submittedItemRevisionStatus: { state: 'PENDING_REVIEW' } })] });
    await expect(publishRelease(base(s.fetchImpl))).rejects.toThrow(/already in review/);
    expect(s.calls.map(c => c.key)).toEqual(['GET fetchStatus']);
  });

  it('waits for an asynchronous upload, then submits', async () => {
    const s = store({
      'GET fetchStatus': [ok({}), ok({ lastAsyncUploadState: 'IN_PROGRESS' }), ok({ lastAsyncUploadState: 'SUCCEEDED' })],
      'POST upload': [ok({ uploadState: 'IN_PROGRESS' })],
      'POST publish': [ok({ state: 'PENDING_REVIEW' })]
    });
    expect((await publishRelease(base(s.fetchImpl))).submitted).toBe(true);
  });

  it('refuses a package whose version isn\'t the release\'s, before submitting', async () => {
    const s = store({ 'GET fetchStatus': [ok({})], 'POST upload': [ok({ uploadState: 'SUCCEEDED', crxVersion: '1.7.9' })] });
    await expect(publishRelease(base(s.fetchImpl))).rejects.toThrow(/1\.7\.9.*expected 1\.8\.0/);
    expect(s.calls.some(c => c.key === 'POST publish')).toBe(false);
  });

  it('reports the store\'s own error message', async () => {
    const s = store({ 'GET fetchStatus': [{ status: 403, body: { error: { message: 'The caller does not have permission' } } }] });
    await expect(publishRelease(base(s.fetchImpl))).rejects.toThrow(/HTTP 403: The caller does not have permission/);
  });

  it('checks the IDs before calling anything', () => {
    expect(() => itemName('pub', 'not-an-id')).toThrow(/malformed/);
    expect(itemName('pub', ITEM)).toBe(`publishers/pub/items/${ITEM}`);
  });
});

describe('release notes', () => {
  const listing = fs.readFileSync(path.join(import.meta.dirname, '../../docs/CWS-LISTING.md'), 'utf8');

  it('takes the "What\'s new" block from the listing', () => {
    const w = whatsNew(listing);
    expect(w.heading).toMatch(/^What's new in \d+\.\d+\.\d+$/);
    expect(w.text.startsWith('- ')).toBe(true);
  });

  it('adds the package name and its SHA-256', () => {
    const n = notes(listing, 'seo-bw-extension-1.8.0.zip', 'ab'.repeat(32));
    expect(n).toContain('`seo-bw-extension-1.8.0.zip`');
    expect(n).toContain('SHA-256: `' + 'ab'.repeat(32) + '`');
  });
});
