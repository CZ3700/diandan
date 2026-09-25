# Unified native TEST runtime independent review

2026-09-23; independent reviewer `/root/regression_coverage_audit`; authors `/root/regression_readiness` (typed TEST harness) and `/root` (runner/CI/wiring). Conclusion: ACCEPT this bounded TEST runtime change at the 20 source hashes below. No actionable P1/P2 found. This is not full P6-01 acceptance and does not establish or fix the cause of final-6/final-7 Docker time-constraint failures.

Reviewed lifecycle and isolation: native-postgres.ts is an equivalent typed move of the existing finance TEST helper, with explicit UTF-8 execution and narrowed unknown errors. It checks postgres/initdb/pg_ctl are the same PostgreSQL 18.x version before allocating the cluster. Options reject unknown keys and existing database/data-directory targets; binary/share directories must be absolute. Every run creates a new private 0700 directory with exact random owner marker, private password/config/log files, loopback-only socket settings and SCRAM host authentication. Passwords remain out of command argv. PG_* variables are removed from native tool subprocesses. The legacy alias retains the same directory prefix and private lifecycle metadata so existing local-experience consumers continue to work.

Cleanup checks the directory and data path are not symlinks, exact owner marker, exact postmaster data-directory binding, valid PID, and no PID-file symlink. It invokes pg_ctl for that owned data directory only, verifies its PID file is gone, and then deletes only the owned directory. Start/callback failures still pass through cleanup; ownership or cleanup failure is surfaced rather than falling back or deleting unrelated state. The move adds no production connection source or business transaction change. The existing lifecycle tests now run in test:regression-tools, covering successful cleanup, partial startup, callback failure, ownership-marker refusal, and refusal of existing targets.

Reviewed selector and metadata: withEphemeralPostgres defaults to the original pinned Docker harness when POSTGRES_TEST_BIN is absent. An explicit native selector must be absolute; combinations with Docker-specific injected options are rejected. Native launch/work/cleanup failure propagates and never invokes Docker as fallback. Generic metadata contains only kind/configuredBy and native serverVersion; private cluster identity/configuration is omitted. Original finance paths retain their named selector compatibility, with conflicting generic/finance selectors rejected. The three other HTTP metadata consumers now forward the actual common harness metadata instead of labelling every common invocation Docker. Their direct legacy-entry precedence remains compatible; all regression suites remove these legacy overrides after selecting one common runtime.

Reviewed runner/CI: regressionSuiteEnvironment validates all six known selector spellings, rejects invalid or conflicting directories, removes GIT_* and ambient FAN_SUPPORT_* targets as before, normalizes to POSTGRES_TEST_BIN for all suites, and additionally supplies the existing local PostgreSQL path only to journey. No selector is invented when unconfigured. The generic low-level command runner preserves explicitly supplied environments. Root source inventory/preparation use the sanitized environment. The outer report describes selected mode, not proof of successful server startup. CI installs PostgreSQL 18, passes the common selector, preserves the existing five-suite failure aggregation and safe artifact scope, and check-ci mirrors that configuration.

Independent commands (no real database, Docker, browser, or long service started by this review):
- From packages/persistence-postgres: `mise exec node@24.20.0 -- corepack pnpm exec vitest run --config ../../vitest.config.ts --root . src/testing/ephemeral-postgres.test.ts src/testing/native-postgres.test.ts`: 15/15 PASS. Repeated with POSTGRES_TEST_BIN=/unit-selector-no-process: 15/15 PASS. All processes/clients are stand-ins. The first invocation used repo root and found no tests because this Vitest config includes src/ relative to each package; that invocation failure is retained separately and is not counted as test evidence.
- `mise exec node@24.20.0 -- node --test scripts/regression-environment.test.mjs scripts/regression-runner.test.mjs scripts/regression-ci.test.mjs apps/api/scripts/regression-finance-database.test.mjs apps/api/scripts/admin-finance-native-postgres.test.mjs`: 24/24 PASS. Repeated with the same ambient common selector after root isolated the runner fixture: 24/24 PASS. This includes owned temporary Git fixtures and injected native process/client stand-ins only.
- `mise exec node@24.20.0 -- node scripts/check-ci.mjs`: PASS.

