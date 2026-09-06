// Unit tests for the pure user-agent-switcher preset/rule logic
// (src/lib/ua-switch.js). No chrome dependency here — the worker
// (service-worker.js) owns the actual declarativeNetRequest.
// updateSessionRules()/tabs.reload() calls; this module only knows the
// preset list and how to shape one DNR rule.

import { describe, it, expect } from 'vitest';

// Dual-export pattern (see src/lib/sync-state.js) — attaches to
// `globalThis.SBWUaSwitch` rather than an ESM default export.
await import('../../extension/src/lib/ua-switch.js');
const SBWUaSwitch = globalThis.SBWUaSwitch;

describe('SBWUaSwitch namespace', () => {
  it('attaches to globalThis.SBWUaSwitch', () => {
    expect(SBWUaSwitch).toBeTruthy();
    ['PRESETS', 'presetById', 'ruleIdForTab', 'ruleFor'].forEach(k => expect(SBWUaSwitch[k]).toBeDefined());
    ['presetById', 'ruleIdForTab', 'ruleFor'].forEach(fn => expect(typeof SBWUaSwitch[fn]).toBe('function'));
  });
});

describe('PRESETS', () => {
  it('includes Default (off), Googlebot Desktop, Googlebot Smartphone, Bingbot and iPhone Safari', () => {
    const ids = SBWUaSwitch.PRESETS.map(p => p.id);
    expect(ids).toEqual(['default', 'googlebot-desktop', 'googlebot-smartphone', 'bingbot', 'iphone-safari']);
  });

  it('gives every preset a label and a ua string, except default (ua: null = "off")', () => {
    SBWUaSwitch.PRESETS.forEach(p => {
      expect(typeof p.label).toBe('string');
      expect(p.label.length).toBeGreaterThan(0);
      if (p.id === 'default') {
        expect(p.ua).toBeNull();
      } else {
        expect(typeof p.ua).toBe('string');
        expect(p.ua.startsWith('Mozilla/5.0')).toBe(true);
      }
    });
  });

  it('identifies each crawler preset by its documented bot token', () => {
    const byId = Object.fromEntries(SBWUaSwitch.PRESETS.map(p => [p.id, p.ua]));
    expect(byId['googlebot-desktop']).toContain('Googlebot/2.1');
    expect(byId['googlebot-smartphone']).toContain('Googlebot/2.1');
    expect(byId['googlebot-smartphone']).toContain('Mobile');
    expect(byId['bingbot']).toContain('bingbot/2.0');
    expect(byId['iphone-safari']).toContain('iPhone');
  });
});

describe('presetById', () => {
  it('finds a known preset', () => {
    expect(SBWUaSwitch.presetById('bingbot').label).toBe('Bingbot');
  });

  it('returns null for an unknown id', () => {
    expect(SBWUaSwitch.presetById('nope')).toBeNull();
  });

  it('returns null for a missing id', () => {
    expect(SBWUaSwitch.presetById(undefined)).toBeNull();
  });
});

describe('ruleIdForTab', () => {
  it('is deterministic for the same tabId', () => {
    expect(SBWUaSwitch.ruleIdForTab(7)).toBe(SBWUaSwitch.ruleIdForTab(7));
  });

  it('differs across tabIds', () => {
    expect(SBWUaSwitch.ruleIdForTab(1)).not.toBe(SBWUaSwitch.ruleIdForTab(2));
  });

  it('is always a positive integer (DNR rule id requirement)', () => {
    expect(Number.isInteger(SBWUaSwitch.ruleIdForTab(42))).toBe(true);
    expect(SBWUaSwitch.ruleIdForTab(42)).toBeGreaterThan(0);
  });
});

describe('ruleFor', () => {
  it('returns null for a falsy ua (the "off" case)', () => {
    expect(SBWUaSwitch.ruleFor(5, null)).toBeNull();
    expect(SBWUaSwitch.ruleFor(5, '')).toBeNull();
    expect(SBWUaSwitch.ruleFor(5, undefined)).toBeNull();
  });

  it('builds a modifyHeaders DNR rule scoped to exactly one tab', () => {
    const ua = 'Mozilla/5.0 (compatible; Testbot/1.0)';
    const rule = SBWUaSwitch.ruleFor(5, ua);
    expect(rule.id).toBe(SBWUaSwitch.ruleIdForTab(5));
    expect(rule.priority).toBe(1);
    expect(rule.action.type).toBe('modifyHeaders');
    expect(rule.action.requestHeaders).toEqual([{ header: 'User-Agent', operation: 'set', value: ua }]);
    expect(rule.condition.tabIds).toEqual([5]);
    expect(rule.condition.resourceTypes).toEqual(
      expect.arrayContaining(['main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'stylesheet', 'image', 'font', 'other'])
    );
  });

  it('produces a rule usable end-to-end with presetById for a real preset', () => {
    const preset = SBWUaSwitch.presetById('googlebot-desktop');
    const rule = SBWUaSwitch.ruleFor(9, preset.ua);
    expect(rule.action.requestHeaders[0].value).toBe(preset.ua);
    expect(rule.condition.tabIds).toEqual([9]);
  });

  it('matches media requests too (MINOR 12)', () => {
    const rule = SBWUaSwitch.ruleFor(5, 'Mozilla/5.0 (compatible; Testbot/1.0)');
    expect(rule.condition.resourceTypes).toContain('media');
  });
});

// Fix round 1, MINOR 7: tabId validation moved here so it's unit-testable
// independent of the worker's chrome.* plumbing.
describe('isValidTabId', () => {
  it('accepts non-negative integers', () => {
    expect(SBWUaSwitch.isValidTabId(0)).toBe(true);
    expect(SBWUaSwitch.isValidTabId(42)).toBe(true);
  });

  it('rejects negative numbers, non-integers, and non-numbers', () => {
    expect(SBWUaSwitch.isValidTabId(-1)).toBe(false);
    expect(SBWUaSwitch.isValidTabId(1.5)).toBe(false);
    expect(SBWUaSwitch.isValidTabId('5')).toBe(false);
    expect(SBWUaSwitch.isValidTabId(null)).toBe(false);
    expect(SBWUaSwitch.isValidTabId(undefined)).toBe(false);
    expect(SBWUaSwitch.isValidTabId(NaN)).toBe(false);
  });
});
