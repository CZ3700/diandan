# Native runtime runner independent review

- Reviewer: `seven_locale_journey` (independent of the root runner implementation).
- Date: 2026-09-23.
- Scope: `verify:regression` six-selector normalization, subprocess propagation, CI contract, tooling runbook, finance selection and HTTP runtime metadata forwarding.
- Mode: source review and lightweight Node tests only. No PostgreSQL, Docker, S3, application server or browser was started. Temporary Git/Node fixtures from the runner tests were cleaned by those tests. No user experience instance was touched.
- Initial result: **CHANGES REQUIRED** for one newly exposed test-fixture environment conflict; implementation conflict rejection itself is correct. Final follow-up, if any, is appended below without deleting this failure.

## Initial independent verification

1. `mise exec node@24.20.0 -- node --test scripts/regression-environment.test.mjs scripts/regression-runner.test.mjs apps/api/scripts/regression-finance-database.test.mjs`: exit 0, **17/17 PASS** with the review shell's ordinary environment.
2. `mise exec node@24.20.0 -- node scripts/check-ci.mjs`: exit 0, `CI contract check passed`.
3. `POSTGRES_TEST_BIN=/explicit/postgres/bin mise exec node@24.20.0 -- node --test scripts/regression-environment.test.mjs scripts/regression-runner.test.mjs apps/api/scripts/regression-finance-database.test.mjs`: exit 1, **16/17 PASS**, one failure.

The third command does not try to access this synthetic path: these tests use injected runtime functions or harmless Node/Git subprocesses. It checks the same environment condition that the actual native regression and CI will provide.

## Finding requiring closure

`scripts/regression-runner.test.mjs:118` (fixture setup at lines 155–161) spreads `process.env`, preserving the newly supported `POSTGRES_TEST_BIN`, then sets two legacy selectors to `/owned/postgres`. Any actual configured native directory differing from that fixture directory triggers the correct `regressionSuiteEnvironment` conflict check before the test child runs. The reproducible error is the fixed literal `Conflicting regression PostgreSQL tool directories`, from `scripts/regression-environment.mjs:20`.

This would fail the quality group's regression-tool tests under the new CI configuration. The minimal correction is to isolate the test fixture's six selectors before installing its intended values. Do not weaken the production conflict rule or remove explicit native selection from CI. The finding was sent to root for the owned test-file correction.

## Accepted source boundaries

- `scripts/regression-environment.mjs:3–34` includes all six known tool selectors. Only `undefined` means absent; empty and relative paths fail, and multiple unequal paths fail. Equal legacy values are normalized to `POSTGRES_TEST_BIN`; legacy keys are removed, with only the journey's equivalent `FAN_SUPPORT_LOCAL_POSTGRES_BIN` reintroduced. Host tooling is preserved; ambient `FAN_SUPPORT_*` application configuration and `GIT_*` overrides are removed.
- `scripts/verify-regression.mjs:66` validates selection before source-copy preparation; `scripts/regression-runner.mjs:73` applies normalization to each suite subprocess. The prepared local journey subsequently receives its fixture-owned environment unchanged.
- `.github/workflows/ci.yml:29` and `scripts/check-ci.mjs:76` agree on the single PostgreSQL 18 tool directory. The matrix still contains all five suites; the aggregate Quality job requires all matrix jobs to succeed.
- PostgreSQL integration Node commands execute after their build command in the package shell; they are not database tests launched as a Turbo task. `packages/media-s3/scripts/ephemeral-s3-harness.mjs:426–430` retains the tool selector when starting its child. No current loss of the common selector was identified along these paths.
- `apps/api/scripts/admin-finance-test-database.mjs:13–30` rejects conflicting finance/common selectors, retains the explicit legacy native branch, and forwards the common helper's actual metadata without relabeling native as Docker. Its injected tests establish dispatch, no fallback after operation/cleanup errors, and removal of private metadata fields from the legacy native branch; they do not prove a real database lifecycle.
- Default callback paths in `admin-payment-config-http.mjs:166`, `admin-exceptions-http.mjs:246`, and `psp-onboarding-http.mjs:179` now forward the runtime's actual metadata. No remaining default callback hardcodes Docker metadata in these reviewed paths.
- `report.postgresSelection` at `scripts/verify-regression.mjs:67–75` is a safe selection record with closed descriptive strings, not evidence that every service started or that a particular server version ran. It emits neither the configured filesystem path nor connection/private data. The runbook explicitly distinguishes that record from actual runtime evidence; real PostgreSQL version validation and full-matrix execution require separate evidence.
- `docs/testing/full-regression.md:3–9,33` is scoped to the full-regression entry. It preserves default Docker temporary databases plus the native persistent journey when no selector is supplied, distinguishes local evidence from external acceptance, and does not claim that selecting native repairs historical Docker failures.

