# P5-06 local dependency readiness — READY recommendation

Reviewer: `/root/refund_admin_audit`, 2026-09-22. Read-only assessment; no task is claimed and no progress status is changed.

## Current conclusion

P5-06's original dependencies remain **P5-01, P1-06 and P5-03**. Their accepted local implementations provide the required identity/authorization, verified durable event processing, and financial reconciliation inputs. ADR-016 permits P5-06 to consume these independently accepted local results, with Lane D free and root explicitly recording the next scope. The final P5-05 candidate now has actual PostgreSQL, current configuration/old finance HTTP, complete seven-language browser, final root gates and source protection evidence. This independent review therefore recommends **READY for P5-06 local development**, once root records the scope and releases Lane D. No executor is assigned by this report; the root remains responsible for task status.

P5-05 is part of the agreed local sequence, not a newly invented direct dependency. This report does not claim the production/merchant parts of P5-03 are DONE, or unlock all Phase 6/7 tasks.

## Original dependency evidence

- **P5-01:** `output/checks/p5-01-admin-access/final-verification.md` records full local OIDC/session/RBAC/MFA/CSRF, append-only audit, actual PostgreSQL, 859 protocol checks, 537 browser assertions / 21 cases / 34 images, seven languages/two viewports, and full original management regression. It also explicitly preserves production IdP, real MFA/people onboarding, formal UAT and real-device requirements. P5-03's final accepted source and native OIDC/browser run additionally cover the unchanged local identity path.
- **P1-06:** `docs/progress/phase-1-contracts.md` P1-06 DONE evidence records exact raw-byte signature verification before parsing, endpoint/account/environment binding, encrypted retained payload, durable inbox/outbox and effect receipts, pg-boss retries/DLQ, concurrent duplicate delivery, rollback and commit-before-ACK replay. Original final local full gate, actual PostgreSQL/pg-boss, clean clone and PR Quality/Security passed. Its original limitation explicitly leaves **administrative query/manual replay** to P5-06 and does not claim a cross-database/network exactly-once guarantee.
- **P5-03:** `output/checks/p5-03-refund-operations/final-verification.md`, `final-gates.json` and final accepted `output/checks/p5-03-finance/integration-2026-09-21T21-48-01.614Z/` record complete local cancel/full/partial refund/dispute/reconciliation, pending-amount reservation, permanent idempotency, authenticated original-account evidence, current identity permissions and audit, actual PostgreSQL, HTTP399 and browser330/9 cases/58 images with zero axe violations/incomplete/page errors. The terminal financial facts and pending fulfillment hold remain authoritative. Real merchant sandbox refund/real funds/staging are still external conditions, not waived by P5-06.

## Current source comparison and what changed

`next-stage-source-compare.json` independently hashes selected inputs against the **accepted P5-03 final** source manifest:

| Input group        | Same / selected | Interpretation                                                                                                                                                                                                        |
| ------------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity           | 19 / 19         | Current selected identity adapter/session/BFF/0030 inputs match P5-03's accepted source, including the then-accepted TEST IdP hook. This is not a claim that all 19 still match the older P5-01 snapshot.             |
| Reliable events    | 31 / 31         | Selected ingress/process/outbox/pg-boss/reliable-event contracts and fixtures are unchanged from the latest accepted baseline.                                                                                        |
| Finance            | 79 / 79         | Selected admin-finance/finance-evidence/management-finance/0035 inputs are unchanged.                                                                                                                                 |
| Shared integration | 0 / 11          | Intentional changes add payment configuration registration and the same management center's payment section, dynamic action-origin/health reads and the mobile navigation fix. These require new regression evidence. |

The changed integration inputs are API bootstrap, payment-runtime route/composition, PostgreSQL aggregate composition, Admin BFF operations, center/hub/access/shell/workspace and the shared center stylesheet. The latter changes only the mobile navigation column declaration after a real Spanish text overflow/axe failure. The payment route now reads the current static-deployment-bound action-origin directory for each response; an independent targeted run passes its new/old origin and unknown-origin rejection tests. New migration **0036** introduces managed configuration records, current-permission/receipt/audit guards, immutable documents/review copy proofs and activation-bound health-policy transitions. It attaches guards to existing payment configuration/health tables. An unchanged old migration file or old finance hash does **not** establish that these newly installed triggers are compatible with existing operations.

The final comparison was refreshed after successful complete acceptance and cleanup. Every selected current dependency/integration file and both new 0036 migrations match root's accepted `candidate-source-final.json`. Its SHA-256 is recorded in `next-stage-source-compare.json`; no source change was made by this review.

## Closure evidence in this round

1. Actual PostgreSQL migration up/down/up, baseline/catalog constraints and 0036 direct-SQL rejection/receipt/review/publication/health activation checks.
2. Real current HTTP/TEST PSP exercise of old UNKNOWN original-account recovery across configuration publication, routing and restoration; state/effect/receipt counts must establish no duplicate financial side effects.
3. Current bootstrap and composition tests, independent root quality gates and the complete seven-language/two-viewport management configuration browser run. Browser is Next development + TLS, production build a distinct check.
4. Final source/old-contract/old-migration protection comparison, safe secret scan and independent review. No unverified broad claim that every historical standalone PG/S3/queue script was rerun.

