# Saved answers of the keyword routes (extension 1.13.0)

Written by hand in the shape of the website's `POST /api/v1/keywords/metrics`
at change `1d2ba972` (`src/lib/keyword-metrics/shape.ts`; the add route's
answers are written inline in the tests), for the extension's unit and e2e
stubs. The figures are made up; the tracked site is an example domain.
Nothing here came from a paid call.

Each result's `keyword` is echoed as the extension sent it: lowercase, its
punctuation kept (the site reads it in its own lookup form). `competition`
is Google Ads' 0 to 1, `fetchedAt` the day the figures were bought (null
without figures). The allowance is the route's starting free one (10).

- `done.json`: an uncached search: the paid lookups answered and the
  allowance counted it (`lookups: "done"`). The search (`best crm for
  nonprofits`, the commercial-query fixture's) first, then its related
  searches and People also ask questions. `best crm for nonprofits in usa`
  has no figures (all null): blank, not zero.
- `cached.json`: the same figures, all from the site's cache
  (`lookups: "not_needed"`, nothing counted).
- `tracked.json`: cached, and the account's rank tracker tracks the search
  for `example.org`, with five weekly positions (9 to 4).
- `limit-reached.json`: the daily allowance used up: the search's cached
  figures only, the rest null.
- `paused.json`: the site-wide monthly ceiling reached: no new figures.
- `unsupported-market.json`: a country DataForSEO has no keyword data for
  (`lookups: "unsupported_market"`): no figures, no market.
