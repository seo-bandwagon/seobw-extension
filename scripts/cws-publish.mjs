#!/usr/bin/env node
// Upload a release zip to the Chrome Web Store and submit it for review as a
// STAGED publish: once Google approves it, it waits in the Developer
// Dashboard until a person presses Publish. Run by
// .github/workflows/store-submit.yml, which the owner starts by hand for a
// version already released on GitHub: starting it is the approval, and the
// Publish button is the second.
//
// It never cancels a submission or changes the listing (text, screenshots):
// the API can't change the listing, and a submission already in review stops
// the run instead of being replaced.
//
// env: CWS_TOKEN (short-lived access token, scope chromewebstore),
//      CWS_PUBLISHER_ID, CWS_ITEM_ID, ZIP (path), EXPECT_VERSION,
//      MODE: "submit" (upload, then submit as a staged publish), "upload"
//      (upload only), or "check" (sign in and show the status; change nothing)
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://chromewebstore.googleapis.com';
const POLL_MS = 5000;
const POLL_TRIES = 36; // three minutes for an asynchronous upload

export function itemName(publisherId, itemId) {
  if (!/^[\w.-]+$/.test(publisherId || '') || !/^[a-p]{32}$/.test(itemId || '')) {
    throw new Error('CWS_PUBLISHER_ID or CWS_ITEM_ID is missing or malformed (an item ID is 32 letters a–p).');
  }
  return `publishers/${publisherId}/items/${itemId}`;
}

async function call(fetchImpl, token, method, url, body, contentType) {
  const res = await fetchImpl(url, {
    method,
    headers: Object.assign({ Authorization: `Bearer ${token}` }, contentType ? { 'Content-Type': contentType } : {}),
    body
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : {}; } catch (_) { /* not JSON */ }
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || text.slice(0, 300) || res.statusText;
    throw new Error(`${method} ${url.replace(API, '')} → HTTP ${res.status}: ${msg}`);
  }
  return json || {};
}

export async function publishRelease({
  fetchImpl = fetch, token, publisherId, itemId, zip, expectVersion, mode = 'submit',
  log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms))
}) {
  const name = itemName(publisherId, itemId);
  if (!token) throw new Error('No access token (CWS_TOKEN).');

  const before = await call(fetchImpl, token, 'GET', `${API}/v2/${name}:fetchStatus`);
  log(`Published now: ${describe(before.publishedItemRevisionStatus)}`);
  if (before.submittedItemRevisionStatus) log(`Submitted: ${describe(before.submittedItemRevisionStatus)}`);
  if (before.warned || before.takenDown) log(`Policy: ${before.takenDown ? 'taken down' : 'warned'}. See the Developer Dashboard.`);
  if (mode === 'check') return { uploaded: false, submitted: false };
  const inReview = before.submittedItemRevisionStatus && before.submittedItemRevisionStatus.state === 'PENDING_REVIEW';
  if (inReview) {
    throw new Error('A submission is already in review. Wait for it, or cancel it in the Developer Dashboard, then run this again.');
  }

  const bytes = fs.readFileSync(zip);
  log(`Uploading ${zip} (${bytes.length} bytes)…`);
  let up = await call(fetchImpl, token, 'POST', `${API}/upload/v2/${name}:upload?uploadType=media`, bytes, 'application/zip');
  let state = up.uploadState;
  for (let i = 0; state === 'IN_PROGRESS' && i < POLL_TRIES; i++) {
    await sleep(POLL_MS);
    const st = await call(fetchImpl, token, 'GET', `${API}/v2/${name}:fetchStatus`);
    state = st.lastAsyncUploadState;
  }
  if (state !== 'SUCCEEDED') throw new Error(`Upload did not succeed (state ${state || 'unknown'}).`);
  if (up.crxVersion && expectVersion && up.crxVersion !== expectVersion) {
    throw new Error(`The store read version ${up.crxVersion} from the package; expected ${expectVersion}.`);
  }
  log(`Uploaded${up.crxVersion ? ` version ${up.crxVersion}` : ''}.`);

  if (mode !== 'submit') {
    log('Not submitted (upload only). Submit it from the Developer Dashboard.');
    return { uploaded: true, submitted: false };
  }

  const pub = await call(fetchImpl, token, 'POST', `${API}/v2/${name}:publish`,
    JSON.stringify({ publishType: 'STAGED_PUBLISH', blockOnWarnings: true }), 'application/json');
  log(`Submitted for review as a staged publish: ${pub.state || 'state not reported'}.`);
  if (pub.warningInfo) log(`Warnings: ${JSON.stringify(pub.warningInfo)}`);
  log('After Google approves it, press Publish in the Developer Dashboard to release it.');
  return { uploaded: true, submitted: true, state: pub.state };
}

function describe(rev) {
  if (!rev || !rev.state) return 'nothing';
  const versions = (rev.distributionChannels || []).map((c) => `${c.crxVersion}${c.deployPercentage != null && c.deployPercentage !== 100 ? ` at ${c.deployPercentage}%` : ''}`);
  return `${rev.state}${versions.length ? ` (${versions.join(', ')})` : ''}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  const lines = [];
  const log = (s) => { console.log(s); lines.push(`- ${s}`); };
  publishRelease({
    token: process.env.CWS_TOKEN,
    publisherId: process.env.CWS_PUBLISHER_ID,
    itemId: process.env.CWS_ITEM_ID,
    zip: process.env.ZIP,
    expectVersion: process.env.EXPECT_VERSION,
    mode: process.env.MODE || 'submit',
    log
  }).then(() => {
    if (summary) fs.appendFileSync(summary, `### Chrome Web Store\n${lines.join('\n')}\n`);
  }, (e) => {
    console.error(`::error::${e.message}`);
    if (summary) fs.appendFileSync(summary, `### Chrome Web Store\n${lines.join('\n')}\n- **Failed:** ${e.message}\n`);
    process.exit(1);
  });
}
