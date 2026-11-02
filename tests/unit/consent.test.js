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
    expect(C.FLOWS.serpFigures.sends).toMatch(/Never your search terms, and never a request to Google/);
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
