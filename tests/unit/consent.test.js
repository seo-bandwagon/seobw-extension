// The consent module (1.11.0, src/lib/consent.js): each data flow mapped to
// Firefox's data categories; every send checks category granted and flow
// accepted; on Chrome and Edge the category reads today's switches; the
// figures are accepted only by the specific action in Options.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const C = require('../../extension/src/lib/consent.js');

let local;

beforeEach(() => {
  local = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn(async (key) => (key in local ? { [key]: local[key] } : {})),
        set: vi.fn(async (obj) => { Object.assign(local, obj); })
      }
    }
  };
});

afterEach(() => {
  delete globalThis.chrome;
  delete globalThis.browser;
});

describe('the flows', () => {
  it('maps each flow to Firefox data categories, the design\'s consent table', () => {
    expect(C.FLOWS.captureSync.firefox).toEqual(['browsingActivity', 'websiteContent', 'technicalAndInteraction']);
    expect(C.FLOWS.serpFigures.firefox).toEqual(['websiteContent', 'searchTerms']);
    Object.values(C.FLOWS).forEach((f) => f.firefox.forEach((c) => expect(C.FIREFOX_CATEGORIES).toContain(c)));
  });

  it('says what each flow sends, and the figures never send the search terms or ask Google', () => {
    expect(C.FLOWS.serpFigures.sends).toMatch(/address of each result/);
    expect(C.FLOWS.serpFigures.sends).toMatch(/Never your search terms with them, and never a request to Google/);
    // 1.13.3: the words changed, what figures send did not, so no one is asked again.
    expect(C.FLOWS.serpFigures.version).toBe(2);
  });
});

describe('Chrome and Edge: today\'s switches', () => {
  it('saved analyses: on unless "Send analyses to SEO Bandwagon" is off, accepted by connecting', async () => {
    expect(await C.check('captureSync', { hasKey: true })).toEqual({ ok: true });
    local.dataCollection = false;
    expect(await C.check('captureSync', { hasKey: true })).toEqual({ ok: false, reason: 'category_off' });
    local.dataCollection = true;
    expect(await C.check('captureSync', { hasKey: false })).toEqual({ ok: false, reason: 'not_accepted' });
  });

  it('figures: nothing until the person accepts in Options', async () => {
    expect(await C.check('serpFigures')).toEqual({ ok: false, reason: 'not_accepted' });
    expect(await C.accept('serpFigures', Date.UTC(2026, 10, 1))).toBe(true);
    expect(local[C.STORAGE_KEY].serpFigures).toEqual({ acceptedAt: '2026-11-01T00:00:00.000Z', version: 2 });
    expect(await C.check('serpFigures')).toEqual({ ok: true });
  });

  it('figures: the overlay or the figures turned off in settings stops the send, accepted or not', async () => {
    await C.accept('serpFigures');
    local.serpSettings = { overlay: true, figuresOn: false };
    expect(await C.check('serpFigures')).toEqual({ ok: false, reason: 'category_off' });
    local.serpSettings = { overlay: false, figuresOn: true };
    expect(await C.check('serpFigures')).toEqual({ ok: false, reason: 'category_off' });
  });

  it('withdrawing stops the figures', async () => {
    await C.accept('serpFigures');
    await C.withdraw('serpFigures');
    expect(await C.check('serpFigures')).toEqual({ ok: false, reason: 'not_accepted' });
    expect(await C.acceptance('serpFigures')).toBeNull();
  });

  it('new words for a flow ask everyone again: 1.11.0\'s acceptance (version 1) is asked again for 1.12.0\'s pinned page', async () => {
    local[C.STORAGE_KEY] = { serpFigures: { acceptedAt: '2026-11-01T00:00:00Z', version: 1 } };
    expect(await C.check('serpFigures')).toMatchObject({ reason: 'not_accepted' });
  });

  it('a flow nobody wrote down is never allowed, and saved analyses can\'t be "accepted" by a button', async () => {
    expect(await C.check('somethingNew')).toEqual({ ok: false, reason: 'unknown_flow' });
    expect(await C.accept('captureSync')).toBe(false);
  });
});

describe('Firefox: its own data-collection consent', () => {
  it('asks Firefox for the flow\'s categories, and starts off', async () => {
    const contains = vi.fn(async () => false);
    const request = vi.fn(async () => true);
    globalThis.browser = { runtime: { getBrowserInfo: () => {} }, permissions: { contains, request } };
    expect(await C.check('captureSync', { hasKey: true })).toEqual({ ok: false, reason: 'category_off' });
    expect(contains).toHaveBeenCalledWith({ data_collection: ['browsingActivity', 'websiteContent', 'technicalAndInteraction'] });
    expect(await C.accept('serpFigures')).toBe(true);
    expect(request).toHaveBeenCalledWith({ data_collection: ['websiteContent', 'searchTerms'] });
    contains.mockResolvedValue(true);
    expect(await C.check('serpFigures')).toEqual({ ok: true });
  });

  it('a refused Firefox prompt accepts nothing', async () => {
    globalThis.browser = { runtime: { getBrowserInfo: () => {} }, permissions: { contains: async () => false, request: async () => false } };
    expect(await C.accept('serpFigures')).toBe(false);
    expect(local[C.STORAGE_KEY]).toBeUndefined();
  });
});

