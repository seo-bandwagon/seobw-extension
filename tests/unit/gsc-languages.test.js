// Search Console in other languages (1.11.0, src/lib/gsc-inject.js): the
// Queries tab is known by its name in each language, other tabs are not
// taken for it, and Search Console's own row actions are left out of the
// query.

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';

const G = require('../../extension/src/lib/gsc-inject.js');

function view(tabLabel) {
  const doc = new JSDOM(`<!doctype html><body>
    <div role="tab" aria-selected="true">${tabLabel}</div>
    <table><tr><th>x</th></tr><tr><td>plumber austin</td><td>12</td></tr></table></body>`).window.document;
  return G.isQueriesView({ search: '', hash: '' }, doc.body);
}

describe('the Queries tab in Search Console\'s languages', () => {
  it.each(['Queries', 'Suchanfragen', 'Requêtes', 'Consultas', 'Query', 'Zoekopdrachten', 'Zapytania', 'Sökfrågor', 'Forespørgsler', 'Kyselyt', 'Sorgular', 'クエリ'])(
    'knows %j as Queries', (label) => { expect(view(label)).toBe(true); });

  it.each(['Pages', 'Seiten', 'Páginas', 'Pagine', 'Strony', 'Länder', 'Pays', 'Geräte', 'Appareils', 'ページ', '国', 'デバイス'])(
    'does not take %j for Queries', (label) => { expect(view(label)).toBe(false); });
});

describe('Search Console\'s row actions in other languages', () => {
  it.each(['Kopieren', 'Copier', 'Copiar', 'Öffnen', 'Ouvrir', 'Inspeccionar'])('skips a title that reads %j', (label) => {
    const doc = new JSDOM(`<!doctype html><body><table><tr><td><span title="${label}">x</span><span>plumber austin</span></td></tr></table></body>`).window.document;
    expect(G.extractQuery(doc.querySelector('td'))).toBe('x');
  });
});
