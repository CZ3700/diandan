# P5-05 coordinator review

Baseline: `fb89c3a4029083b6c6495dd8c581c1b2e4db88aa`. Only P5-05 is claimed. The original 5,958 untracked files and 70 historical SQL files were rehashed unchanged at the protection checkpoint.

## Findings addressed during implementation

- Managed draft documents and canonical routing tables must describe exactly the same channels, translations, rules and scopes. New deferred database assertions cover inserts, validation and publication; old migrations and guards remain unchanged.
- JSON checks must reject absent values, numeric strings, invalid array elements, duplicates and excessive cardinality. SQL and Zod checks were aligned and exercised against actual PostgreSQL.
- Publication and rollback need current account/merchant/health facts, immutable validation evidence and exact audits. Rollback cannot rely only on a lifecycle transition that happened during the original publication.
- An unchanged translation can inherit approval only from an actually published managed version for the same account and source lineage. Immutable copy proofs retain the original independent review chain. Changed text, an unpublished draft, no source and another account are rejected as approval-copy sources.
- Internal-only accounts cannot publish LIVE routes. `internal-live-red.log` contains the failing domain case; the corrected domain test passes.
- Replacing all routes can produce more differences than the size of either configuration. The response and domain result now allow up to 600 changes (100 channels + 200 routes on each side). `diff-capacity-red.log` / `diff-capacity-green.log` cover this limit.
- UI validation controls follow configure permission; publication follows publish permission. Lifecycle-specific controls avoid offering invalid operations on the current published version.
- A successful publish/rollback reply must identify a publication and a positive generation; other mutation replies must not identify a publication. Application, API and UI enforce the same distinction so an uncertain result retains its original idempotency key.
- Each node must bound database acquisition and query lifetime and recover after a failed refresh. The configuration transaction runner reuses the existing connection-destroying deadline adapter; no abandoned background transaction is accepted as cancellation.
- The initial empty dynamic deployment is distinct from invalid empty static payment registration. This boundary is covered without manufacturing an initial payment account.
- Retained account capacity now uses the same complete managed-history/deployment/incoming set for SAVE and READ. A refreshed health policy invalidates a just-claimed older probe before dispatch; PostgreSQL also rejects stale completion by generation/expiry.
- Newly published hosted payment origins are resolved through the current trusted directory when matching a response. Actual two-process HTTP exposed the stale initial allowlist; focused RED/GREEN and the independent persistence review confirmed the repair without accepting unknown origins.
- Spanish mobile navigation exceeded its fixed-width button in the actual font. Only the mobile grid column declaration changed; the complete browser runner now asserts text containment on every capture and retains strict axe checks.

## Local simplification

The code-simplifier skill was applied to the new domain validation and diff modules. Separate declarations make data selection and comparison easier to follow; public interfaces, ordering, authorization and runtime behavior are unchanged. Domain tests and formatting passed after this cleanup.

## Independent regressions observed

- `rollback-prefix-postgres-final.log`: 47 tests passed, including actual PostgreSQL rollback protection and all supported empty prefixes.
- `legacy-finance-http.log`: original financial HTTP suite passed 6,164 assertions (5,763 setup + 401 scenario) with native isolated PostgreSQL 18.6, real TLS OIDC/S3, Worker and persistent TEST PSP. The protocol's own summary counts 399 assertions; these are different scopes, not additive totals.
- `root-contract-compatibility.json`: all 679 previous schema roots and 113 previous OpenAPI paths were structurally unchanged at that checkpoint. The new total is 690 roots / 120 paths; final protection is checked again after freeze.

## Final combined acceptance

The final combined development gate passed (64 typecheck / 64 test / 36 build tasks). The accepted run `integration-2026-09-22T06-40-07.476Z` passed 6,660 actual integration assertions, including 313 protocol assertions and 466 browser assertions / 8 cases / 65 PNG / 65 axe with zero violations, incomplete checks or page errors. Separate API process IDs and their restart, locked-database recovery, original UNKNOWN account binding and no second TEST PSP acceptance were independently reviewed. TEST propagation uses a one-second polling fixture; the deployed default is ten seconds.

Root inspected the final Spanish mobile settings, Chinese mobile editor and English desktop settings images. Other representative scripts/long-language images and all browser counters were independently reviewed by the UI owner. The first incomplete Spanish run is retained, and the next complete run includes the text-containment regression assertion.

The final source manifest has 2,530 files and no delta after the final gate. All 5,958 original untracked files, 70 old SQL files, 35 manifest entries, 679 old contract roots and 113 old OpenAPI paths remain unchanged at the final protection checkpoint. The account-capacity and probe-race follow-ups are resolved. Final commit-time scan/staging results are recorded in `final-gates.json`; S.U.P.E.R evidence and exact scope are in `final-verification.md`.

P5-06's original local dependencies have an independent READY recommendation. P5-05 remains IN_PROGRESS with its external conditions and no executor under ADR-016. Formal merchant sandbox, real funds, approved production copy/identity and staging evidence remain outside the observed local results. No persistent complete local user experience, push or deployment is claimed.
