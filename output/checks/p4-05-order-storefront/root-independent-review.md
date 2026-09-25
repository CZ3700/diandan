# P4-05 root implementation independent review

Reviewer: `/root/order_view` (not the author of the reviewed root controller, entry, route or checkout bridge files). Initial verdict: **CHANGES_REQUESTED — two P2 findings**. No P1 finding established in this review. This is a source/lifecycle review, not a replacement for the real-browser matrix.

Reviewed: `apps/storefront/src/order-entry.ts`, root layout and proxy; `storefront/order-controller.ts`, `order-client.tsx`, `order-feedback.tsx`, `order-fragment.ts`, `order-page-factory.tsx`; `checkout-order-result.tsx`, the checkout transport/client bridge; all 28 locale order page declarations. The separate order BFF/transport implementation was read to verify boundary behavior, but its independent owner/review remains separate.

## P2 — Normalize public UUIDs before controller scope comparisons

Location at the reviewed source: `apps/storefront/src/storefront/order-controller.ts:84`, with the same issue at grant comparisons near lines 116 and 167 and revoked comparison near 192.

The `publicOrderIdSchema` accepts uppercase UUIDs without normalizing them. The API and order transport correctly treat UUID scope case-insensitively, but the controller compares the canonical lowercase response to the original caller value with `===`. A fan pasting an uppercase order number into lookup therefore receives `TEMPORARY_UNAVAILABLE` after a valid authorized read. More seriously, changing only the non-secret `order` hint in an otherwise valid link to uppercase successfully consumes the one-use token and grants a cookie, then incorrectly displays `ACCESS_DENIED` because the returned UUID is lowercase.

Reproduction: the read-only `root-review-probe.mjs` transpiles the actual controller, injects a valid parsed `OrderAccessDetail` and a transport returning its canonical UUID, and exercises uppercase `read()` and `exchange()`. Both failures were reproduced. `root-review-probe.json` binds the tested source SHA-256 (`06457ade7c45236bb26e47b1794eb5ab2edd6fa6f31fc19a089b7fcef4021a34`). It does not log the test credential.

Requested fix: canonicalize a successfully validated UUID to lowercase at every controller entry, retain that canonical scope in state, and use consistent UUID comparisons for read/grant/revoke. Keep actual mismatched-order denial. Add explicit uppercase lookup, link-hint and revoke regression coverage.

## P2 — Retain the close-access operation after an uncertain revoke

Location at the reviewed source: `apps/storefront/src/storefront/order-controller.ts:178-180` and `:186-204`; automatic retry is also triggered by `order-client.tsx:73-82`.

`revoke()` hides the order while submitting, but an UNKNOWN or temporary failure loses the operation intent. `retry()` always performs a read. If the revoke request never reached the server and the cookie remains valid, either clicking the error's “Try again” or the next focus/60-second refresh fetches and displays the private order again instead of completing the requested close. Suspending/restoring the page also resets the close intent. The existing “never resurrects on a lost response” test checks only immediately after failure, so it misses the next retry.

Reproduction: the same read-only probe loads a valid order, makes revoke return UNKNOWN without changing server access, then calls retry. The order becomes visible again, and revoke was invoked only once. This is shown in `root-review-probe.json`.

Requested fix: retain a pending revoke intent independently from visible order state. Recovery may perform a protected read to refresh CSRF but must not render its order data; then retry revoke. Suspension/bfcache restoration must preserve that close intent, while disposal/unmount must still abort outstanding work. A definite rejection of current order access can terminate local recovery without displaying old data. Cover manual retry, auto refresh, and restoration with assertions that no intermediate snapshot contains the order and no checkout bootstrap occurs.

## Other reviewed boundaries

- The entry script runs synchronously before children/hydration, replaces the URL before exposing the one-time closure, wipes unclaimed values on pagehide or after 15 seconds, and refuses access when URL clearing fails. It does not place the token in storage or history state. The client deletes the entry function after taking it.
- Exchange does not replay the credential after an uncertain response. It recovers using the non-authorizing public ID plus the browser's protected cookie. A definite token rejection is not automatically treated as a fresh grant.
- Controller epochs plus abort/disposal suppress late state updates after scope changes or teardown. Deferred initialization avoids consuming the fragment during the first discarded StrictMode effect. Restoration uses a protected read rather than exchanging the token again.
- The checkout bridge first reads existing access and only bootstraps after ACCESS_DENIED for the exact original checkout. It validates the returned checkout/order binding and performs a second protected read. The `SUCCEEDED` hint only opens this canonical server workflow; it does not itself render a paid order or mutate payment state. Quote expiration alone does not prevent attempting canonical access.
- All 28 public route declarations have matching locale/mode/metadata factories and `force-dynamic`. The proxy strips spoofable locale/order-entry request headers and assigns its own. Protected HTML/API routes have no-store/noindex/no-referrer and blocked framing; order HTML script/connect policies exclude remote third-party script sources.
- Neither reviewed root page nor bridge renders fan private messages, full display names or contact email. Safe order pages render only the authorized read model. No static server-side private order fetch was introduced.

## Verification and limits

- `mise exec node@24.20.0 -- node output/checks/p4-05-order-storefront/root-review-probe.mjs`: exit 0, both defects reproduced against the bound controller source.
- Read-only route sweep: all 28 locale page declarations passed locale/mode/metadata/dynamic checks.
- Targeted entry/proxy/controller/fragment/page/checkout-bridge Vitest run: 30 passed, 3 failed. During this review, root added the three intended RED tests for the two accepted findings and revoke suspension; those exact expected failures are preserved in `root-review-existing-tests.log`. This is not a regression-free acceptance result.
- Real bfcache restoration, visibility changes during in-flight exchange/revoke, full cookie/header/body-loss behavior and viewport/keyboard/image checks require the integrated browser/API matrix being executed by `/root/order_browser`.
- A final re-review after fixes and final source/build validation is still required. No production, PSP, notification, manual translation or physical-phone conclusion is made here.
