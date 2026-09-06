// fix-1 item 1b (CRITICAL): the Search Console runner (src/content/gsc-serp.js)
// must ignore mutations it caused itself, or its MutationObserver-driven
// scan() loop never settles. These tests load the real runner script (fresh
// each time, bypassing its own `window.__seoBwGscSerpLoaded` load guard)
// against the real gsc-inject.js/gsc-compare.js libraries so the mutations
// it reacts to are the genuine ones those libraries produce.
import { describe, it, expect, beforeEach, vi } from 'vitest';

await import('../../src/lib/gsc-inject.js');
await import('../../src/lib/gsc-compare.js');

function buildReport() {
  document.body.innerHTML = `
    <div id="cards">
      <div role="button">Total clicks<div>1,230</div><div>vs</div><div>1,000</div></div>
    </div>
    <table>
      <thead><tr>
        <th>Top queries</th>
        <th>Clicks Last 3 months</th><th>Clicks Previous 3 months</th><th>Difference</th>
      </tr></thead>
      <tbody>
        <tr><td>roofing repair denver</td><td>1,230</td><td>1,000</td><td>+230</td></tr>
        <tr><td>plumber tacoma</td><td>500</td><td>1,000</td><td>-500</td></tr>
      </tbody>
    </table>`;
}

function setPerformancePath() {
  window.history.pushState({}, '', '/search-console/performance/search-analytics?resource_id=x');
}

async function loadRunner() {
  delete window.__seoBwGscSerpLoaded;
  // Cache-busting query param forces Vite to re-evaluate the module (and so
  // re-run its side-effecting IIFE) instead of returning the cached export.
  await import(/* @vite-ignore */ '../../src/content/gsc-serp.js?t=' + Math.random());
}

function frame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
function macrotask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('gsc-serp runner — Queries-only icons, compare math everywhere', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('on the Pages tab (breakdown=page) injects no row icons but still applies the compare math', async () => {
    buildReport();
    document.querySelector('th').textContent = 'Top pages';
    window.history.pushState({}, '', '/search-console/performance/search-analytics?resource_id=x&breakdown=page');
    const applySpy = vi.spyOn(window.SBWGscCompare, 'apply');
    await loadRunner();
    await frame(); await macrotask();
    expect(document.querySelectorAll('.' + window.SBWGscInject.ICON_GROUP).length).toBe(0);
    expect(applySpy).toHaveBeenCalled();
    applySpy.mockRestore();
  });

  it('on the Queries tab (breakdown=query) injects row icons and applies the compare math', async () => {
    buildReport();
    window.history.pushState({}, '', '/search-console/performance/search-analytics?resource_id=x&breakdown=query');
    const applySpy = vi.spyOn(window.SBWGscCompare, 'apply');
    await loadRunner();
    await frame(); await macrotask();
    expect(document.querySelectorAll('.' + window.SBWGscInject.ICON_GROUP).length).toBe(2);
    expect(applySpy).toHaveBeenCalled();
    applySpy.mockRestore();
  });
});

describe('gsc-serp runner — mutation-observer self-mutation guard', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.querySelectorAll('#seo-bw-gsc-styles').forEach((n) => n.remove());
    setPerformancePath();
    window.chrome = { runtime: { sendMessage: vi.fn() } };
  });

  it('settles within 3 animation frames (apply()/injectAll() stop being called again)', async () => {
    buildReport();
    const applySpy = vi.spyOn(window.SBWGscCompare, 'apply');

    await loadRunner();
    expect(applySpy.mock.calls.length).toBeGreaterThanOrEqual(1); // the synchronous initial scan()

    let lastCount = applySpy.mock.calls.length;
    let settledWithinFrames = -1;
    for (let i = 1; i <= 3; i++) {
      await frame();
      await macrotask();
      if (applySpy.mock.calls.length === lastCount) {
        settledWithinFrames = i;
        break;
      }
      lastCount = applySpy.mock.calls.length;
    }
    expect(settledWithinFrames).toBeGreaterThan(-1);

    // One more frame with no external changes: still nothing further fires.
    const finalCount = applySpy.mock.calls.length;
    await frame();
    await macrotask();
    expect(applySpy.mock.calls.length).toBe(finalCount);
  });

  it('does not react to a mutation confined to its own injected nodes', async () => {
    buildReport();
    await loadRunner();
    // Let the initial load settle first.
    await frame();
    await macrotask();
    await frame();
    await macrotask();

    const applySpy = vi.spyOn(window.SBWGscCompare, 'apply');
    const injectSpy = vi.spyOn(window.SBWGscInject, 'injectAll');

    const badge = document.querySelector('.seo-bw-cmp-pct, .seo-bw-cmp-badge');
    expect(badge).toBeTruthy();
    badge.textContent = 'poked directly by something else in the page';

    await frame();
    await macrotask();

    expect(applySpy).not.toHaveBeenCalled();
    expect(injectSpy).not.toHaveBeenCalled();
  });

  it('still reacts to a genuine external DOM change (a new GSC row)', async () => {
    buildReport();
    await loadRunner();
    await frame();
    await macrotask();
    await frame();
    await macrotask();

    const applySpy = vi.spyOn(window.SBWGscCompare, 'apply');

    const table = document.querySelector('table');
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>new query</td><td>10</td><td>5</td><td>+5</td>';
    table.tBodies[0].appendChild(tr);

    await frame();
    await macrotask();

    expect(applySpy).toHaveBeenCalled();
  });

  it('F2: a foreign mutation that lands while the runner is still injecting is not lost', async () => {
    buildReport();
    const compare = window.SBWGscCompare;
    const realApply = compare.apply.bind(compare);
    let injectedForeignRow = false;
    // On the second scan, GSC "re-renders" a new row synchronously while our
    // own scan is running (inside the `injecting` window). Before the fix this
    // mutation batch was dropped and the new row never got a badge cell.
    const applySpy = vi.spyOn(compare, 'apply').mockImplementation((root) => {
      realApply(root);
      if (applySpy.mock.calls.length === 2 && !injectedForeignRow) {
        injectedForeignRow = true;
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>new query</td><td>900</td><td>1,000</td><td>-100</td>';
        document.querySelector('table:not([data-seo-bw-compare]) tbody').appendChild(tr);
      }
    });
    await loadRunner();
    // Trigger scan #2 with an external change.
    document.querySelector('table:not([data-seo-bw-compare]) tbody td:nth-child(2)').textContent = '1,300';
    for (let i = 0; i < 4; i++) { await frame(); await macrotask(); }
    expect(injectedForeignRow).toBe(true);
    const newRow = [...document.querySelectorAll('tbody tr')].find((tr) => /new query/.test(tr.textContent));
    expect(newRow).toBeTruthy();
    expect(newRow.querySelector('.seo-bw-cmp-pct')).not.toBeNull();
    applySpy.mockRestore();
  });
});
