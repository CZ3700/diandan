# P4-05 root review — fixes verified

Reviewer: `/root/order_view`, independent of the controller/entry/checkout bridge implementation. Verdict: **ACCEPT for the reviewed source scope**. The two P2 findings in `root-independent-review.md` are resolved. That initial review, original defect probe and all RED logs are retained unchanged.

## Fix verification

- UUID scope is stored in lowercase and all read/grant/revoke comparisons use UUID-equivalent casing. Uppercase order-number input and link hints now succeed, while a genuinely different public order UUID is still rejected.
- The controller preserves a pending close-access intent. Recovery obtains fresh order CSRF using a protected read without exposing its order payload, then retries revoke. An access-denied read closes the local recovery state without displaying old data. Successful close blocks later automatic retry.
- `suspend()` clears the displayed order, invalidates in-flight responses and aborts its transport while retaining the non-secret close intent. `resume()` uses a fresh transport and continues closing when necessary. The page's visibility/pagehide handlers use suspension, while unmount/StrictMode cleanup still disposes all state. A late revoke result from the suspended generation cannot revive or overwrite the restored lifecycle.

`root-review-fixed-probe.mjs` transpiles the actual current controller and executes eight independent behavior checks using a schema-validated order and isolated transports. All eight passed:

1. Uppercase authorized read succeeds and stores canonical scope.
2. Uppercase link hint exchanges once and reads the original order.
3. Revoke succeeds after uppercase entry.
4. A different real order scope remains denied.
5. Unknown-revoke retry completes revocation with no intermediate order display.
6. Unknown-revoke suspend/resume likewise preserves close intent and keeps details hidden.
7. Lost current authority terminates local close recovery without another revoke or data restoration.
8. A late revoke response after suspension is ignored; resume completes the preserved close operation.

The probe result is `root-review-fixed-probe.json`, bound to controller SHA-256 `579b84b7e0f8e52496448b7212a4ccf81ca91cf53842c1016dbdf7d96c4d6861`.

## Fresh checks

- `mise exec node@24.20.0 -- node output/checks/p4-05-order-storefront/root-review-fixed-probe.mjs`: exit 0, eight checks passed.
- Storefront Vitest entry/proxy/controller/fragment/page/checkout-bridge suite: **6 files, 33 tests passed**, exit 0; `root-review-fixed-tests.log`.
- Root's original new regression cycle remains in `review-fixes-red.log` (three intended failures) and `review-fixes-green.log` (12 controller tests passed).

No further actionable P1/P2 issue was established in this scoped re-review. The unchanged entry-script privacy, canonical checkout authorization, DTO boundary and 28 locale page observations from the initial review still apply.

This acceptance is source-scoped. Final all-package validation and the real-browser/API matrix must establish bfcache/event timing, actual cookies and dropped responses, seven-language desktop/mobile rendering, keyboard/reduced-motion behavior and current final-source provenance. It does not establish production, PSP, notification, human translation or physical-device readiness.
