# P3-01 checkpoint 3B — content / Application

Owner: `/root/content_review_audit`. Source frozen after local verification, 2026-09-06.

## Implemented scope

- Five typed revision kinds: IDOL, GIFT, HOMEPAGE, POLICY, MEDIA_METADATA. Creation and copying produce immutable authoring plans; PostgreSQL allocates identities and owns version locks.
- Actual English fields determine source lineage. New or edited text starts DRAFT. Untouched foreign text retains its previous translated-from hash when English changes, so STALE is derived rather than cleared by copying.
- Exact unchanged, current, approved base text preserves its original editor, timestamp, review evidence, origin and immediate source lineage. Explicit MACHINE/IMPORT overrides always start DRAFT. An explicit HUMAN Unicode normalization edit with equal normalized hash but different original field bytes also starts DRAFT, retaining the requested text.
- Media/structure changes do not fabricate new text approval. New revision structure remains outside the inherited text evidence. Aliases and structured details are copied as content inputs; their fresh IDs, authors, independent DRAFT reviews and untouched detail lineage are persistence responsibilities.
- Snapshot hashes bind typed content, structure, lifecycle, identity, review IDs/sequences/timestamps and extension evidence; only headVersion and the self hash are excluded. Each actual localized field hash and origin are checked against canonical audit data before use.
- Application READ/CREATE/COPY require current database session, CSRF, permission and actual locale authorization in the same transaction. READ returns the complete snapshot and therefore requires every base/extension locale. A translation-only COPY may require its changed locale; English, structure/media and copied/replaced extension scopes expand authorization as documented.
- Authorization precedes idempotent replay. Successful COPY replay remains possible after source review events advance and change the snapshot hash; a new operation validates expected source hash and owner version. Responses and persisted idempotency records contain only a revision result reference. Failed callbacks roll back reservations and writes.
- Canonical database wall-clock samples need not be monotonic. Actor/session/expiry must remain identical and each authorization independently precedes its canonical session expiry.

## Bugs proved and resolved

1. Explicit Unicode normalization edits could inherit normalized hash approval while PostgreSQL required exact old field evidence. `nfc-inheritance-red.log` proves the failure; final content tests verify DRAFT with preserved requested bytes.
2. Real HTTP concurrent MEDIA_METADATA COPY returned `BEGIN_IDEMPOTENCY` failure `TRANSACTION_ABORTED`; only thrown transaction failures had been mapped to conflict. New authoring begin/complete helpers now map returned TRANSACTION_ABORTED/VERSION_CONFLICT to CONFLICT and reject the transaction callback. `port-concurrency-red.log` proves both stages were previously CONTENT_UNAVAILABLE. No sleep or automatic retry was introduced; old 3A code remains unchanged.
3. Authoring idempotency previously normalized Unicode, incorrectly replaying a request when its raw text change would change approval inheritance. `raw-command-idempotency-red.log` proves NFD-to-NFC with one key incorrectly replayed; the final test requires IDEMPOTENCY_CONFLICT. The new authoring-only request hash sorts object keys and preserves raw strings/array order. Existing shared and 3A hashes remain unchanged.
4. Minimal helper extraction reuses existing ICU and gift-detail structural validators without fabricating revision IDs or import packages. Existing validator APIs and output paths remain unchanged.

## Verification

All commands use `mise exec node@24.20.0 -- corepack pnpm`.

| Command suffix | Result | Evidence |
| --- | --- | --- |
| `--filter @fan-support/content test` | 131 PASS | `content-green.log` |
| `--filter @fan-support/application test` | 175 PASS | `application-green.log` |
| `--filter @fan-support/content typecheck` | exit 0 | `content-typecheck.log` |
| `--filter @fan-support/application typecheck` | exit 0 | `application-typecheck.log` |
| `--filter @fan-support/content build` | exit 0 | `content-build.log` |
| `--filter @fan-support/application build` | exit 0 | `application-build.log` |
| `exec prettier --write` on nine owned source/test files | exit 0 | `format.log` |
| `exec eslint` on the same nine files | exit 0 | `lint.log` |

Earlier behavior failures are retained in `content-red.log`, `detail-fields-red.log`, `application-red.log`, `nfc-inheritance-red.log`, `port-concurrency-red.log`, and `raw-command-idempotency-red.log`.

S.U.P.E.R checks 1–10: PASS within this ownership scope. The pure plan/hash module, Application orchestration and idempotency module have distinct responsibilities; dependencies point inward without cycles; cross-module data uses frozen schemas and serializable contracts; configuration is injected; no new package dependency or network service is introduced; repositories are replaceable ports; all affected tests pass. Small cleanup simplified raw-field equality without changing the public contract.

## Boundaries

This is immutable authoring, not a complete translation editor UI. Base-language review read/submit/approve UI/API integration remains a later step; 3A review routes currently handle aliases/details. New stable idols/gifts, variants, publication, rollback, public single-object content, outbox/purge and production identity issuance are outside this checkpoint. This report verifies pure/Application code with deterministic repository fixtures; root and the other agents own actual PostgreSQL, HTTP and combined-gate evidence. No production release, PSP, object-storage or staging claim is made.
