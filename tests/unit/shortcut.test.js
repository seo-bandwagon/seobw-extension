// 1.13.8: the shortcut is handled (a refused popup tries the last focused
// window and never throws) and shown (src/lib/shortcut.js).
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';

await import('../../extension/src/lib/shortcut.js');
const S = globalThis.SBWShortcut;

describe('current and label', () => {
  it('reads the command, empty when cleared', async () => {
    const c = (shortcut) => ({ commands: { getAll: async () => [{ name: '_execute_action' }, { name: 'analyze-current', shortcut }] } });
    expect(await S.current(c('Ctrl+Shift+S'))).toBe('Ctrl+Shift+S');
    expect(await S.current(c(''))).toBe('');
    expect(await S.current({})).toBe(null);
    expect(await S.current({ commands: { getAll: async () => { throw new Error('x'); } } })).toBe(null);
    expect(S.label('⇧⌘S')).toBe('⇧⌘S');
    expect(S.label('')).toBe('Not set');
    expect(S.label(null)).toBe('Unknown');
  });

  it('is the manifest command', () => {
    const m = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
    expect(m.commands[S.NAME]).toBeTruthy();
  });
});

describe('openPopup', () => {
  it('opens the popup', async () => {
    const openPopup = vi.fn(async () => {});
    expect(await S.openPopup({ action: { openPopup } })).toBe(true);
    expect(openPopup).toHaveBeenCalledTimes(1);
  });

  it('a refusal tries the last focused normal window, focusing it', async () => {
    const openPopup = vi.fn(async (o) => { if (!o) throw new Error('no active browser window'); });
    const update = vi.fn(async () => {});
    const c = { action: { openPopup }, windows: { getLastFocused: async () => ({ id: 3, focused: false }), update } };
    expect(await S.openPopup(c)).toBe(true);
    expect(update).toHaveBeenCalledWith(3, { focused: true });
    expect(openPopup).toHaveBeenLastCalledWith({ windowId: 3 });
  });

  it('says false, and never throws, when it cannot open', async () => {
    const c = { action: { openPopup: async () => { throw new Error('x'); } }, windows: { getLastFocused: async () => { throw new Error('none'); } } };
    expect(await S.openPopup(c)).toBe(false);
    expect(await S.openPopup({})).toBe(false);
  });
});

describe('where it is shown', () => {
  it('Options and the popup load it and show it, with a way to change it', () => {
    const opt = fs.readFileSync('extension/src/options/options.html', 'utf8');
    expect(opt).toContain('src="../lib/shortcut.js"');
    expect(opt).toContain('id="shortcutKeys"');
    expect(fs.readFileSync('extension/src/popup/popup.html', 'utf8')).toContain('src="../lib/shortcut.js"');
    expect(fs.readFileSync('extension/src/popup/structured-data.js', 'utf8')).toContain('creditsShortcut');
    expect(fs.readFileSync('extension/src/background/service-worker.js', 'utf8')).toMatch(/SBWShortcut\.openPopup\(chrome\)/);
  });
});
