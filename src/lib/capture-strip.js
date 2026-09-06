// SEO Bandwagon — pure "what's safe to upload" stripper for a capture
// (fix round 1, item 3)
//
// The popup keeps the FULL analysis result in memory (`pageData` in
// src/popup/popup.js) so its export/copy buttons and highlight lookups
// always have the real data. Only the COPY handed to autoSaveCapture (and
// from there, syncCapture) goes through `strip()` first — never the
// in-memory object itself.
//
// Four fields carry page-authored TEXT (as opposed to a count derived from
// it) that Task 7 added for the popup's own CSV/copy exports, and none of
// them need to leave the device — only their counts do:
//   - headings.outline          (level/text/order for every heading)
//   - links.list                (url/anchor/rel/type for every link)
//   - links.nofollowAnchors     (url/text/rel for up to 50 nofollow/ugc/
//                                 sponsored anchors)
//   - images.list               (src/alt/hasAlt/lazy/width/height for
//                                 every image)
// schemaValidation is the one carried over from Task 5's fix round —
// property VALUES (not names) are stripped there, via SBWSchema's own
// stripForStorage, fail-closed (drop the whole block) if that helper isn't
// loaded. This module composes that existing behavior with the four new
// omissions rather than replacing it.
//
// meta.schema (fix round 2, item 1) is a FIFTH field in the same class,
// missed by Task 5's fix round because it isn't produced by SBWSchema at
// all: lib/dom-extraction.js's extractMeta() parses every JSON-LD <script>
// block on the page RAW — full property values included — for the score
// calculator's own "does this page have schema at all" check. The site
// never reads it (only `schemaValidation` is consumed —
// src/app/api/v1/captures/route.ts in the seobandwagon.com repo), so each
// block is reduced to `{ '@type', keys }` — its type(s) as declared and its
// sorted top-level property NAMES, never a value, never a nested object.
// A `@graph` array gets the same treatment one level down, under `graph`.
//

// Dual-export pattern (see src/lib/sync-state.js): attaches to
// `globalThis.SBWCaptureStrip` when loaded as a classic <script>, and
// exports via CommonJS when loaded by Vitest / Node.

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWCaptureStrip = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  function omit(obj, keys) {
    const copy = Object.assign({}, obj);
    keys.forEach(function (k) { delete copy[k]; });
    return copy;
  }

  function keysOf(obj) {
    return Object.keys(obj).sort();
  }

  // { '@type', keys } for one JSON-LD node — never the node's own values,
  // never a nested object. `@type` is passed through as found (a string or
  // an array of strings): it's the schema.org vocabulary type, not
  // page-authored content, same reasoning as keeping counts elsewhere in
  // this file.
  function reduceNode(node) {
    if (!node || typeof node !== 'object') return node;
    const out = { keys: keysOf(node) };
    if (Object.prototype.hasOwnProperty.call(node, '@type')) {
      out['@type'] = node['@type'];
    }
    return out;
  }

  function reduceSchemaBlock(block) {
    if (Array.isArray(block)) return block.map(reduceSchemaBlock);
    if (!block || typeof block !== 'object') return block;

    const out = reduceNode(block);
    if (Array.isArray(block['@graph'])) {
      out.graph = block['@graph'].map(reduceNode);
    }
    return out;
  }

  function strip(data) {
    if (!data) return data;
    let out = data;

    if (out.schemaValidation) {
      const stripFn = globalThis.SBWSchema && globalThis.SBWSchema.stripForStorage;
      if (!stripFn) {
        // Fail closed: without the stripper, drop the block rather than
        // persist page property values (privacy control — never silently
        // pass through).
        out = omit(out, ['schemaValidation']);
      } else {
        out = Object.assign({}, out, { schemaValidation: stripFn(out.schemaValidation) });
      }
    }

    if (out.headings && out.headings.outline) {
      out = Object.assign({}, out, { headings: omit(out.headings, ['outline']) });
    }

    if (out.links && (out.links.list || out.links.nofollowAnchors)) {
      out = Object.assign({}, out, { links: omit(out.links, ['list', 'nofollowAnchors']) });
    }

    if (out.images && out.images.list) {
      out = Object.assign({}, out, { images: omit(out.images, ['list']) });
    }

    if (out.meta && Array.isArray(out.meta.schema) && out.meta.schema.length) {
      out = Object.assign({}, out, {
        meta: Object.assign({}, out.meta, { schema: out.meta.schema.map(reduceSchemaBlock) })
      });
    }

    return out;
  }

  return {
    strip: strip
  };
});
