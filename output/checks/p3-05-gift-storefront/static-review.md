# P3-05 bounded static gate run

Executor: storefront_directory. This is a point-in-time static run during integration,
not a claim that the full root `pnpm check` passed. No product source, Git index,
legacy output, browser evidence, checker policy or recorded fingerprint was changed.
The requested contracts command rebuilt its normal generated `dist` build artifacts.

All commands use `mise exec node@24.20.0 --` before the command below.

| Command | Result | Independent log |
| --- | --- | --- |
| `node scripts/check-workspace.mjs` | PASS: 4 apps, 31 packages, 35 units, no cycles | static-workspace.log |
| `corepack pnpm check:ui-primitives` | PASS: 43 tests and real source scan | static-ui-primitives.log |
| `corepack pnpm check:ui-interactions` | PASS: 39 tests and real source scan | static-ui-interactions.log |
| `corepack pnpm check:ui-composites` | FAIL: 9/10 tests; persisted browser fingerprint stale | static-ui-composites.log |
| `corepack pnpm check:ui-motion` | FAIL: 11/12 tests; current fingerprint could not read a removed tracked route | static-ui-motion.log |
| `node --test scripts/check-domain-boundaries.test.mjs` | PASS: 8 tests | static-domain-boundaries-tests.log |
| `node scripts/check-domain-boundaries.mjs` | PASS | static-domain-boundaries.log |
| `node --test scripts/check-adapter-boundaries.test.mjs` | PASS: 32 tests | static-adapter-boundaries-tests.log |
| `node scripts/check-ci.mjs` | PASS | static-ci.log |
| `node scripts/check-runtime.mjs` | PASS | static-runtime.log |
| `node scripts/check-observability.mjs` | PASS | static-observability.log |
| `corepack pnpm check:contracts` | PASS: 2 fresh artifacts, canonical locale ownership | static-contracts.log |

The composites and motion commands stop at their failing test step; their subsequent
standalone source/evidence scans were not run by those `&&` command chains. The final
adapter declaration scan was intentionally not run before the final build.

## Required follow-up

P2-04's persisted source fingerprint is stale. The read-only comparison in
`static-composite-fingerprint-diff.log` identifies 10 changed/added inputs: root
package.json and the new contracts/artifact source/generated files. Existing browser
artifacts were not altered.

P2-05 currently reports ENOENT for
`apps/storefront/src/app/(public)/(japanese)/ja/gifts/[[...path]]/page.tsx`.
Its fingerprint collector uses `git ls-files --cached --others`; all seven old gift
catch-all route files remain unstaged deletions, so they are still selected from the
index although the source has intentionally moved to list/detail routes. Root should
include the actual route deletions in normal checkpoint staging before capturing
new motion evidence. Staging resolves this input-list issue; it does not refresh
old browser evidence or prove the new UI.

After source and route ownership are frozen, run real browser verification:

```sh
mise exec node@24.20.0 -- node scripts/verify-ui-composites-browser.mjs
mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs
```

Then rerun the two static UI commands against their newly generated evidence. Do
not substitute a hash-only update. Complete final build and adapter declaration
scan separately, followed by the project's aggregate validation workflow.
