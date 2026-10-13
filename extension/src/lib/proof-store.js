// SEO Bandwagon — finished full-page proofs, kept until they're dismissed (#48)
//
// The service worker builds the image (src/lib/fullpage-runs.js) and the
// popup shows it, possibly after being closed and reopened, so the image has
// to live somewhere both can read. A proof is one Blob, often megabytes:
// chrome.storage.session holds 10 MB in all and only JSON, so it goes into
// the extension's own IndexedDB instead. Keys are per tab (SBWFullPageRuns.storeKey);
// the worker removes a tab's proof when it's dismissed, replaced, or the tab
// closes, and clears them all when the browser starts.
//
// Dual-export pattern (see src/lib/sync-state.js).

(function (factory) {
  var api = factory();
  if (typeof globalThis !== 'undefined') {
    globalThis.SBWProofStore = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  const DB_NAME = 'sbw-proofs';
  const STORE = 'proofs';

  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { dbPromise = null; reject(req.error); };
      });
    }
    return dbPromise;
  }

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    put: (k, blob) => run('readwrite', s => s.put(blob, k)),
    get: k => run('readonly', s => s.get(k)),
    remove: k => run('readwrite', s => s.delete(k)),
    clear: () => run('readwrite', s => s.clear())
  };
});
