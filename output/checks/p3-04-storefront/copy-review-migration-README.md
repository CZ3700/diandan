# Storefront review manifest — canonical locale ownership

The full repository contract check rejected the handwritten seven-locale object in the storefront review manifest. This repair follows the existing admin manifest pattern: one `.review.ts` record per locale, an exhaustive `reviewForLocale` switch, and an aggregate derived from contracts-owned `SUPPORTED_LOCALES` with `Object.fromEntries` / `Object.freeze`.

Only `packages/i18n/src/storefront/review-manifest.ts` and seven new sibling `.review.ts` source files changed. No checker exception, locale definition, copy message byte, production approval algorithm, hash, reviewer, status, or approved commit changed. All records remain DRAFT.

Before editing, the existing TypeScript manifest was transpiled in memory and its actual exported aggregate saved as `copy-review-manifest-before.json`. The one-time migration test `copy-review-migration.test.mjs` compares `JSON.stringify` of the complete built aggregate and every independently imported locale record against that baseline, and verifies that the aggregate selects the same module object.

## Verification

All commands use `mise exec node@24.20.0 --`.

| Check | Result | Evidence |
| --- | --- | --- |
| `node --test output/checks/p3-04-storefront/copy-review-migration.test.mjs` before implementation | Expected RED: existing aggregate matches; seven independent modules absent | `copy-review-migration-red.log` |
| `corepack pnpm --filter @fan-support/i18n build` | PASS | `copy-review-migration-build.log` |
| Same migration test after build | PASS: 8 tests; complete and per-locale JSON identical | `copy-review-migration-green.log` |
| `corepack pnpm --filter @fan-support/i18n test` | PASS: 4 files / 25 tests, including exact-hash and production approval adversarial tests | `copy-review-migration-i18n-tests.log` |
| Scoped Prettier check of manifest and seven review modules | PASS | `copy-review-migration-format.log` |
| Scoped ESLint of manifest and seven review modules, zero warnings | PASS | `copy-review-migration-lint.log` |
| `corepack pnpm --filter @fan-support/i18n typecheck` | PASS | `copy-review-migration-typecheck.log` |
| `node scripts/check-contracts.mjs` | PASS: two contract artifacts fresh; canonical locale ownership preserved | `copy-review-migration-contracts.log` |

The migration baseline and one-time test are verification artifacts; they are not imported by production code or used as another locale configuration. Source is frozen after these checks. Full repository verification and source-hash update remain with root.
