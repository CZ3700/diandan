# P6-03 catalog read cost audit

Read-only audit baseline: `b7df3400`; author `/root/performance_catalog_audit`. Main task and Lane D remain root-owned. All paths below are repository relative. No product code was changed during baseline collection.

## Actual path and complexity

`apps/storefront/src/storefront/gift-browse-section.tsx` → `server/public-gift-browse.ts` → API `gift-browse-route.ts` → application `gift-browse.ts` → persistence `gift-browse-repository.ts`/`gift-browse-sql.ts` → `catalog-publication-loader.ts`.

- Discovery limits returned IDs with SQL `LIMIT/OFFSET`, counts actual visible gifts, retains publication leaf/revision/head consistency and category/artist rules. Only selected 12/48 IDs enter hydration; out-of-range pages do not hydrate.
- `gift-browse-sql.ts::versionState` still reads **19 entire relations**, including historical/unpublished/unrelated content. Each relation forms sorted `jsonb_agg` of compact row metadata, then nested JSON text and SHA-256. Compact columns reduce payload relative to full objects, but do not make the operation constant-time: work grows with total metadata/history, with sorting and serialization costs. The visible count also scans candidate gifts. None of this loads all gifts into the browser.
- `catalog-publication-loader.ts::loadRecords` performs two bounded bulk queries for selected base/revision/translations/variants and media. It then serially verifies each modern proof through `loadPublishedContentContext`. Legacy V1 skips this modern proof path, so its cost must not represent normal direct publication.
- V3 single-primary-image cost predicted by source is **3 + 13 × pageSize SQL operations**, before transaction control: one discovery, two bulk hydration reads; per gift timezone + owner + head, manifest/document, current base, variants, two current-price-evidence reads, four media/lineage bulk reads, one metadata read. Actual observer counts and EXPLAIN are authoritative over this prediction.
- V2 strict publication additionally reconstructs full preflight snapshots, all seven translations/reviews, media lineage and publication receipt; query count varies with media/detail references. V3 retains direct publication manifest/document hashes, current revision/head/base, price/variant evidence and actual source rights/processing lineage. Both paths perform additional Zod parsing and application projection after loading.
- `daily-publication-media.ts` checks every original provenance source, including deduplicated output masters. Repeated shared media are read again per gift in one transaction. `daily-publication-read.ts` reads current price evidence even on content-only browsing because the full daily publication projection verifies it. Removing these checks is not a valid optimization.

## Existing reusable tools and fixtures

- `packages/persistence-postgres/scripts/postgres-catalog-fixtures.mjs::seedCatalogDirectoryFixtures(client,count=120)` writes real legacy fixtures with all triggers enabled at migration 0017, then normal migrations identify those publications as V1. Contains `count` artists and gifts, two variants and two markets. Useful at 120/1200 for global version-state growth; not modern publication proof evidence.
- `gift-browse-postgres.mjs`: 25 legacy gifts, real page/category/eligibility/status/rights checks; `gift-browse-strict-postgres.mjs`: normal strict V2 publication plus controlled result-leaf translation faults. `gift-browse-publication-cases.mjs` verifies a supplied actual V2/V3 gift across canonical locales.
- `apps/api/scripts/storefront-acceptance-runtime.mjs::withAcceptanceFixture` provides isolated actual PostgreSQL, strict TLS S3, real media processing, authenticated authoring/publication, public read persistence and deterministic cleanup. It does not start Next until `startStorefront()` is called. Its seed has 120 artists and a smaller strict gift assortment, not 120 modern gifts.
- `cart-daily-gift-fixture.mjs` supplies normal management defaults, rights-confirmed signed upload and authenticated direct publication. The performance seed reuses its configuration and one running management runtime, but creates 120 distinct legitimate upload/operation/gift/price/publication records. No SQL-created manifest/proof, trigger disabling or bulk copy of published rows.
- Existing `storefront-acceptance-performance.mjs` retains three Lighthouse samples, actual initial resource bodies and same-navigation content checks. This is browser-only lab evidence and is separate from database cost sampling.

## Repeatable baseline tool

Command (run only when root grants exclusive load window):

