# P4-05 combined source review

Reviewer: `/root/order_bff`. Non-author review of root's entry/layout/proxy, page/controller/lifecycle and checkout bridge, plus the separate historical view and browser harness. The reviewer authored the order BFF/transport; its inclusion here is a compatibility review, not a claim of independent review of the reviewer's own implementation. Source was read only. No heavy check was run and no product source was modified.

**Verdict: ACCEPT for the reviewed source and integration scope. No new blocking P1/P2 finding was established. Final repository gates and delivery provenance remain root's responsibility. S.U.P.E.R item 10 is pending those final gates.**

## End-to-end boundaries checked

- The proxy removes incoming `x-storefront-order-access` and sets it only for the canonical locale exchange route. Root layout injects the fixed synchronous entry script before page children. The script clears fragment/query through `replaceState`, never adds the credential to history state, exposes a one-use memory closure, and wipes unclaimed data on pagehide or after 15 seconds. Fragment parsing accepts exactly one token and one non-authorizing public order UUID; malformed values do not reach exchange.
- Public order pages and the relevant BFF routes are private/no-store, noindex and no-referrer. Order HTML excludes remote script/connect sources and framing; the early script is fixed source rather than interpolated user content. The four locale page modes use the same factory and the existing source-owned shell.
- Exchange/bootstrap/read/revoke paths agree across the controller, browser transport, Next handlers and API contract. The browser never reads the order Cookie. BFF forwards no Cookie on exchange, only cart Cookie plus cart CSRF on bootstrap, and only order Cookie on read/revoke; order CSRF is required only for revoke. Fixed action/status/scope validation and strict canonical Cookie/expiry/retry handling prevent an unrelated response from becoming a visible order.
- Checkout `SUCCEEDED` only starts canonical order-access resolution. The bridge first tries an existing protected read; only a denied read permits a fresh exact-checkout read and cart-authorized bootstrap. The canonical checkout response must bind its order ID, and grant/read results bind the intended public order ID again. The final page is reached only after a valid authorized historical READ. An expired quote is not itself treated as a failed paid order, and this UI never writes financial state.
- Recovery from an uncertain exchange uses the already-known public ID with the browser Cookie; it does not retain or replay the one-use token. A definite exchange rejection is returned before any immediate recovery read. Subsequent ordinary protected reads still require the existing Cookie and do not renew a session or manufacture a grant.
- Controller epochs, transport sequence checks and abort/disposal suppress late data and CSRF updates. A fresh lifecycle uses a fresh transport. Hiding/pagehide suspends and clears visible detail; resume reauthorizes. Unmount disposes. The read-only view consumes only historical DTO data and separates payment/order/dispute/fulfillment state from the single factual creation timestamp.

## Previous findings and fixes

- UUID casing: current controller SHA-256 is `579b84b7e0f8e52496448b7212a4ccf81ca91cf53842c1016dbdf7d96c4d6861`, matching the independently tested fixed probe. Scope state is canonical lowercase; read, grant and revoke comparisons are UUID-case equivalent. Actual mismatched orders remain denied. The public route/transport schemas agree with this behavior.
- Pending revocation: `closing` survives an uncertain result and suspension. Retry/resume performs a protected read only to recover CSRF and never applies that intermediate order to visible state; it then retries revoke. Lost current access ends local close recovery. Confirmed close prevents periodic/focus read resurrection. The fixed probe has eight passing checks, including late-reply suppression during suspension, and its source hash still matches the reviewed controller.
- Browser evidence privacy: all failure capture paths now use `captureFailure`, which checks canary text and skips the screenshot if unsafe or unavailable. The original unconditional failure image path is gone.
- Browser language switching: the actual header menu now switches one authorized Portuguese order through Japanese, Simplified Chinese and Portuguese. The test checks the equivalent thank-you route, exact historical DTO and unchanged Cookie, while the surrounding observer and financial fingerprints detect grant/financial side effects. This supplements the fourteen locale/viewport render combinations without pretending every locale-switch pair was exercised.

## Browser evidence: failed runs remain failed

At assignment the fourth run was active; it completed while this read-only review was underway. The following statuses were read from each run's own JSON, not inferred from partial console output:

