# `@fan-support/content`

This package owns pure content publication policy. Cross-module Zod schemas remain in `@fan-support/contracts`; this package consumes them and must not become a second locale or persistence owner.

The package is server-side domain/application code. Its deterministic hashing uses Node.js `crypto`; browser bundles should consume public DTOs from `@fan-support/contracts`, not import this package.

## Translation hashes

- `sourceHash` is the SHA-256 of the row's explicit localized fields after Unicode NFC normalization and stable ASCII key ordering.
- `translatedFromSourceHash` points to the current English row's `sourceHash`; the English row points to itself.
- `APPROVED` rows must match separate, append-only approval evidence that binds the typed parent revision, translation revision, locale, editor, reviewer, review time, English source hash, and localized content hash. Editing candidate copy or its self-reported review fields cannot manufacture approval.
- `MISSING` means no row exists and `STALE` means the translated-from hash no longer matches English. Neither is writable review state.

The hash input has an explicit content-kind and schema-version prefix. Variant-label maps are canonicalized by UUID and homepage slot-label maps by slot key before hashing, so semantically identical ordering cannot change a translation digest. UUID identity comparisons use lowercase canonical keys to match PostgreSQL `uuid` equality. Adding or reclassifying a localized field requires a compatible schema decision and hash fixture update.

## Publication policy

The Idol, Gift, Homepage, and Policy validators are deterministic pre-transaction gates. A caller must assemble the complete candidate from canonical repositories. The request may identify the intended object and action, but it must not provide base rows, revisions, prices, eligibility, inventory, media state, current publication pointers, approval evidence, or `evaluatedAt`. The application service supplies `evaluatedAt` from its server clock and loads every other input itself.

The validator's second argument is separate, append-only approval evidence loaded from the approval repository. An approval binds the typed parent revision, translation revision, locale, editor, reviewer, review time, origin/import provenance, English source hash, localized content hash, and the exact object-specific field set reviewed. It must never be accepted from the publication request body. Publication requires an exact approved seven-locale package, a publication-eligible immutable revision, and evidence timestamps no later than the server-supplied `evaluatedAt`.

Gift publication additionally combines variant eligibility, published/effective non-overlapping prices, qualified media, inventory associations, and alt-text checks. Inventory quantity deliberately does not gate content publication: an out-of-stock gift may remain visible. Idol publication requires the portrait, desktop hero, and mobile hero profiles; a paused target cannot accept new gifts. Homepage and Policy publication validate their own references, copy, media, and effective-time rules. Each required media role and AVIF/WebP/JPEG format needs at least one READY derivative at its role floor: gift primary 1200x1200, portrait 800x1000, desktop hero 1600x900, and mobile hero 720x900. Smaller responsive variants and non-ready retry records may coexist but cannot satisfy that gate.

Machine translation and batch import use typed `TranslationImportPackage` creation commands. Those commands can only create `DRAFT` rows, validate against a trusted `{ objectKind, parentRevisionId, currentEnglishSourceHash }` target, reject malformed ICU messages before comparing variable sets, and never carry approval or publication authority. Only imports may carry an import batch id. The target and hash must be re-read from the canonical repository in the same transaction that writes the translation row; they must never come from the import request. A later, independent human review may approve the resulting immutable row.

Successful publication creates one immutable `ContentPublication` event. Its translation manifest binds the publication id, approval id, typed parent revision, translation revision, locale, provenance, and approved hashes. Its declared media metadata revision ids must exactly match complete seven-locale media manifests. A rollback is a new event that replaces the current event; it never rewrites a historical revision or publication.

The final write transaction must re-read and lock the current object version, draft/published pointers, current publication, target lifecycle, all referenced content, effective price rows, eligibility, media state, and approval rows. It must re-run validation against those rows before atomically storing the publication event, updating the current pointer, and enqueueing any outbox work. A pre-transaction green report is not authority to publish after concurrent changes.

Public selection carries the complete persisted current publication event, not a caller-assembled id/action tuple. The selected object and media manifest entries must be exact members of that event, and its declared media set must be covered exactly. The base row's current published pointer and event must identify the same revision. A rollback may therefore select a historical `SUPERSEDED` revision without mutating it. `DRAFT`, `VALIDATED`, and `ARCHIVED` content revisions are never public. Referenced media metadata must be `PUBLISHED` or `SUPERSEDED`; assets, rights, and selected derivatives must remain ready and role-compatible.

`selectPublishedIdol`, `selectPublishedGift`, `selectPublishedHomepage`, and `selectPublishedPolicy` construct strict public DTOs from canonical rows. Both their selection and projection-source arguments are repository/application values, not route bodies or query parameters. The selected manifest fixes the approved localized content hashes; a caller cannot substitute an arbitrary prebuilt DTO or self-attested hash. Legacy P1-01 `Idol`, `Gift`, and `PriceBook` schemas remain internal compatibility components; HTTP contracts use the publication-bound `Published*View` schemas and the validity-aware `PriceBookRevision` schema. CDN URLs may vary independently of immutable content. They must be produced by a trusted CDN adapter against a deployment-configured origin/path allowlist, never accepted from a route or Admin payload. Projection additionally rejects credentials, fragments, private/loopback/link-local literals, unknown or duplicate transforms, unsafe transform values, and derivatives with invalid role geometry. Content revision references bind asset and metadata identities; derivative readiness and geometry are revalidated when projected.

Each `Price` has its own positive `revision`, independent of `priceBookRevision`. Checkout and order `priceRevision` snapshots refer to that `Price.revision`; published amounts and validity windows are immutable within the revision.

Generated JSON Schema and OpenAPI components describe wire shape. Cross-row, clock, hash, current-pointer, exact-set, and transaction invariants live in the runtime Zod schemas and validators; consumers must call them rather than treating generated metadata as an enforcement engine.

The initial controlled vocabularies for gift category, delivery unit, media processing, and rights status are source-owned MVP vocabularies because the product specification does not freeze a larger taxonomy. Compatible additions are allowed; silently changing existing meanings is not.

This package does not implement database constraints, publication transactions, outbox/cache purge, media processing, inventory concurrency, APIs, or UI. Those arrive in later tasks and must preserve the trust boundaries above.
