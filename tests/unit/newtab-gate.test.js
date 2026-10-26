// Whether a new tab shows the SEO Bandwagon dashboard or Chrome's own new tab
// (1.9.5): the dashboard is for people who installed Neon Night or Neon Day.
import { describe, it, expect } from 'vitest';

await import('../../extension/src/lib/newtab-gate.js');
const G = globalThis.SBWNewTabGate;

const IDS = { dark: 'bomhiblgnbmpgbddhocomnbijdkmpbhl', light: 'ldifldabjbffldoekbebpickddaiiggm' };
const theme = (o) => ({ type: 'theme', enabled: true, id: 'x'.repeat(32), name: 'Some Theme', ...o });

describe('themeModeFrom', () => {
  it('finds Neon Night or Neon Day by its store id', () => {
    expect(G.themeModeFrom([theme({ id: IDS.dark })], IDS)).toBe('dark');
    expect(G.themeModeFrom([theme({ id: IDS.light })], IDS)).toBe('light');
  });

  it('finds an unpacked copy by its name', () => {
    expect(G.themeModeFrom([theme({ name: 'SEO Bandwagon — Neon Night' })], IDS)).toBe('dark');
    expect(G.themeModeFrom([theme({ name: 'SEO Bandwagon — Neon Day' })], IDS)).toBe('light');
  });

  it('ignores other themes, disabled themes and non-themes', () => {
    expect(G.themeModeFrom([theme({})], IDS)).toBeNull();
    expect(G.themeModeFrom([theme({ id: IDS.dark, enabled: false })], IDS)).toBeNull();
    expect(G.themeModeFrom([{ type: 'extension', enabled: true, id: IDS.dark, name: 'x' }], IDS)).toBeNull();
    expect(G.themeModeFrom([], IDS)).toBeNull();
    expect(G.themeModeFrom(undefined, IDS)).toBeNull();
  });
});

describe('decide', () => {
  it('shows the dashboard with a Neon theme by default, and Chrome\'s new tab without one', () => {
    expect(G.decide(undefined, 'dark')).toBe('dashboard');
    expect(G.decide('theme', 'light')).toBe('dashboard');
    expect(G.decide('theme', null)).toBe('chrome');
  });

  it('follows the setting when it is Always or Never', () => {
    expect(G.decide('always', null)).toBe('dashboard');
    expect(G.decide('off', 'dark')).toBe('chrome');
  });

  it('treats an unknown setting as the default', () => {
    expect(G.decide('bogus', null)).toBe('chrome');
    expect(G.decide('bogus', 'dark')).toBe('dashboard');
  });
});

describe('shouldPrompt', () => {
  it('asks for a theme only when the default setting found none and it was not dismissed', () => {
    expect(G.shouldPrompt({ setting: undefined, themeMode: null, dismissed: false })).toBe(true);
    expect(G.shouldPrompt({ setting: 'theme', themeMode: 'dark', dismissed: false })).toBe(false);
    expect(G.shouldPrompt({ setting: 'theme', themeMode: null, dismissed: true })).toBe(false);
    expect(G.shouldPrompt({ setting: 'off', themeMode: null, dismissed: false })).toBe(false);
    expect(G.shouldPrompt({ setting: 'always', themeMode: null, dismissed: false })).toBe(false);
  });
});

describe('constants', () => {
  it('hands over to Chrome\'s own new tab page', () => {
    expect(G.CHROME_NEW_TAB_URL).toBe('chrome://new-tab-page/');
    expect(G.SETTINGS).toEqual(['theme', 'always', 'off']);
  });
});