Items 1–4 now have the following evidence, read by this reviewer:

- `storage-final.log`: actual native PostgreSQL verification passes **151 checks**. Its connection timeout line is the exercised bounded transaction-timeout condition; the final result is `passed: true`. Root's rollback-prefix run passes **47 tests**, including retained audit/copy-proof protection and safe empty-prefix rewind.
- Final `integration-2026-09-22T06-40-07.476Z/protocol.json`: **HTTP313 PASS**, two independent processes observe publication/restoration; published B accepts new payment creation while the old UNKNOWN attempt recovers through A; failed refresh keeps the previous snapshot and locked refresh is bounded. The full combined runner passes **6,660 checks** with exit 0 and cleanup.
- Its browser result: **466 passing assertions / 8 cases / 65 screenshots**, full seven-language 390×844 + 1440×900 matrix, independent reviewers including English, readonly roles, navigation refresh, network recovery, routing-only genuine approval inheritance, and original-key PUBLISH/ROLLBACK replay after lost responses. All **65 axe analyses have zero violations and zero incomplete checks; page errors are empty**. The actual browser uses Next development + TLS; root separately passes production build.
- `check-dev-final.log`: **64/64 typecheck, 64/64 test and 36/36 build tasks pass** (62/62/34 cached). `protection-final.json`: **2,530 source files**, no delta since the final gate, all 70 old SQL files and 35-entry migration prefix unchanged, all 679 prior schema roots / 113 prior API entries unchanged, and 5,958 protected prior untracked files unchanged. Final staging/secret/commit recording is root's remaining administrative closure, not a source dependency gap.

Independent source tests in this subtask additionally pass 25 domain + 9 application + 12 API tests, 6 dynamic action-origin route tests, and 21 Admin test files / 68 cases with typecheck/lint. These were not substituted for actual execution above.

## Current-round regression now observed

Root ran the unchanged full native financial HTTP protocol against the current shared registration and migration 0036: `output/checks/p5-03-finance/integration-2026-09-22T06-11-28.869Z/`. This reviewer read `protocol.json` (PASS, 399 protocol assertions) and `scope.json`; root reports exit 0 and total 6,164 checks = 5,763 setup + 401 scenario checks, including runtime checks outside the protocol counter. It uses actual native PostgreSQL, TLS OIDC/S3 and the independent persistent TEST PSP, without Next/browser. Log: `output/checks/p5-05-payment-configuration/legacy-finance-http.log`. This is current-round evidence for duplicate/UNKNOWN/refund/cancel/dispute/event-ordering behavior, not a claim that every historical standalone reliable-events/DLQ runner was repeated.

This reviewer also read `rollback-prefix-postgres-final.log`: the actual PostgreSQL protection run passes all 47 tests, with zero failed/skipped tests, including retained configuration-copy/audit refusal and preserving login/audit history while rewinding only empty known prefixes. The final selected source comparison now matches the frozen combined gates; no old migration hash is used as a substitute for execution. Current configuration HTTP/UI acceptance is complete. The shared stylesheet changed only its mobile navigation columns, with an actual Spanish failure retained and the final seven-language matrix passing; this does not alter fulfillment, identity or event processing.

## P5-06 implementation boundaries after root opens the task

- Build one simple management-center **operations/inbox** area using dedicated schema-versioned contracts and fixed BFF commands. Coordinate center/hub/shell and shared API bootstrap ownership before editing.
- Query safe webhook, DLQ, UNKNOWN payment and notification-failure metadata. Private retained raw data must remain separately authorized/audited and excluded from lists, logs, screenshots, queue payloads and general API responses.
- Manual replay is a new audited authorization/confirmation/reason/idempotency operation; it must reuse existing verified event identity, transaction/effect receipts and original order/payment/refund account binding. It cannot let an operator upload unsigned provider evidence, set payment success, release UNKNOWN money, or recreate a refund blindly.
- Re-run the full existing handler safety on replay; duplicate or delayed events must not duplicate refunds, fulfillment transitions, notifications or outbox effects. External delivery remains at-least-once with stable provider idempotency.
- Do not weaken message approval, pending refund/dispute fulfillment holds, TTL/MFA/CSRF, notification consent, privacy or seven-language critical-copy review to make the local demonstration easier.
- Full persistent storefront/upload/cart/TEST-payment/order/refund preview is a separate readiness checklist in `docs/runbooks/local-experience-readiness.md`; P5-06 READY or a browser test PASS does not imply that permanent operator preview already exists.

No source or task status was changed by this readiness review. The final recommendation is READY for the explicitly scoped local P5-06 task under ADR-016; root decides and records it. It does not declare real merchant acceptance, production launch or a persistent full-experience preview ready.