```sh
POSTGRES_TEST_BIN='/path/to/owned/PostgreSQL18/bin' mise exec node@24.20.0 -- node apps/api/scripts/catalog-performance.mjs '/absolute/owned/new-output-directory'
```

The new scripts first run separate legacy 120/1200 ephemeral databases, then a separate real PG/TLS S3 fixture with 120 normal V3 direct publications. All seven locales × 12/48 page sizes × page 1/2 × three sequential attempts are retained for each catalog. No browser, Next build, user database or persistent user instance is accessed. Actual runtime metadata and `SHOW server_version` are retained; no database configuration or credentials enter reports.

Each sample records full application time, all SQL query counts/times/statuses (including transaction control), SHA of SQL text, PostgreSQL row count/UTF-8 JSON size, public response byte size, number of returned gifts, actual total, proof family and catalog version. No SQL parameters, row bodies or credentials are persisted. Returned-row byte size is JSON size after node-postgres decoding, **not network wire size**; observer JSON serialization affects total duration and is disclosed. Query timings stop before observer serialization. No warmup samples are discarded; PG caches may be warm from publication.

After application samples, run original discovery SQL and an independent exact `version_state` expression through `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)` three times. Save all raw plans and safe plan summaries. Do not sum nested plan timings, subtract probe duration from request time or describe the server as disk-cold. Aggregate median/min/p95/max retains slow attempts. The 8s BFF timeout is a current failure ceiling, not an invented performance release target. SPEC §16.2 browser/field budgets remain unchanged.

Tool tests cover preserving calls/release, rejecting concurrent captures, retaining safe failures, retaining slow samples/rejecting empty or failed aggregation, exact version-probe boundaries and inclusive EXPLAIN timing. Original RED and GREEN logs are retained separately. Baseline first invocation failed before allocating resources because the tool requested a non-exported application function; fixed by consuming the existing public `createCatalogDirectoryUseCases().browseGifts`, not adding a public export.

## Minimal optimization candidates after measurements

1. Prefer targeted **batch V3 hydration inside the same SERIALIZABLE transaction**: collect selected owner/publication/document IDs, load matching manifests/base/variants/current prices and deduplicated media/metadata in bounded queries, then use existing proof hash/schema/projector per gift. Keep locks and every source asset rights/provenance check. This can eliminate per-gift round trips without changing public contracts, migration or proof semantics. Explicit invalid/missing proof and cross-owner tests must precede it.
2. A smaller, narrower alternative is transaction-local deduplication of shared immutable media/proof reads after acquiring required SHARE locks. Never global/process caching; mutable rights, prices, head/version and time-sensitive evidence must remain current to the transaction.
3. Optimize version hashing only if measured material: scoped current publication/eligible dependencies or a transactionally maintained rebuildable revision projection need complete dependency invalidation proofs. Do not replace hash with MAX(updated_at), count-only or a process counter. Streamed fixed-size row hashes can reduce JSON memory but still scan/sort all metadata and should not be described as O(1).

All candidate product changes require root's exclusive ownership approval first. Root reviewed the actual baseline and chose to complete the browser measurements before deciding whether a product optimization is justified. No product optimization was made or measured in this subtask.

## Actual baseline results

`catalog-baseline-2/catalog-results.json` is PASS and the complete command exited 0. Runtime was native isolated PostgreSQL **18.6 (Homebrew)** selected explicitly by `POSTGRES_TEST_BIN`, Node **24.20.0**, plus the existing real TLS S3 integration harness. There are **252 retained application samples**, 84 for each dataset; each dataset covers all seven locales, both page sizes, both first and second pages, and three attempts. Raw query observations, all EXPLAIN plans and safe aggregates are retained under `catalog-baseline-2/`; `catalog-baseline-summary.json` is a derived compact summary.