Evidence logs: unified-native-independent-unit-package-root.txt, unified-native-independent-ambient-unit.txt, unified-native-independent-tools.txt, unified-native-independent-ambient-tools.txt, unified-native-independent-ci.txt. All six hashes in the implementation author's native-runtime-source.json matched the reviewed source. Parent separately reports native order-payment 6847 and full migration roundtrip PASS; those are parent-run evidence, not independently rerun here. Full next-run evidence is still required.

Candidate source manifest updated to 83 paths (41 tracked modifications, 42 new source/document files), with no missing current source changes and zero intersection with the original 6144 user-untracked paths. No staging/commit was performed. See owned-source-verification-final83.json. Existing Docker failures remain preserved with unresolved root cause.

Bound source SHA-256 values:
- `packages/persistence-postgres/src/testing/native-postgres.ts`: `325b21b7e73d5fa0cf5c658f03b18ef0d9b9b2141d7fc2b8164a3c3d079eea61`
- `packages/persistence-postgres/src/testing/native-postgres.test.ts`: `34db52d937d8b0c9c3bb307a78ce7494e64b350fd070674250e5babdf94fe884`
- `packages/persistence-postgres/src/testing/ephemeral-postgres.ts`: `57a8a8fdbfe2fe356577b9050287a05c1b3b32c19e9a102a5ae7f95c2b305875`
- `packages/persistence-postgres/src/testing/ephemeral-postgres.test.ts`: `3a03b82b5ac6acb1cb055d6ab8ae3be22bcb5ea064eca9dd4c88124cb5b1c6c5`
- `packages/persistence-postgres/src/index.ts`: `cabc2ca5af1e2472668adecefc0a20e1ccfc2b340abe326dcdf9de534d8c3fa1`
- `apps/api/scripts/admin-finance-native-postgres.mjs`: `61a162710e745c03211bdcb1b96f34f266c63dbcd1b6a73015bbb1df227dd29c`
- `scripts/regression-environment.mjs`: `c27df5a93ba8449c6b97a6d3c3a92e77a39de83c09d242a0c7521501b3433e08`
- `scripts/regression-environment.test.mjs`: `146cf1174a43279fb51a95a14a1d4a52000a20dded94ab160b68bba90ae9d240`
- `scripts/verify-regression.mjs`: `b0a01e1ceeeb256607bfda772a0633213ae6802a5ae1480646f19259eae33c35`
- `scripts/regression-runner.mjs`: `49e9bcd986f718ca1fa3dff8cc4a02b2e79866626eb8df33169c514c1610897a`
- `scripts/regression-runner.test.mjs`: `f0fc65a8add0a7986bbd96eec2ea8d3af39b62a7f7518bc946eb5148d55f0e3c`
- `scripts/regression-ci.test.mjs`: `6b0a446ffe73919a699e6089f0df37a6df4a8fe93e9d3b60243aa82c74150747`
- `scripts/check-ci.mjs`: `049b70945a38d622312ebfb0ccf7530c55712af75ad3d32e3ff52c9c6f1614e3`
- `.github/workflows/ci.yml`: `77d27e46561a5594ba0a2f16c3fdfbc384a02a0641340630a95ac7f38903f56d`
- `apps/api/scripts/admin-finance-test-database.mjs`: `e4dd46aef740d09db61be494e259245bcc521bc89d4aa04dcb99190e1eea429b`
- `apps/api/scripts/regression-finance-database.test.mjs`: `6ae314c08bd08c16cfa32a286333a0999d8b134959cabafdb2aa88e34ebefad5`
- `apps/api/scripts/admin-exceptions-http.mjs`: `bdaf6d0ee62852aaa5b068d0f736d8309eddad652705c42919beba0dee0a4ea8`
- `apps/api/scripts/admin-payment-config-http.mjs`: `7aae7c276f355322ed4809eb6eb3ae09f089ab9162b3015efee6a4cb0a6ab073`
- `apps/api/scripts/psp-onboarding-http.mjs`: `41382865e49b97747602e5608296aebf6e2ebcc24cb89868035fc41819fa51ea`
- `package.json`: `b66c58c592e908fa307c32b0a74937a35347e0aa67e5bff839cd13b6f9c2e76b`
