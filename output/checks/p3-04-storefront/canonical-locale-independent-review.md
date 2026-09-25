# Canonical locale ownership — independent final review

Result: **ACCEPT**. No actionable findings in this bounded structural migration. Reviewed on 2026-09-07 by the non-author `storefront_read` lane while root kept source frozen. This review writes only this evidence file; it does not establish completion of root's full repository check or production release.

## Scope and findings

- Reviewed `packages/i18n/src/storefront/review-manifest.ts`, its seven sibling `.review.ts` modules, `messages.ts`, the server-only production wrapper, and the migration snapshot/test. The aggregate derives its keys and order from contracts-owned `SUPPORTED_LOCALES`; its exhaustive switch selects the corresponding locale module. No additional locale source or fallback was introduced.
- Independently transpiled the current eight TypeScript source files in memory, without using `dist`, and compared the entire aggregate and every locale record with `copy-review-manifest-before.json` using exact `JSON.stringify` equality. All values and property order match. Each aggregate entry is the corresponding imported record, and the aggregate remains frozen. The separate built-module migration test also passes.
- All seven records remain `DRAFT`, with unchanged source/translation hashes, `reviewer: null`, and `approvedCommit: null`. Current i18n tests verify these hashes against the actual shipped copy bytes. The runtime approval gate still requires matching schema version, namespace, locale, `APPROVED`, a nonblank reviewer, a full 40-character lowercase hexadecimal commit, and exact SHA-256 hashes of both actual English source and requested translation. The production server wrapper still requests approval; TEST/local draft reads remain possible. Neither approval algorithm nor production wrapper changed in this migration.
- `scripts/check-contracts.mjs` is unchanged from the tracked version (`git diff` and scoped status are empty). Its AST checks still reject duplicated canonical locale arrays/maps and redeclared contracts-owned locale identifiers. No new exception or ignored source directory was added. The repository checker passes with the new canonical-derived maps.
- Reviewed the API fixture's `copyForLocale` switch and canonical `Object.fromEntries(SUPPORTED_LOCALES.map(...))`. Independently evaluated the actual AST-selected source definitions, without running catalog seeding. The resulting map has exactly the canonical keys/order, serializes to **4,069 UTF-8 bytes**, and has SHA-256 **`f7ac204f7917e11898bce9114633b9395ff0bc9c84eed6ad53bb9437df011a6c`**. This exactly matches both before and after hashes in `fixture-copy-equivalence.log`. This refactor only changes map construction; it introduces no API operation or business-state change.

## Independent validation

Commands used `mise exec node@24.20.0 --` and made no source edits.

| Check                                                                                            | Observed result                                                                            |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `node --test output/checks/p3-04-storefront/copy-review-migration.test.mjs`                      | PASS, 8 tests, 92 ms total                                                                 |
| In-memory source transpilation and exact aggregate/per-locale JSON comparisons                   | PASS, all seven records, reference identity, and aggregate freeze                          |
| `corepack pnpm --filter @fan-support/i18n test`                                                  | PASS, 4 files / 25 tests, 693 ms, including changed-copy and incomplete-approval rejection |
| `node scripts/check-contracts.mjs`                                                               | PASS, both generated documents fresh and canonical locale ownership preserved              |
| In-memory AST extraction of current fixture function/map; canonical key and byte/hash assertions | PASS, 4,069 bytes, exact before/after hash match                                           |

## Evidence provenance and limits

`copy-review-manifest-before.json` is the migration author's saved pre-change runtime aggregate; this reviewer independently checked both current source and built output against it. The migration author's RED/GREEN history is documented separately in `copy-review-migration-README.md` and was not rerun by reverting frozen source.

For API fixture copy, the author did not save a separate old source/map baseline. Their `fixture-copy-equivalence.log` records an exact before/after comparison: the author reported evaluating the old literal map and the new canonical-derived map in the same conversion process and asserting complete JSON equality before writing. The reviewer independently verified the current source bytes against that recorded before/after digest, but does not claim an independently captured pre-change fixture baseline. Original old-source tool output remains author-provided history. This distinction does not indicate a mismatch or a weakened gate.

All shipped storefront copy still requires actual human review before production approval. This review grants no such content approval and changes no review status.