describe('keyword data (1.13.0): the search itself, only after its own yes', () => {
  it('is Firefox\'s searchTerms, and says it sends the search and never a result\'s address with it', () => {
    expect(C.FLOWS.keywordData.firefox).toEqual(['searchTerms']);
    expect(C.FLOWS.keywordData.acceptedBy).toBe('action');
    expect(C.FLOWS.keywordData.sends).toMatch(/The words of a Google search you open/);
    expect(C.FLOWS.keywordData.sends).toMatch(/Never a result’s address with them, and never a request to Google/);
  });

  it('nothing until the person says yes; the figures\' yes is not keyword data\'s', async () => {
    await C.accept('serpFigures');
    expect(await C.check('keywordData')).toEqual({ ok: false, reason: 'not_accepted' });
    expect(await C.accept('keywordData', Date.UTC(2026, 10, 2))).toBe(true);
    expect(local[C.STORAGE_KEY].keywordData).toEqual({ acceptedAt: '2026-11-02T00:00:00.000Z', version: 1 });
    expect(await C.check('keywordData')).toEqual({ ok: true });
  });

  it('keyword data or the overlay turned off in settings stops the send, accepted or not; the figures go on', async () => {
    await C.accept('keywordData');
    await C.accept('serpFigures');
    local.serpSettings = { overlay: true, figuresOn: true, keywordsOn: false };
    expect(await C.check('keywordData')).toEqual({ ok: false, reason: 'category_off' });
    expect(await C.check('serpFigures')).toEqual({ ok: true });
    local.serpSettings = { overlay: false, keywordsOn: true };
    expect(await C.check('keywordData')).toEqual({ ok: false, reason: 'category_off' });
  });

  it('withdrawing it stops it, and leaves the figures\' yes alone', async () => {
    await C.accept('keywordData');
    await C.accept('serpFigures');
    await C.withdraw('keywordData');
    expect(await C.check('keywordData')).toEqual({ ok: false, reason: 'not_accepted' });
    expect(await C.check('serpFigures')).toEqual({ ok: true });
  });

  it('on Firefox, the yes asks the browser for searchTerms; outside an extension page\'s click it is refused', async () => {
    const request = vi.fn(async () => false);
    globalThis.browser = { runtime: { getBrowserInfo: () => {} }, permissions: { contains: async () => false, request } };
    expect(await C.accept('keywordData')).toBe(false);
    expect(request).toHaveBeenCalledWith({ data_collection: ['searchTerms'] });
    expect(local[C.STORAGE_KEY]).toBeUndefined();
  });
});

describe('the AI Overview study (1.13.3): its own yes, and nothing else turns it on', () => {
  it('is Firefox\'s search terms, browsing activity and website content, accepted by an action', () => {
    expect(C.FLOWS.aioStudy.firefox).toEqual(['searchTerms', 'browsingActivity', 'websiteContent']);
    C.FLOWS.aioStudy.firefox.forEach((c) => expect(C.FIREFOX_CATEGORIES).toContain(c));
    expect(C.FLOWS.aioStudy.acceptedBy).toBe('action');
    expect(C.FLOWS.aioStudy.version).toBe(1);
    expect(C.FLOWS.aioStudy.chromeSwitch).toBeUndefined();
  });

  it('says what it sends: only a search the study opened, only on Send to study, never anything else', () => {
    const { sends, why } = C.FLOWS.aioStudy;
    expect(sends).toMatch(/only when you click Send to study/);
    expect(sends).toMatch(/Never any other search or page/);
    expect(sends).toMatch(/not into your account/);
    expect(sends).toMatch(/SEO Bandwagon’s AI Overview study/);
    // The export's Result stats column is the result count; the extension itself asks Google for nothing.
    expect(sends).toMatch(/related searches and People also ask questions, the result count, the AI Overview’s text/);
    expect(sends).toMatch(/and the extension never sends a request to Google itself\./);
    expect(sends).not.toMatch(/never a request to Google/i);
    expect(why).toMatch(/Google’s AI Overviews cite/);
    expect(`${sends} ${why}`).not.toMatch(/—/);
  });

  it('nothing until the person says yes, then ok, then nothing again once withdrawn', async () => {
    expect(await C.check('aioStudy')).toEqual({ ok: false, reason: 'not_accepted' });
    expect(await C.accept('aioStudy', Date.UTC(2026, 10, 3))).toBe(true);
    expect(local[C.STORAGE_KEY].aioStudy).toEqual({ acceptedAt: '2026-11-03T00:00:00.000Z', version: 1 });
    expect(await C.check('aioStudy')).toEqual({ ok: true });
    expect(await C.acceptance('aioStudy')).toMatchObject({ version: 1 });
    await C.withdraw('aioStudy');
    expect(await C.check('aioStudy')).toEqual({ ok: false, reason: 'not_accepted' });
    expect(await C.acceptance('aioStudy')).toBeNull();
  });

  it('on Chrome and Edge the yes alone decides: no Google results setting turns it on or off', async () => {
    await C.accept('aioStudy');
    local.serpSettings = { overlay: false, figuresOn: false, keywordsOn: false };
    expect(await C.check('aioStudy')).toEqual({ ok: true });
  });

  it('its yes is its own: figures and keyword data are not the study, and the study is not theirs', async () => {
    await C.accept('serpFigures');
    await C.accept('keywordData');
    expect(await C.check('aioStudy')).toEqual({ ok: false, reason: 'not_accepted' });
    await C.accept('aioStudy');
    await C.withdraw('aioStudy');
    expect(await C.check('serpFigures')).toEqual({ ok: true });
    expect(await C.check('keywordData')).toEqual({ ok: true });
  });

  it('on Firefox, the yes asks the browser for its three categories', async () => {
    const request = vi.fn(async () => true);
    globalThis.browser = { runtime: { getBrowserInfo: () => {} }, permissions: { contains: async () => true, request } };
    expect(await C.accept('aioStudy')).toBe(true);
    expect(request).toHaveBeenCalledWith({ data_collection: ['searchTerms', 'browsingActivity', 'websiteContent'] });
    expect(await C.check('aioStudy')).toEqual({ ok: true });
  });
});
