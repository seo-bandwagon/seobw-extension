# Saved answers of POST /api/v1/serp/metrics

Written by hand in the shape of the website's route at change `38ac1980`
(`src/app/api/v1/serp/metrics/route.ts`, `src/lib/serp-metrics/shape.ts`
and the route's tests), for the extension's unit and e2e stubs. The
figures are made up; the hosts are example domains. Nothing here came
from a paid call.

- `done.json`: an uncached search: the paid lookups answered and the
  allowance counted it (`lookups: "done"`). The second result is a row
  Google hid from a signed-out user, sent with `url: null`, so its `page`
  is null and its site's figures come back.
- `limit-reached.json`: the daily allowance used up: cached figures only.
- `paused.json`: the site-wide monthly ceiling reached: cached figures only.
