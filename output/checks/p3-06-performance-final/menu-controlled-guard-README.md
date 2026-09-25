# Controlled Menu interaction guard

Scope: only `scripts/check-ui-interactions.mjs` and `.test.mjs`, isolated performance worktree. The author implemented this checker update; independent review is delegated to storefront_e2e. No product, API, contract, browser, or build work is claimed by this entry.

The checker retains the legacy live `useState(false)` binding and accepts the current optional controlled `controlledOpen ?? internalOpen` binding only when real destructured props, internal state, live Root props, touch dismissal cancellation, conditional internal setter, and optional external callback are structurally connected. Existing scroll locking, touch event, lifecycle, style and locale checks remain active. The only supported Root spread is the current conditional triggerId addition.

Protected Menu bindings must be unique and unwritten. The bounded check rejects local shadowing, direct or destructuring assignment, compound assignment, and update writes to those bindings. `undefined` must not be shadowed, including by a namespace value import. This is a source guard for the two supported implementations, not a general JavaScript evaluator.

## Evidence

All files below are in this directory. Effective failures are retained:

- `menu-controlled-guard-red.log`: legal controlled fixture rejected by the old gate, 1 FAIL / 15 PASS.
- `menu-controlled-guard-shadow-red.log`: controlled prop renamed to undefined defeats comparison binding, effective failure.
- `menu-controlled-guard-module-shadow-red.log`: module-level undefined value shadows the comparison, effective failure.
- `menu-controlled-guard-write-red.log`: 4 FAIL for reassigned control, reassigned callback, destructured callback assignment, and namespace undefined import. The independent reviewer also reproduced three of these directly against the real Menu AST.
- `menu-controlled-guard-final-green.log`: all 90 tests PASS, no skipped tests.
- `menu-controlled-guard-final-actual.log`: actual repository interaction gate PASS.
- `menu-controlled-guard-final-lint.log`: scoped ESLint exit 0.
- `menu-controlled-guard-final-format.log`: scoped Prettier check exit 0.

Commands (Node 24.20.0 through mise): `node --test scripts/check-ui-interactions.test.mjs`; `node scripts/check-ui-interactions.mjs`; `corepack pnpm exec eslint` and `prettier --check` for the two scoped files.

Final source SHA256:

- checker: `dc24e9fa8a9dbc119eb4b8177a2779f26c7ad52a32c10b1e6bbd5286da3ae551`
- tests: `84bc71861cc30dad4232152f2575e8d79a3ba3a6807eb4e5888f9b82b2075f96`

The new controlled Menu and lazy language UI still require their own browser/focus and performance evidence. This checker result does not establish either, nor complete P3-06.

## Final independent-review follow-up

The preceding 90-test hashes and `final-*` logs are retained as an intermediate snapshot. The independent reviewer then reproduced one more assignment target, `for (controlledOpen of [false]) {}`, against that snapshot. `menu-controlled-guard-loop-red.log` records its effective 1 FAIL. The same bounded write check now covers non-declaration for-in/of initializers, reusing its assignment-target predicate.

Final frozen evidence supersedes the intermediate snapshot:

- `menu-controlled-guard-freeze-green.log`: 91/91 tests PASS, 0 skipped.
- `menu-controlled-guard-freeze-actual.log`: actual gate PASS.
- `menu-controlled-guard-freeze-lint.log` / `menu-controlled-guard-freeze-format.log`: exit 0.
- checker SHA256: `58fcc38d35342f01c463b7bdb109cd77467479d1e6e9d2f8f3222f00d2ef52c7`.
- test SHA256: `326ada93bb8a9f6e4ecc17a97f21e2b90a0d7740ff26dcf6a4d88f4d075980ec`.

Independent review: storefront_e2e reported ACCEPT on the final two hashes. Its read-only in-memory probe accepted the actual Menu and rejected state reassignment, callback reassignment, destructured callback assignment, namespace undefined, and for-of assignment variants. It read the effective RED and final 91-test/actual/format evidence, and found no weakening of the original cancellation ordering or lock lifecycle. It did not run a browser or modify files.
