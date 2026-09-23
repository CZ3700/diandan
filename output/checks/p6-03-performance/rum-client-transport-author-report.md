# RUM empty acknowledgement consumption — author report

Status: **PRODUCT PATCH FROZEN; focused tests and package typecheck PASS; fresh complete-site acceptance pending root candidate 4**. Author: `/root/performance_rum_audit`. The independently authored browser tooling and its source review are separate from this product change.

## Evidence and minimal change

The preserved controlled real-Chrome comparisons `rum-transport-void-probe.json` and `rum-transport-consume-probe.json` isolated a transport difference: discarding the Response or examining only its status yielded a real 204 followed by `net::ERR_ABORTED` before cleanup; consuming the empty acknowledgement yielded CDP and Playwright completion. These controlled probes use a small HTTP receiver, not the actual Next intake, and do not substitute for full-site RUM acceptance. Earlier failing real-site and lifecycle regression attempts remain failures.

Only `apps/storefront/src/storefront/rum-client.ts` and the new `rum-client-transport.test.ts` are included in this patch. The sender now awaits `response.arrayBuffer()` only for status 204, then preserves the original handled-rejection tail. It never reads arbitrary non-204 bodies. Endpoint, payload, keepalive, omitted credentials/referrer, no-store, sampling, privacy, callback behavior and no-retry policy are unchanged. The test exercises the real `startBrowserRum` transport with a mocked library subscription and fetch; browser acceptance continues to use real library callbacks and browser input.

## Genuine RED before implementation

From `apps/storefront`:

```sh
../../node_modules/.bin/vitest run --config ../../vitest.config.ts --root . --maxWorkers=1 src/storefront/rum-client-transport.test.ts
```

`rum-client-transport-red.txt`: exit 1; 2 of 3 tests failed because the 204 body consumer was called zero times instead of once. Both successful and rejected empty-body paths exposed the missing behavior. The non-204/network-failure test already passed. This is an actual behavior failure before the product edit, not a startup error or an implementation-after-the-fact counterexample.

## Focused GREEN and limits

The recorded GREEN invocation used the same runner with `rum-client-transport.test.ts`, `rum-client.test.ts`, `rum-provider.test.tsx`, and `src/server/rum-intake.test.ts`. The `rum-provider.test.tsx` filter does not name an existing file, so **only the 3 matching files / 13 tests ran**; no bootstrap/provider coverage is claimed from this invocation. The actual bootstrap file is `src/server/rum-bootstrap.test.tsx` and remains in root's complete candidate acceptance scope.

- `rum-client-transport-green.txt`: exit 0, 3 files / 13 tests PASS. Tests cover successful 204 consumption, rejected 204 body consumption without unhandled rejection/retry, no consumption for 200/400/403/429/503, and handled network rejection.
- `rum-client-transport-lint.txt` and `rum-client-transport-format.txt`: focused ESLint and Prettier checks PASS for both changed files.
- These focused checks used Node v26.3.0; root's complete acceptance uses the pinned Node v24.20.0. This author did not run typecheck, build, or a browser concurrently with root's measurements.
- `rum-client-transport-source.json` records exact SHA-256 values and freeze time. The independent matrix author subsequently accepted this minimal product diff and ran `rum-lifecycle-regression-4/results.json`: 4 controlled cells PASS, 6 completed 204 exchanges equal 6 receiver records, two sensitive-document negative cases with zero POST attempts. This is controlled transport evidence, not the complete Next integration or field evidence.

Root must build a fresh candidate from this changed shared chunk and rerun the actual 14-cell Next RUM chain plus the full formal performance matrix. Earlier formal performance results cannot certify this new source. No root lockfile, contract, configuration, intake, aggregate, tool, progress, commit or push was changed by this patch.

## Candidate 3 typecheck failure and fixture-only correction

Root's complete check found the new metric fixture omitted locked web-vitals 6.2.2's required numeric `navigationId`. The original failure remains in `candidate-3-check-dev.txt`. This is a real typecheck failure in the new test, not a production transport failure. The minimal correction adds `navigationId: 1` and replaces the type assertion with `satisfies MetricType`, so fixture completeness is checked rather than bypassed. Production `rum-client.ts` is unchanged, including the exact SHA used in the independently successful real-Chrome regression.

All following commands used `mise exec node@24.20.0 --` and returned outer exit 0:

- From `apps/storefront`, `../../node_modules/.bin/tsc -p tsconfig.build.json` → `rum-client-transport-typecheck-2.txt`, PASS.
- From `apps/storefront`, the same Vitest command with exactly the three existing `rum-client-transport.test.ts`, `rum-client.test.ts`, and `src/server/rum-intake.test.ts` filters → `rum-client-transport-green-2.txt`, 3 files / 13 tests PASS.
- Focused ESLint and Prettier checks on both patch files → `rum-client-transport-lint-2.txt` / `rum-client-transport-format-2.txt`, PASS.

`rum-client-transport-source-2.json` preserves the new freeze, pinned runtime and logs. Production SHA remains `90d5f4e142acd735202e55dde0f969c386a77a3b0cf3284dc420bd1a938204fb`; test SHA is now `051806d3ae4ae3a9caf31f735cf715008dc5ead9a6011dc4bc085bf8f89a0cd0`. The previous freeze and failure logs are retained. Root proceeds with candidate 4; full-site and formal performance results remain pending.
