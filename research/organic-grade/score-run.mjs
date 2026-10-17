// SEO Bandwagon — score every fetched page of an organic-grade run (organic grade study)
//
//   node research/organic-grade/score-run.mjs [runDir]
//
// The run folder (OGS_RUN_DIR, default below) holds pages.ndjson, one PageRecord
// per page the fetch stage visited, and html/<sha1>.html for the ones it got.
// This runs score-core.js's scoreDocument() over each fetched page in a fresh
// jsdom, scripts not run, so the raw HTML is what is scored, and appends one
// ScoreRecord per page to scores.ndjson as soon as it is computed. A run that
// is stopped picks up where it left off: URLs already in scores.ndjson are
// skipped. scorer.json records which extension code made the scores.
//
// The HTML files are UTF-8 text (the fetch stage decoded the page and wrote it
// back as UTF-8), so they are read as UTF-8 and never charset-sniffed.

import { appendFileSync, existsSync, readFileSync, realpathSync, truncateSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { JSDOM, VirtualConsole } from 'jsdom';

// The extension's libraries are classic scripts with a CommonJS tail, so they
// load with require, from here, whatever the working directory is.
const require = createRequire(import.meta.url);
const { scoreDocument, CHECK_START } = require('./score-core.js');
const deps = {
  analysis: require('../../extension/lib/content-analysis.js'),
  extraction: require('../../extension/lib/dom-extraction.js'),
  subScores: require('../../extension/src/lib/sub-scores.js')
};

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_RUN_DIR = '/Volumes/T7 Storage/claude-scratch/SEOBW-home/organic-grade/run-2026-10';
const PROGRESS_EVERY = 500;

// Decodes UTF-8 and drops a leading byte order mark, as a browser does.
const utf8 = new TextDecoder('utf-8');

// The record for a page that could not be scored: the same keys as a scored
// record, every score null (a zero would read as a very bad page).
function errorRecord(url, message) {
  const checks = {};
  Object.keys(CHECK_START).forEach((name) => { checks[name] = null; });
  return {
    url,
    score: null,
    grade: null,
    issues: [],
    checks,
    subScores: { Meta: null, Content: null, Links: null, Tech: null },
    wordCount: null,
    titleText: null,
    titleLength: null,
    error: message
  };
}

function readNdjson(file) {
  const records = [];
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (line.trim() === '') return;
    try {
      records.push(JSON.parse(line));
    } catch (e) {
      throw new Error(`${file} line ${i + 1} is not JSON: ${e.message}`);
    }
  });
  return records;
}

// Every record is appended as one line ending in a newline, so a file that does
// not end in one was cut off mid-write. Drop that last line: its page is scored
// again, and the next append cannot run into it.
function dropUnfinishedLine(file) {
  const bytes = readFileSync(file);
  if (bytes.length === 0 || bytes[bytes.length - 1] === 0x0a) return;
  truncateSync(file, bytes.lastIndexOf(0x0a) + 1);
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

// The ScoreRecord for one PageRecord. Never throws.
function scorePage(runDir, page) {
  let html;
  try {
    html = utf8.decode(readFileSync(join(runDir, page.htmlFile)));
  } catch (e) {
    return errorRecord(page.url, `cannot read ${page.htmlFile} (${(e && e.code) || e})`);
  }

  let dom;
  try {
    // The document is at finalUrl, as served, so its links resolve and count
    // against that host. No `resources`, no `runScripts`: nothing is fetched or
    // run. The console is not forwarded, or jsdom's CSS and HTML parse warnings
    // would flood the output.
    dom = new JSDOM(html, { url: page.finalUrl || page.url, virtualConsole: new VirtualConsole() });
    // Ruling 17: the record's url is the result URL the analysis joins on, not
    // the document's.
    return { ...scoreDocument(dom.window.document, dom.window, deps), url: page.url };
  } catch (e) {
    return errorRecord(page.url, String((e && e.message) || e));
  } finally {
    if (dom) dom.window.close();
  }
}

/**
 * Scores the run folder's fetched pages, one at a time, and appends each
 * ScoreRecord to scores.ndjson. Resolves to the counts for this call only:
 * `scored` pages with a score, `errors` pages recorded with an error and null
 * scores (so scored + errors lines were appended).
 *
 * `log` takes the progress lines.
 */
export async function scorePages(runDir, { log = console.log } = {}) {
  const pagesFile = join(runDir, 'pages.ndjson');
  const scoresFile = join(runDir, 'scores.ndjson');
  const scorerFile = join(runDir, 'scorer.json');
  if (!existsSync(pagesFile)) throw new Error(`no pages.ndjson in ${runDir}`);

  // Already in scores.ndjson, error lines included, so a resume does not retry
  // a page that failed: delete its line to score it again.
  let have = new Set();
  if (existsSync(scoresFile)) {
    dropUnfinishedLine(scoresFile);
    have = new Set(readNdjson(scoresFile).map((record) => record.url));
  }

  const alreadyScored = have.size;
  const todo = [];
  for (const page of readNdjson(pagesFile)) {
    if (page.outcome !== 'fetched' || !page.htmlFile || have.has(page.url)) continue;
    have.add(page.url); // listed twice, scored once
    todo.push(page);
  }

  // Which extension code scored the pages. Read before the first page, and only
  // rewritten when this call scores something: a call with nothing to do must
  // not relabel scores that an earlier commit made.
  if (todo.length > 0 || !existsSync(scorerFile)) {
    const scorer = {
      commit: git(['rev-parse', 'HEAD']).trim(),
      extensionDirty: git(['status', '--porcelain', '--', 'extension/']).trim() !== '',
      scoredAt: new Date().toISOString()
    };
    writeFileSync(scorerFile, JSON.stringify(scorer, null, 2) + '\n');
  }

  log(`scoring ${todo.length} pages in ${runDir} (${alreadyScored} already in scores.ndjson)`);

  let scored = 0;
  let errors = 0;
  for (const page of todo) {
    const record = scorePage(runDir, page);
    appendFileSync(scoresFile, JSON.stringify(record) + '\n');
    if (record.error === null) scored++;
    else errors++;
    if ((scored + errors) % PROGRESS_EVERY === 0) {
      log(`${scored + errors} of ${todo.length} pages done, ${errors} errors`);
    }
  }
  return { scored, errors };
}

// Run directly, not imported by the tests.
function isMain() {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch (e) {
    return false;
  }
}

if (isMain()) {
  // `|| ` rather than `??`: "$OGS_RUN_DIR" is an empty argument when unset.
  const runDir = process.argv[2] || process.env.OGS_RUN_DIR || DEFAULT_RUN_DIR;
  scorePages(runDir).then(
    (summary) => console.log(JSON.stringify(summary)),
    (e) => {
      console.error(e);
      process.exitCode = 1;
    }
  );
}
