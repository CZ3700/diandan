# P6-01 finance TEST database selector independent review

2026-09-23; independent reviewer `/root/regression_coverage_audit`; implementation author `/root`.

Conclusion: ACCEPT the four-file test-harness selection change at the hashes below. No actionable P1/P2 found in this bounded review. This is not full P6-01 acceptance and does not establish the cause or repair of the original Docker `provider_events_time_check` failure.

The shared selector preserves the prior HTTP condition exactly: only an undefined `ADMIN_FINANCE_TEST_POSTGRES_BIN` uses Docker. Empty, relative, unavailable, operation-failing, and cleanup-failing native selections are not retried on Docker. Only the existing private-cluster harness receives the explicit bin path. Its exact ownership marker, isolated fresh data directory, PostgreSQL 18 version checks, loopback authentication, and cleanup behavior are unchanged. The selector forwards only closed runtime kind/configuredBy and native serverVersion metadata; it does not expose cluster directories, connection information, or private run IDs.

Both original HTTP/browser and storage entry points now call the shared selector. The S3 subprocess preserves the explicit tool environment; CI and regression suite environment already retain this non-FAN_SUPPORT tool variable. Storage writes actual safe runtime metadata and includes the two new runtime dependencies in its before/after input hashes. The only caller of exported runAdminFinance now supplies that metadata. The original finance fixture, host-generated event timestamps, migrations, SQL constraints, assertion thresholds, and error outcomes are byte-unchanged by these four files. The generic transaction or production configuration boundaries are not modified.

Independent lightweight commands, all exit 0:
- `mise exec node@24.20.0 -- node --test apps/api/scripts/regression-finance-database.test.mjs apps/api/scripts/admin-finance-native-postgres.test.mjs`: 12/12 PASS. These use injected native execution and database stand-ins; no real PostgreSQL, Docker, browser, or service was started by this review.
- `mise exec node@24.20.0 -- corepack pnpm exec eslint` on the four bound files, `--max-warnings=0`: PASS.
- `mise exec node@24.20.0 -- corepack pnpm exec prettier --check` on the same four files: PASS.
- `git diff --check` for the two tracked modified files: PASS.

Evidence: finance-selector-independent-tests.txt, finance-selector-independent-lint.txt, finance-selector-independent-format.txt. Parent separately supplied real native storage 6023 and HTTP PASS in finance-native-selector-precheck/report.json; reviewed this result but did not rerun it. The one separately authorized Docker numerical diagnostic passed 6023 with four occurredAt values before the same-transaction timestamp; see finance-time-diagnostic-1/review.md. Original full final-6 remains FAIL. Neither targeted PASS replaces a fresh full run.

Candidate commit manifest now contains 73 source/document paths (34 tracked modifications and 39 new source/document files), with no omitted current source changes and zero intersection with the original 6144 user-untracked paths. No staging or Git mutation was performed; see owned-source-verification-final73.json. Generated evidence and original untracked assets are excluded from that candidate manifest.

Bound SHA-256 values:
- `apps/api/scripts/admin-finance-test-database.mjs`: `351b0f6ba4d0fc8e7cf4fe0c81babc5e1a5e30bd2c41233abacf6ae1a36c63cd`
- `apps/api/scripts/regression-finance-database.test.mjs`: `c1db92a80c847b5b318d74cb546cd18e37dd0dfb9e346e5221829b14da61115e`
- `apps/api/scripts/admin-finance-http.mjs`: `e9d5f7d637de27cd9482a1637fee2adf927e3f8ed6ad0479e447deb0f30f69d6`
- `packages/persistence-postgres/scripts/admin-finance-integration.mjs`: `8c6a4dd8e0290b5888a1d44dcf54d900662da248dff291e626c7f1c4d1ec9677`
