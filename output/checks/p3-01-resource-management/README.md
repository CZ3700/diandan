# P3-01 checkpoint 4B — resource management

Status: PASS for checkpoint 4B; final whole-check exited 0 on 2026-09-06. P3-01 remains IN_PROGRESS. The local accepted baseline is `1924df4`; GitHub is intentionally not updated during independent local implementation.

## Scope

Ten private, authorized resource operations register stable policy owners; reserve/upload/inspect/register private source images; read media and jobs; append copyright evidence; enqueue and manually retry processing. Policy text and media metadata continue through existing authoring and seven-locale review. This checkpoint does not publish a revision or implement the admin business UI.

## Implemented behavior

- Twenty-eight additive contract roots, 274 total; all 246 previous roots remain deeply equal. Strict JSON and action-specific permissions prevent caller-supplied authority, object keys, newly created asset IDs in upload registration, dimensions and trusted inspection receipts. HTTP responses expose only required state; BEGIN alone returns a minimal provider-neutral upload capability.
- Migration 0017 adds four typed receipt/reservation/history tables, reaching 17 migrations and 136 tables. Canonical session/MFA/resource permission, causal event times, exact immutable history and audit are enforced in PostgreSQL as well as Application. A database ticket expiry may only shorten the requested maximum; actual wall-clock expiry stays strict.
- BEGIN commits the reservation before signing. COMPLETE performs HEAD, bounded GET, checksum/length/MIME verification and full pixel decoding outside database transactions, then reauthorizes and locks the immutable ticket before atomic registration. New SOURCE assets begin with PENDING processing and rights status; metadata is created later through authoring. Temporary failures leave no permanent in-progress idempotency state.
- Rights confirmations append evidence/version history without changing the original immutable evidence reference. Current source rights participate in processed-master eligibility. Every public media row must carry explicit true provenance; false, null or missing proof rejects the snapshot.
- FAILED processing retries create a new generation with the identical recipe and unique predecessor link. Ordinary enqueue still deduplicates generation 1. Old job, attempt and output history, six-attempt exhaustion and lease fencing are preserved. Nested transaction conflicts retain their typed 409 classification.
- Registered policy owners and uploaded media metadata use existing authoring and independent seven-language review. Rights, metadata approval, successful processing and publication remain separate decisions.

## Verification

| Check | Result | Local evidence |
|:--|:--|:--|
| Affected package tests | 1197 passed: contracts 238, content 149, Application 264, port 4, PostgreSQL 317, API 78, image 68, S3 79 | `targeted-tests-final.log` |
| Contract compatibility | 246 prior roots unchanged; 274 total | `compatibility.json`, `contracts-final.log` |
| Resource PostgreSQL | 129 assertions; concurrency, CAS, exact history, audit rollback and same-key recovery | `postgres-final-green.log` |
| Causal time / nested conflict | 10 timing assertions; 41 unit/composition tests | `postgres-time-green.log`, `postgres-nested-conflict-green.log` |
| Migration / old catalog / old media | 17 migrations /136 tables; 307 catalog assertions; 152 media assertions | `migrations-catalog.log`, `catalog-postgres-first.log`, `postgres-legacy-media.log` |
| Inherited 3A grant-time fixture | 112 assertions passed after explicit clock preconditions; original intermittent failure remains unconfirmed | `postgres-3a-grant-clock-green.log`, `postgres-3a-grant-clock-red.log` |
| Real HTTP + PostgreSQL + TLS S3 + Chrome + worker | 1798 assertions /159 HTTP requests; 13 processed objects independently checked | `http-final.log`, `HTTP-README.md` |
| Deterministic expiry boundary using real adapter logic, stubbed I/O | 6 assertions; one-millisecond advance reproduced RED then GREEN | `source-inspection-download-window.mjs`, corresponding RED/GREEN logs |
| P2-04 browser regression | 16 scenarios, 18 PNGs, 10 axe scans; zero violations | `p2-04-browser.log`, `../../playwright/p2-04/browser-results.json` |
| P2-05 browser regression | 8 scenarios, 22 PNGs, 3 axe scans; zero critical/serious; three existing moderate heading-order findings | `p2-05-browser.log`, `../../playwright/p2-05/browser-results.json` |
| Final repository check | PASS, exit 0; typecheck 56/56, test 56/56, build 35/35 (all cached in final run); 31 Node-imported package exports | `check.log` |
| Secret scan | Passed | `secrets-final.log` |

Browser regressions cover 390×844 and 1440×900, all seven locales, pseudo-locale/320px stress, keyboard, error states, reduced motion and native 200% zoom. Root visually inspected both mobile and desktop composite and motion Hero captures. These refresh existing preview-component evidence and add no physical-device evidence. P2-05's raw result retains `passed-with-physical-device-gate`; earlier device acceptance is not replaced by this regression.

The HTTP test uses actual cross-origin Chrome PUT and automatic preflight with an exact temporary certificate pin, while Node separately verifies the local TLS certificate chain. The disallowed-origin browser request creates no object. A 45-second-plus-789-microsecond session caps the reservation, response grant and actual S3 signature deadline. Capability URLs stay in memory. See `HTTP-README.md` for adversarial coverage and owned-resource cleanup.

RED evidence caught the short-upload minimum, asynchronous signing instant, internal GET boundary, expired-fixture permission history, missing provenance and nested conflict classification. Only upload minimum changed to one second; the signing instant is fixed before asynchronous credential resolution. Internal GET validity is 120 seconds, preserving the existing download minimum and processing budgets. No production clock or permission guard was relaxed.

