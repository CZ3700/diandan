# P3-02 translation backend handoff

Implementation owner: content_review_audit. No commit or push. Root owns the Lane C task, Admin UI and final acceptance. This record covers implementation verification; it is not an independent review of the author's own modules.

## Implemented scope

- `contracts`, `persistence-port`, `content`, `application` and `persistence-postgres` gain scoped translation workspace, audited translation exchange and controlled preview media modules. Factories: `createTranslationWorkspaceUseCases`, `createTranslationTransferUseCases`, `createAdminPreviewMediaUseCases`; repositories share the corresponding names with `Repository` suffix.
- The workspace returns the selected locale and actual English, a seven-locale matrix whose restricted cells contain no translation or review data, proven same-owner historical English COPY lineage, and explicit COPY editability. Missing translations stay missing. Historical source lookup is bounded to 128 COPY edges; unavailable evidence produces an explicit unavailable diff.
- Export packages bind the canonical target, source snapshot hash, English hash, authoring head and audited receipt. Only entry text can change on import. New imports validate field and ICU constraints, write one immutable COPY and IMPORT DRAFT rows with an import batch, then atomically record its audit/receipt and idempotency result. Independent review is always separate. Original raw Unicode is retained in idempotency comparisons.
- Current permission and affected locale scopes precede replay. English, structure and copied alias/detail extensions retain the existing wider COPY authorization policy. Successful imports replay even when their old source head has since advanced; new keys reject stale packets. Packet expiry means changed source/head, not a time-based TTL.
- Unsealed legacy DRAFT sources must first be copied before export (`CONFLICT`). Existing authored drafts, sealed COPY sources and immutable non-DRAFT history remain exportable. This prevents mutable legacy text from changing an export replay without storing a second body source. Legitimate review progress does not invalidate immutable export reconstruction.
- Preview media reads the existing bearer grant and exact root references, resolves only eligible DERIVATIVE images and the chosen locale's metadata, signs outside the transaction and revalidates in a second short transaction. No caller-selected asset, storage key, linked draft expansion or locale fallback. Public response omits storage keys, checksums and actor/session IDs. Provider headers remain opaque. The old 60-second minimum download signing window is retained; a shorter remaining deadline safely fails.
- Eleven additive OpenAPI paths and 33 versioned roots are registered. The previous 311 JSON Schema definitions remain deeply identical (344 total). Shared indexes and transaction-manager composition were wired by root; API routes were implemented by admin_transport.

## Verification evidence

All commands use `mise exec node@24.20.0 -- corepack pnpm` from the repository root.

| Check | Result | Evidence |
| --- | --- | --- |
| Initial contracts / domain / Application / PG repository failures | Observed before implementation | `translation-{contracts,domain,application,postgres}-red.log` |
| Newly imported English is the ICU source for simultaneous foreign imports | RED → GREEN | `translation-new-english-{red,green}.log` |
| Export replay cannot expand canonical locale scope | RED → GREEN | `translation-replay-scope-{red,green}.log` |
| PostgreSQL custom enum-array decoding on receipt reread | RED → GREEN and actual PG confirmed | `translation-enum-array-{red,green}.log`, `db-full-third.log` |
| Projection consistency: exact target/source/matrix/editability; duplicate image refs and alt semantics | RED → GREEN | `translation-projection-schema-{red,green}.log` |
| New OpenAPI boundaries | RED → GREEN | `translation-openapi-{red,green}.log` |
| Contracts complete package | 278 tests PASS | `translation-contracts-full.log` |
| Pure workspace and five-kind import rules | 8 tests PASS | `translation-domain-final.log` |
| Application authorization, replay, rollback value handling and preview signing boundaries | 9 tests PASS | `translation-application-final.log` |
| PG repository boundary tests | 4 tests PASS | `translation-postgres-final.log` |
| Five affected package typechecks and builds | PASS | `translation-typecheck-final.log`, `translation-build-final.log` |
| Owned source lint and formatting | PASS | `translation-lint.log`, `translation-format-final.log` |
| Generated contracts | PASS; 311 previous definitions unchanged | `translation-contracts-generate.log`, `translation-contracts-compatibility.log` |
| Actual PG five-kind exchange, replay, stale source diff, audit/receipt/revision rollback and scoped preview | 243 checks PASS in combined catalog harness | `db-full-third.log` |
| Mutable legacy DRAFT export | Actual PG RED → 250 combined checks PASS | `db-unsealed-export-red-second.log`, `db-unsealed-export-green.log` |

The first unsealed-export log failed at fixture setup and is not RED evidence. The second is the precise behavioral RED. Actual PostgreSQL harness execution and DDL changes are owned by auth_persistence_audit. The preview helper's signer is a narrow synthetic adapter; actual S3 delivery and browser proof belong to admin_transport's separate HTTP/browser evidence. Root's final full-repository check remains authoritative.

At this handoff, `check:contracts` identified three locale-duplication policy findings in files owned by other agents (catalog test and two Admin message maps); owners have been notified. This is not a claim that the whole repository check already passes.

## Independent review performed by this implementation owner

- Reviewed Dalton's `0019` identity prior-state trigger, deferred final receipt guard, authority/locale/time checks, redirects and translation receipt guards. ACCEPT after the observed legacy export sealing fix. The prior-state guard locks and binds the real previous row; deferred guards bind final identity, authoring/publication versions, audit and redirect. Complete draft snapshot bytes are recomputed by canonical Application/repository loading; SQL binds their exported hash to source/head/English/COPY lineage, not an independently reconstructed full draft payload.
- Reviewed root's Admin BFF/session client, workspace/editor state, preview cleanup and publishing interactions. No blocking authorization bypass or preview credential leakage found in the inspected source. Current UI navigation covers IDOL/HOMEPAGE/MEDIA_METADATA; this is not a claim of full five-kind storefront-equivalent preview rendering.
- Reviewed root's TEST-only runtime gate and Admin message review manifest. UI/BFF are disabled by default and TEST requires development plus loopback origins. All seven message reviews remain DRAFT with no invented reviewer. Source/translation byte hashes and ICU equivalence are checked in CI tests; `assertAdminMessagesPublishable` itself checks approval status/reviewer/commit, not the hashes independently. Production identity and real human language approval remain future release requirements.
- Dalton separately reviewed this author's workspace/transfer/preview chain and reported ACCEPT after the sealing issue was fixed; root and transport perform the remaining cross-module and real browser acceptance.

## S.U.P.E.R review

The ten checks were applied to owned code: single responsibilities (projection, orchestration, authorization/idempotency, repository), forward dependencies, no new cycle, schema-defined serializable ports, injected storage/transactions/configuration, no production identifiers or secrets, no added dependency, replaceable adapters, and relevant verification above. Cleanup retained existing behavior and schemas, replaced nested locale derivation with explicit branches, and made public image projection explicit. No speculative framework or second content truth source was introduced.

## Remaining limits

- A signed image URL already delivered to a browser remains usable until its short provider expiry; revocation prevents future resolution and is rechecked before returning newly signed URLs. It cannot revoke an already issued object-storage URL instantly.
- No production identity provider or live release is installed. Local TEST fixtures and green checks do not establish real human approval, cloud CDN or production authorization.
- The JSON translation package schema is fixed. Existing approved base rows may retain their historical approval when untouched by ordinary COPY; every explicitly imported row is IMPORT DRAFT, and copied extensions follow the established independent review policy.