| Dataset | Page size | SQL count | Application min / median / p95 / max (ms) | SQL sum min–max (ms) | Returned PG row JSON | Public DTO JSON |
| --- | ---: | ---: | --- | --- | --- | --- |
| Legacy 120 | 12 | 6 | 17.1 / 18.1 / 21.9 / 39.9 | 12.2–17.4 | 272,273–272,404 B | 15,320–15,564 B |
| Legacy 120 | 48 | 6 | 40.7 / 42.4 / 45.6 / 46.3 | 20.7–25.1 | 1,089,113–1,089,244 B | 60,427–61,391 B |
| Legacy 1200 | 12 | 6 | 87.4 / 93.8 / 117.0 / 128.5 | 81.9–123.0 | 272,274–272,405 B | 15,322–15,566 B |
| Legacy 1200 | 48 | 6 | 112.7 / 123.4 / 142.7 / 149.9 | 91.3–128.3 | 1,089,114–1,089,245 B | 60,429–61,393 B |
| Modern V3 120 added | 12 | 162 | 381.0 / 419.0 / 446.0 / 460.0 | 68.8–93.0 | 6,019,508–6,408,561 B | 17,892–17,965 B |
| Modern V3 120 added | 48 | 630 | 1077.0 / 1332.3 / 1552.3 / 1595.9 | 235.6–283.5 | 17,073,893–23,299,238 B | 70,703–70,992 B |

The modern catalog's actual visible total is **145**, comprising the existing acceptance fixture's 25 visible strict publications and the **120 newly uploaded and normally published V3 gifts**. Both measured 48-item windows, as well as both 12-item windows, contain only V3 items; the runner asserts `proofVersions=[3]`, exact page length, and total 145 on every sample. The modern directory name `modern-120` refers to the 120 added normal V3 publications, not total visible catalog size.

The exact version-only EXPLAIN execution times were legacy120 **6.760 / 6.949 / 6.842 ms**, legacy1200 **78.620 / 85.899 / 79.274 ms**, and modern120-added **5.385 / 5.354 / 5.311 ms**. These are independent probes, not timings to subtract from another request. The legacy scale test demonstrates whole-catalog version cost growth while the returned page stays bounded. Modern V3 reads show the separate proof-loading and application-processing cost; N+1 alone does not establish that network round trips dominate end-to-end duration on this local runtime.

This modern fixture deliberately uploads the same `gift-rose-palace.webp` bytes for all 120 normal operations, allowing the real media pipeline to deduplicate shared assets. It exercises a shared-master lineage pressure case: the first English 48-item sample reads 121 processing-job and 121 processing-output rows per gift. In that sample, 48 manifest/document reads return 13,507,436 JSON bytes, processing-job reads 6,333,744 bytes, and processing-output reads 2,717,712 bytes. These persisted manifests and all current original-source rights/lineage checks remain intact. `catalog-baseline-statement-bytes.json` links these observations to safe statement hashes and retains the same breakdown for both English 48-item windows. This is a reproducible normal-publication workload; independent production photos need not have the same shared-lineage distribution or duration.

Application time includes schema parsing, proof/hash verification, projection, event-loop scheduling and the observer's row JSON serialization. The difference between application time and SQL sum **must not be called measured business CPU time** without profiling; no CPU profile was collected. Similarly, the 8-second BFF failure ceiling is not a success budget, these measurements are not a load/concurrency capacity test, and they do not satisfy browser or real-user CWV gates.

## Verification and cleanup

- `catalog-tools-red.txt` retains the initial failed tool tests; `catalog-tools-green.txt` retains five passing tests. The first command failure (non-exported application import) remains in `catalog-baseline-1.txt`; `catalog-baseline-2.txt` is the successful complete run. No failed samples or runs were overwritten.
- Final lightweight verification again passed all five node tests, six-file ESLint and six-file Prettier check; outputs are `catalog-tools-final-test.txt`, `catalog-tools-final-eslint.txt` and `catalog-tools-final-format.txt`.
- `catalog-baseline-source.json` records the eight original product source hashes; `catalog-baseline-tool-source.json` records the six executing tool hashes. All fourteen hashes still match after the run, as recorded in `catalog-baseline-cleanup.json`; no proof, rights, trigger, timeout or product-read optimization was changed during sampling.
- The owned native PG process 23637, outer runner 22335 and S3 child 22349 exited; the exact owner-marked PG directory was removed by the normal harness. The user's separate PG process 15767 remained running and was not accessed. The outer command's exit 0 also confirms normal S3 owner-label cleanup and TLS proxy closure completed. A subsequent same-prefix Docker container was created after this run by the root browser task and was not touched.
- No Next build, browser, real PSP, user-owned persistent database or remote repository operation was part of this subtask. Source and lightweight tool validation do not imply production readiness.
