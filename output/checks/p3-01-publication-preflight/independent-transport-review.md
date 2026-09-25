# Independent transport integration review

Status: ACCEPT for the reviewed 4C-1 read-only preflight scope. No blocking findings were identified. This is a non-author review of the files listed below, not an independent review of the reviewer's own route or HTTP harness.

The transport author read the complete new pure evaluator and its bindings, reviews, extensions, assets, media lineage, effective-time and shared helpers in `packages/content/src/publication-preflight*.ts`, including both test files and their fictional fixture support. Checks traced the reused authoring snapshot/hash validation and legacy publication rules where the new evaluator delegates to them.

Reviewed behavior:

- Canonical owner/revision/hash bindings, base and referenced media snapshots, lifecycle and current publication evidence; rollback also requires a matching historical publication and a superseded target distinct from the current head.
- Seven-language approval and English lineage, exact review identity, author/reviewer separation, ICU field matching, and dedicated copy evidence bound to the raw source text and approved source review.
- Optional aliases and gift details receive their own independent evidence checks; present gift-detail documents require all seven languages and qualified detail-only media references.
- Every candidate asset needs explicit source identity. Processed masters bind successful jobs, command hashes, source/output metadata and all recorded originals; shared master provenance cannot discard an original with revoked rights. Hero desktop/mobile original IDs and checksums must be disjoint.
- Derivative readiness and dimensions, linked catalog checks, and full fractional-precision price/policy boundaries. Locale labels follow actual canonical row order rather than an unrelated snapshot index.

The reviewer also checked the non-owned public schema, root Application factory, persistence port, TEST composition/bootstrap and OpenAPI mapping: one strict POST command, `content.read` plus all seven locale grants, current database session/MFA/CSRF before canonical loading, safe report binding, no idempotency write and no implicit production login registration. Targeted inspection of PostgreSQL evidence mapping confirmed the origins of extension structure-editor and processing evidence; this is not a claim of a complete independent PostgreSQL implementation audit.

Fresh independent pure verification is in `independent-pure-tests.log`: 150 tests pass across the main gate (136) and media lineage (14). The final actual HTTP integration is in `http-final.log`: 2595 assertions / 277 requests, including unchanged business-state digests, current authorization and rights revocation. The reviewer's own transport implementation is supported by its tests and these integration results, not by self-approval.

Remaining boundary: readiness is a diagnostic at the canonical snapshot's evaluation time. Future publication/rollback must repeat the same gate inside its own atomic mutation transaction. This slice does not verify publication writes, worker/outbox consumption, CDN completion, production login, staging or release. Repository-wide acceptance and any separate PostgreSQL review belong to the root checkpoint evidence.
