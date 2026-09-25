# P4-05 final independent evidence review

Reviewer: `/root/order_bff`. This closes the final-gate reservation in `combined-review.md`. Source and result files were read only; no implementation changes or repeated heavy checks were made. The reviewer is independent of root's controller/entry/checkout implementation and the historical view/browser harness; the reviewer's own BFF/transport received root's separate source review as recorded in `final-verification.md`.

**Verdict: ACCEPT for the local P4-05 technical delivery. S.U.P.E.R items 1–9 retain the concrete acceptance in `combined-review.md`; item 10 now passes on the observed final repository results. No open blocking source finding remains from these reviews.**

## Original full check verified

`check-full-1-result.json` records the original command `mise exec node@24.20.0 -- corepack pnpm check`, started at `2026-09-15T20:06:30.364884+00:00`, completed at `2026-09-15T20:35:28.036400+00:00`, **exit 0 in 1,737.580 seconds**. Root's package-script diff adds only the separate order-browser entry and does not replace or shorten `check`.

The actual log confirms the completed sequence, including:

- PostgreSQL round trip: 28 migrations / 172 tables; original catalog, authoring, publication, storefront, cart and checkout protocols pass.
- Payment runtime 6,562 assertions; order payment 6,827; protected order access 6,860; real media worker PostgreSQL/TLS S3 recovery 423 assertions.
- Final format check passes; typecheck **61/61 (59 cached)**, tests **61/61 (59 cached)** and build **36/36 (34 cached)** pass; the adapter-boundary check and **32 actual Node package exports** pass.

This is a single completed full-check result. It is not described as a cold-cache run, and the earlier development/browser failures have not been erased or relabelled.

## Final-source identity and protection

I compared the full `files` arrays in `source-final.json` and `source-after-check.json`, independently recomputed the declared compact-JSON manifest hash, and rehashed every listed current on-disk source file. All **2,131 entries** match; there are **zero current byte differences**. The shared SHA-256 is:

`6e746b77a95fefd3b771e8603bcaed361a6fa54e55bffa2a6c1d320753072176`

`compatibility-and-protection.json` records PASS for the same source hash and base commit `ae625e168bf11ec392bc3f8962f8af7145538680`: 573 existing contract roots, 96 API paths, 180 components, 56 historical SQL files and 2,412 initial untracked files, with empty changed-item arrays. The lockfile has no diff. Commit creation and post-commit Git-object equality are root's delivery step, not a result asserted by this review.

## Other final evidence

- The P2-04 second collector run exits 0 in 28.002 seconds (`composites-final-2-result.json`), and its log ends with browser-verification success. P2-05 exits 0 in 38.281 seconds (`motion-final-result.json`) with its matching successful log. The original P2-04 workspace-state guard failure remains recorded; its complete status diff was not captured, so only the documented known concurrent output additions and unchanged source bytes are claimed.
- `secrets-final-result.json`: secret scan exit 0 in 27.138 seconds. `audit-final-result.json`: official npm-registry high-level audit exit 0 in 0.700 seconds; its log states no known vulnerabilities. These do not constitute a broader production security certification.
- The fourth order-browser run remains PASS: 7,373 assertions, 25 cases, 55 screenshots and 55 axe results with zero violations/incomplete. Its product source is preserved in the final source. The only shared input changes after that browser run were the three collector dependency-scope/test files, as recorded in `browser-to-final-source-delta.json`; those tools subsequently passed their tests and refreshed collectors.
- Browser runs one, two and three remain FAIL with their original results. Native Back reloading and API reauthorization passed, but `pageshow.persisted` was false: no actual bfcache hit was demonstrated. The unit/lifecycle probe evidence remains separate.

## Acceptance limits retained

This acceptance covers the authorized local P4-05 checkout-to-canonical-order, protected access and seven-language historical presentation work. It does not imply whole-Phase-4 closure or a production release.

- TEST PSP evidence is source-owned/local; real merchant credentials, real PSP sandbox/small-value payment, staging/cloud/production and new physical-device evidence remain outside this result.
- Notification delivery belongs to P4-06. The interface does not claim that mail was sent. Preparation estimates still require approved operational SLA; future PREPARING/DELIVERED event times must come from actual recorded events, not the present status display.
- Human translation approval, read-aloud/accessibility review and the earlier P3 performance/manual gates remain open. Existing P2 collector manual/physical-device limitations also remain unchanged.
- The browser's JSON-loss scenario is an injected response-body loss with received Cookie headers, not a claim of an end-to-end physical TCP disconnect. Natural environment timing issues documented in earlier phases are not declared universally solved by this successful run.
- Local commit only: this review does not claim a GitHub push, PR, merge, deployment or public release.

S.U.P.E.R item 10 is therefore accepted for this bounded local technical scope, using the observed full-check/collector/browser results and identical final source, while all external and future-task limits above remain explicit.
