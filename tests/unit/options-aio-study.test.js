// The AI Overview study's card on the Options page (1.13.3): the words on the
// page are the words of the consent flow, character for character, so what
// the person reads when they say yes is what the flow says it sends. The
// preview harness's copy of the page is held to the same words.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const C = require('../../extension/src/lib/consent.js');
const root = path.resolve(__dirname, '../..');

const PAGES = [
  ['extension/src/options/options.html', 'the page'],
  ['preview/options.html', 'the preview harness copy']
];

function parse(file) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}

describe.each(PAGES)('%s (%s): the AI Overview study card', (file) => {
  const doc = parse(file);
  const section = doc.getElementById('aio-study');

  it('is its own section, right after Google results, titled for the study', () => {
    expect(section).not.toBeNull();
    expect(doc.getElementById('google-results').nextElementSibling).toBe(section);
    expect(section.querySelector('.section-title').textContent).toBe('AI Overview study');
    expect(section.querySelector('.consent-title').textContent).toBe('For invited testers of the AI Overview study');
  });

  it('opens with exactly what the flow sends', () => {
    const first = section.querySelector('.consent-card .consent-text');
    expect(first.textContent.trim()).toBe(C.FLOWS.aioStudy.sends);
  });

  it('then says how a term opens, what Chrome must allow, and where to join and leave', () => {
    const second = section.querySelectorAll('.consent-card .consent-text')[1].textContent.trim();
    expect(second).toBe(
      'Each term opens in a private window with Google set to the US and English and Google’s personalization parameter off (hl=en, gl=us, pws=0). ' +
      'Chrome must allow SEO Bandwagon in private windows: Allow in Incognito, on the extension’s Details page. ' +
      'Join or leave the study on seobandwagon.com; turn sends off here at any time.'
    );
  });

  it('has the status and the two buttons the page wires, the way keyword data does', () => {
    const status = doc.getElementById('aioStudyStatus');
    expect(status.textContent).toBe('Not turned on: nothing is sent to the study.');
    expect(status.getAttribute('role')).toBe('status');
    const accept = doc.getElementById('aioStudyAccept');
    const withdraw = doc.getElementById('aioStudyWithdraw');
    expect(accept.textContent).toBe('Turn on study sends');
    expect(withdraw.textContent).toBe('Turn off study sends');
    expect(withdraw.hidden).toBe(true);
    expect(section.contains(accept) && section.contains(withdraw) && section.contains(status)).toBe(true);
  });
});