The first full check stopped in the inherited 3A PostgreSQL review test at “review authorization uses canonical scope” (`check-first-red.log`). Twelve bounded natural diagnostic runs each passed the original 110 assertions, so the original intermittent failure's cause was not confirmed. The harness now records only safe authorization status/time differences if that assertion fails. Positive fixtures independently verify complete active grants and wait for database time to reach them before a single authorization call; the six-second monotonic wait has a 500ms test-only scheduling margin. A controlled real-PostgreSQL query wrapper rolls back only the locale-query clock and proves FORBIDDEN before the grant becomes effective, then SUCCESS after the independent clock condition. The two new assertions bring this suite to 112. This demonstrates the time boundary and hardens the fixture; it is not proof of the original intermittent failure's cause. Production authorization predicates, permission grants, TTLs and DDL remain unchanged.

The second full check passed every real integration suite, then stopped at three lint violations (`check-style-red.log`). Two type-only fixes use ordinary type imports in the media port and preserve the SQL-argument type on a Vitest mock without an unused implementation parameter. Full lint, affected typechecks, and the complete typecheck/test/build preflight passed (105 tasks, 29 cached). Independent review confirmed no runtime/API/test behavior change. Both existing browser renderer manifests still match every current input; no new browser run is claimed for these unrelated test/type-only changes.

Independent non-author specification and quality reviews accepted the implementation. Reviewer ownership and issue closure are in `independent-review.md` and `independent-transport-review.md`. Final whole-check reran old 3A/3B/4A, catalog and new resource suites, plus the existing 423-assertion real image/TLS S3/worker suite. Format, lint, workspace/domain/adapter boundaries, generated contracts, package types/tests/builds and portable exports all passed. All ten S.U.P.E.R requirements passed.

The frozen implementation manifest covers 913 inputs with SHA256 `efbc99d4266b27e32ed54cbba2ac29370d53bbbfd0446de6195bc94f1050976a`; `docs/` and acceptance documents are excluded to avoid circular provenance. Six implementation-related Markdown inputs (skill/package/asset guidance) remain included, and the inspection probe is the only input under `output/`.

## S.U.P.E.R checks

| # | Requirement | Evidence |
|--:|:--|:--|
| 1 | Module responsibility | Resource route, use cases, typed repositories and image inspector have separate ownership and purpose. |
| 2 | Function responsibility | Upload reservation/signing/inspection/final registration and idempotency are cohesive helpers; full decoding is shared with the processor. |
| 3 | Inward dependencies | Route → Application → domain/ports → adapters; Application does not import S3, Sharp or PostgreSQL. |
| 4 | No dependency cycles | Workspace and domain/adapter boundary gates run in the final check. |
| 5 | Explicit schemas | Versioned strict contracts cover commands, responses, grants and trusted receipts; prior roots remain unchanged. |
| 6 | Serializable boundaries | Commands/results are schema-validated data; image bytes and capabilities are not persisted in idempotency, logs or browser storage. |
| 7 | External configuration | Origins, storage, database and token pepper are injected; no formal brand, production host or celebrity identity is introduced. |
| 8 | Declared dependencies | API media ports and local test adapters use workspace dependencies and existing locked versions; no dependency upgrade. |
| 9 | Replaceable ports | Storage and inspection are provider-neutral ports; TEST composition borrows them and closes owned PostgreSQL exactly once. |
| 10 | Verified behavior | PASS: targeted, real PostgreSQL/HTTP/S3/browser, independent review and final whole-check; 105-task preflight ran beforehand (29 cached). |

## Rerun and operational limits

Run from the repository root with the pinned runtime:

```sh
mise exec node@24.20.0 -- corepack pnpm format:check
mise exec node@24.20.0 -- corepack pnpm lint
mise exec node@24.20.0 -- corepack pnpm exec turbo run typecheck test build --output-logs=errors-only
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/persistence-postgres test:postgres:resource-management
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:resource-management
mise exec node@24.20.0 -- node output/checks/p3-01-resource-management/source-inspection-download-window.mjs
mise exec node@24.20.0 -- node scripts/verify-ui-composites-browser.mjs
mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs
mise exec node@24.20.0 -- corepack pnpm check
mise exec node@24.20.0 -- corepack pnpm security:secrets
git diff --check
```

Run the cheap full static preflight before the real lease-expiry suites, so a late lint failure does not require another long integration pass. Browser runs must be sequential with frozen implementation and non-log file inventory. Run the API resource-management integration command before the inspection probe to build its real adapters. Logs and historical diagnostic baselines stay local; the small reviewed inspection probe and compact acceptance records are committed. Use `implementation-source.json` to compare each sorted path/content hash after checks.

A signed S3 PUT may still succeed until its short expiry after a permission change; canonical registration must reauthorize and reject revoked access. Failed registration can leave an unreferenced private object; do not delete objects inline or overwrite canonical assets during checksum deduplication. Successful COMPLETE replay skips storage but still requires the current authorized issuing session. Expired or registered BEGIN reservations do not mint new upload grants.

An extremely short session during a backward clock adjustment may conservatively fail when there is no positive canonical authorization window; the implementation adds no expiry tolerance. Private originals retain source metadata; only the existing processing pipeline strips metadata from outputs.

Copyright and locale review are independent. Changing source rights affects canonical derivative eligibility; actual CDN purge remains part of the publication/outbox checkpoint. Full revision validation, atomic publish/rollback, versioned extended public DTOs, manifest/head, aliases projection, seven-locale outbox/purge and local ≤60-second visibility are the next required P3-01 work. P3-02 through P3-06 remain locked by task dependencies. No real celebrity assets, production admin login, cloud CDN, PSP sandbox, staging, remote CI or production release is asserted here. Local commits are retained per checkpoint; the user requested one later combined GitHub push because these checks run independently locally.