| Run directory suffix | Result and scope |
| --- | --- |
| `19-41-23.454Z` | FAIL, 6,588 assertions; 1 recorded case and 5 screenshots. The keyboard traversal assertion failed. Earlier checkout success within this run is partial evidence only. |
| `19-48-43.026Z` | FAIL, 7,268 assertions; 17 recorded cases and 48 screenshots. The browser stopped in the DAILY/response-loss stage. The seven-locale prefix is not a complete-run pass. |
| `19-53-18.504Z` | FAIL, 7,290 assertions; 18 recorded cases and 50 screenshots. A TimeoutError occurred at `order-storefront-recovery.mjs:23:44` while waiting for the actual read-failure error state. Its 2,137-input before/after record says unchanged source; that does not change the FAIL status. |
| `19-58-10.496Z` | PASS at `2026-09-15T20:00:39.260Z`: 7,373 assertions = 6,187 setup + 1,186 browser; 25 cases, 55 screenshots, 55 axe results with zero violations and zero incomplete. Browser closed and the financial-state fingerprint remained unchanged. |

The fourth run's 2,138-input manifest has SHA-256 `a15c17cb5a910109b2aa92cd65de3425d9e21094507914db3203df0ec2be470c`; its after record reports no byte changes. Its native Back case records `navigation.type = back_forward` and `pageshow.persisted = false`. Thus actual native Back reloading and API reauthorization passed; **a real bfcache restoration was not observed**. Explicitly enabling browser bfcache is not proof of a cache hit. Unit/probe suspension tests are separate evidence and do not replace that browser fact.

The browser result also explicitly retains `actualPspSandbox = false`, `physicalDeviceEvidence = false` and `humanTranslationReview = false`. It uses the source-owned independent TEST PSP with real local PostgreSQL/S3/HTTP/worker; it is not a merchant, physical-phone or production acceptance result.

## Collector dependency scope correction

The only existing input files changed after the fourth browser freeze, verified against its before manifest, are:

1. `scripts/verify-ui-composites-browser.mjs`: one added fingerprint path for `apps/storefront/src/order-entry.ts`, now imported by the root layout.
2. `scripts/verify-ui-composites-browser.test.mjs`: a temporary-repository test requiring inclusion of that dependency and a changed digest after its bytes change.
3. `scripts/verify-ui-motion-browser.test.mjs`: the analogous regression; the motion collector already covers the complete storefront source directory, so its implementation did not change.

This is an evidence-input correction, not a product behavior change. `collector-input-red-result.json` records the selected dependency test exit 1; `collector-input-green-result.json` records the full two-file Node suite exit 0 in 2.846 seconds. Both retained their original command/timing evidence. P2-04/P2-05 collector refreshes and the final original repository check are still owned by root; their completion is not asserted here.

## S.U.P.E.R checks 1–9

| Item | Result and concrete basis |
| --- | --- |
| 1 — Single purpose per module | PASS: entry captures/clears the fragment; parser validates it; controller coordinates access state; transport owns bounded requests; BFF modules separately validate route credentials and cookies; detail/status modules render historical facts. |
| 2 — Single conceptual responsibility per function | PASS: checkout orchestration obtains canonical access; `load` applies an authorized read; `closeAccess` completes revocation; `orderStatusRows` maps independent axes; Cookie and response validators enforce their respective boundaries. |
| 3 — One-way dependency flow | PASS: browser/controller → local BFF → existing API/application. UI imports contracts and shared presentation components, with no persistence/provider dependency or direct database/financial mutation. |
| 4 — No circular imports | PASS in the reviewed graph: controller → transport → pure validation/I/O; page → controller/detail/feedback; checkout bridge → checkout/order transports. Checkout transport's order dependency is type-only and the order transport does not import checkout. |
| 5 — Contract-defined interfaces | PASS: frozen `OrderAccessResponse`, `OrderAccessDetail`, request schemas, UUID/token schemas and typed `OrderReply`/`OrderSnapshot`; BFF and browser validate the same fixed operation/result protocol. |
| 6 — Serializable data | PASS: request/response and visible state contain DTO data, fixed error vocabulary, times and booleans. In-process lifecycle callbacks/ports remain functions by design; raw credentials stay in transport/short-lived entry memory and are absent from the public order DTO. |
| 7 — Environment/config boundaries | PASS: public/internal API origins use existing server configuration; locale authority is the shared contract; endpoint paths are fixed protocol paths. Security budgets are bounded constants, not hardcoded production brand, market, currency, merchant or secret values. |
| 8 — Explicit dependencies | PASS: implementation uses existing declared workspace packages, React/Next/Web APIs and existing test tools. No new dependency version or lockfile change is needed. |
| 9 — Replaceable components | PASS: transport factory injection permits controller tests without network; server fetch injection isolates BFF behavior; historical view is driven by the frozen DTO and can be replaced without changing API/application state rules. |
| 10 — All final checks pass | PENDING root's final frozen-source repository gates, refreshed collectors and delivery validation. This source review is not a substitute. |

The thirteen BFF/transport source files still match every hash in `bff-validation.json`. No source modification, new task claim, Git operation or release action was performed by this review.