## Existing compatibility boundary (not a new blocker)

Standalone legacy payment-configuration/PSP tools still contain truthy selector handling; some old direct `--native-bin` and local-experience tools do not compare their selection to the new common variable. Those are existing compatibility entrypoints outside the full-runner normalization guarantee. The full runner strips their legacy selector values after validating all six inputs, so they do not bypass its common choice. This review neither changes those entrypoints nor claims that independently invoking every legacy tool has been unified.

## Initial source fingerprints (SHA-256)

```text
c27df5a93ba8449c6b97a6d3c3a92e77a39de83c09d242a0c7521501b3433e08  scripts/regression-environment.mjs
146cf1174a43279fb51a95a14a1d4a52000a20dded94ab160b68bba90ae9d240  scripts/regression-environment.test.mjs
49e9bcd986f718ca1fa3dff8cc4a02b2e79866626eb8df33169c514c1610897a  scripts/regression-runner.mjs
aaa86a70391636a76313b5f6022dfdae79c1904bb0d7cfc04c86f0e3aebbc9f6  scripts/regression-runner.test.mjs
b0a01e1ceeeb256607bfda772a0633213ae6802a5ae1480646f19259eae33c35  scripts/verify-regression.mjs
77d27e46561a5594ba0a2f16c3fdfbc384a02a0641340630a95ac7f38903f56d  .github/workflows/ci.yml
049b70945a38d622312ebfb0ccf7530c55712af75ad3d32e3ff52c9c6f1614e3  scripts/check-ci.mjs
0d8c68590881c6aa02aa10a9618ddcf9492c7f2bcf98fb5613d8f0c47f8183d5  docs/testing/full-regression.md
e4dd46aef740d09db61be494e259245bcc521bc89d4aa04dcb99190e1eea429b  apps/api/scripts/admin-finance-test-database.mjs
6ae314c08bd08c16cfa32a286333a0999d8b134959cabafdb2aa88e34ebefad5  apps/api/scripts/regression-finance-database.test.mjs
7aae7c276f355322ed4809eb6eb3ae09f089ab9162b3015efee6a4cb0a6ab073  apps/api/scripts/admin-payment-config-http.mjs
bdaf6d0ee62852aaa5b068d0f736d8309eddad652705c42919beba0dee0a4ea8  apps/api/scripts/admin-exceptions-http.mjs
41382865e49b97747602e5608296aebf6e2ebcc24cb89868035fc41819fa51ea  apps/api/scripts/psp-onboarding-http.mjs
```

## Independent follow-up: ACCEPT for the bounded tooling change

Root corrected only the affected runner-test fixture: `scripts/regression-runner.test.mjs:156` now supplies `PATH: process.env.PATH`, rather than spreading ambient selector values. The child executable is the absolute `process.execPath`; fixture inputs remain explicitly constructed. Production selection and conflict rejection are unchanged.

The full `test:regression-tools` command in `package.json:71` additionally includes the existing `apps/api/scripts/admin-finance-native-postgres.test.mjs`. Its five tests exercise private fresh ownership, partial-start shutdown/cleanup, callback-failure cleanup, refusal to clean a mismatched ownership marker, and rejection of existing-database/relative-path inputs. They inject command and client implementations: this is lifecycle contract evidence, not a real PostgreSQL run.

Independent follow-up commands:

```sh
POSTGRES_TEST_BIN=/explicit/postgres/bin mise exec node@24.20.0 -- node --test scripts/regression-environment.test.mjs scripts/regression-runner.test.mjs apps/api/scripts/regression-finance-database.test.mjs apps/api/scripts/admin-finance-native-postgres.test.mjs
mise exec node@24.20.0 -- node scripts/check-ci.mjs
```

Results: **22/22 PASS, exit 0**; **CI contract check passed, exit 0**. The previously failing explicit-native environment case now passes without suppressing or changing the conflict gate. No service was started. No remaining concrete P1/P2 finding was identified in this bounded runner/CI/metadata change. This acceptance does not assert that the full five-suite matrix, Ubuntu CI runtime, or real database lifecycle has passed; those require their own actual execution evidence.

Superseding/additional fingerprints (all other reviewed fingerprints above remain applicable):

```text
f0fc65a8add0a7986bbd96eec2ea8d3af39b62a7f7518bc946eb5148d55f0e3c  scripts/regression-runner.test.mjs
b66c58c592e908fa307c32b0a74937a35347e0aa67e5bff839cd13b6f9c2e76b  package.json
7c3167947c176a2ac1808af2ad8e5cf981ed72377daf613211bf6a7f0adcdc84  apps/api/scripts/admin-finance-native-postgres.test.mjs
```
