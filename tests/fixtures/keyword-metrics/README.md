# Saved answers of the keyword routes (extension 1.13.0)

Written by hand in the shape of the contract agreed with the website on
2026-11-02 for `POST /api/v1/keywords/metrics` (the add route's four answers
are written inline in the tests), for the extension's unit and e2e stubs.
The figures are made up; the tracked site is an example domain. Nothing
here came from a paid call.

- `done.json`: an uncached search: the paid lookups answered and the
  allowance counted it (`lookups: "done"`). The search (`best crm for
  nonprofits`, the commercial-query fixture's) first, then its related
  searches and People also ask questions as the extension normalizes them
  (lowercase, the "?" and "%" gone). `best crm for nonprofits in usa` has no
  figures (all null): blank, not zero.
- `cached.json`: the same figures, all from the site's cache
  (`lookups: "not_needed"`, nothing counted).
- `tracked.json`: cached, and the account's rank tracker tracks the search
  for `example.org`, with five weekly positions (9 to 4).
- `limit-reached.json`: the daily allowance used up: the search's cached
  figures only.
- `paused.json`: the site-wide monthly ceiling reached: nothing new.
