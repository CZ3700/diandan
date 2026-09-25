# P3-06 purge extension independent review

Reviewer: `/root/storefront_read`, non-author. 2026-09-07. **ACCEPT for source/unit scope; real PostgreSQL migration and retry evidence remains a root integration gate.**

Reviewed `packages/persistence-postgres/src/publication-runtime-write.ts` (only `publicationPurgePaths`), the three new purge path/retry/migration test files, `database/migrations/0021_storefront-seo-purge.up.sql`, its down SQL, and the manifest diff.

The application preserves each prior locale/object path and adds exactly `/:locale/sitemap.xml*`, `/sitemap.xml*`, and `/api/v1/storefront-seo/*`, sorted and unique. The migration permits two exact sorted arrays, never arbitrary subsets, prefixes or caller-controlled wildcards. Publication/outbox/locale identity and initial state remain mandatory. Retry generation requires its actual FAILED predecessor and byte-equivalent persisted paths, so retry cannot upgrade the old format or expand a prior job.

The down migration permits legacy format for new root jobs while allowing existing expanded jobs to continue their unchanged transitions and exact-parent retries. Deployment rollback must also restore the old application path writer; running the new writer after down intentionally fails closed.

I independently ran the three new files: **41 tests passed**, including text reconstruction of every unrelated guard against unchanged migration 0018. Log: `seo-purge-independent-tests.log`. Separately verified the prior 20 manifest entries are exactly unchanged and both 0021 SHA-256 values match actual SQL bytes. No migration/production source edits made in this review.

No actionable blocker found. These additions cover publication-triggered invalidation; they do not establish a real CDN purge result or broaden invalidation to independent price/rights/status mutations. The separately reviewed zero-freshness revalidation design must remain until all mutation paths have appropriate invalidation evidence.

## Subsequent real-harness extension review

Also reviewed the later diffs in `postgres-publication-runtime.mjs`, `postgres-admin-catalog.mjs` and `apps/api/scripts/publication-runtime-http.mjs`. ACCEPT. The runtime probe uses a normal durable claim and terminal failure, compares every persisted job before/after 0021 down, checks narrowed/broadened/reordered retries against exact SQLSTATE 23514 path guards, then commits an exact retry with fresh existing authorization. The original 0020/0019/0018 downgrade protections remain. Admin history comparison only inserts the required 0021 downgrade before the original sequence. The HTTP predicate permits only two exact additional global strings and retains the prior locale namespace boundary for every other path.

Read the author-run actual logs without rerunning heavyweight PostgreSQL: `seo-purge-runtime-pg-green.log` final 459 assertions; `seo-purge-admin-pg-green.log` 260 assertions; `seo-purge-runtime-http-green.log` 11,374 assertions / 1,455 requests. These establish local PostgreSQL/normal-trigger/local HTTP purge evidence, not a production CDN purge.
