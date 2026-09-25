# Fixed dummy Chrome route-teardown paired diagnostic

Scope: one owned loopback HTTP server, fixed `{ok:true}` JSON, Chrome 153.0.8010.53, no business application, database, credentials or private fixtures. Executed once with `mise exec node@24.20.0 -- node output/checks/p6-01-regression/finance-route-teardown-probe-1/probe.mjs`; exit 0. Script SHA-256: `d27402af31a8b9433c68e40a2d7099a916add2423969599ff42379ea7933bc20`.

Each case first intercepted a refund POST with `route.fetch()` followed by `route.abort()`, then continued the retry. The page started a semantic orders-detail POST after the retry response. The server held the read response. A removed the last route while that read was in flight and then released the response; B released the response, waited for the unchanged 5,000 ms outstanding-read gate to reach zero and the page fetch to resolve, and only then removed the route.

All 10 paired cases (20 total) completed: each read returned HTTP 200, produced exactly one requestfinished event whose Set deletion succeeded, and left zero outstanding reads. A finished in 0.954–4.890 ms from request start; B in 0.591–4.670 ms. No requestfailed or unmatched read occurred. The report's `pendingAtTeardown` field is sampled at the common held-response branching point for BOTH modes; for B it is not a measurement at its later unroute call. The source's B branch performs unroute only after both waits.

Result: NOT_REPRODUCED; the original final-8 financial-browser timeout cause remains UNKNOWN. This probe cannot establish that waiting before unroute fixes the original failure. The simplified page omits React refresh/remount, real BFF processing and full-suite history; it only tests the specified held-response last-route hypothesis. No timeout, tracking, source implementation or original evidence was changed.

`report.json` records safe fixed endpoint paths, POST method, local ordinals, phase, status and elapsed values only. `cleanedUp=true`; each owned context, the browser, and the owned server connections/listener were closed in finally. The command exited, and root was notified it could start the operations rerun.
