# P6-03 RUM independent review

Review state: **SOURCE_REVIEW_PASS_RUNTIME_PENDING**. Reviewer: `performance_matrix_audit`; review date: 2026-09-24. This is an independent source and lightweight-test review of the frozen RUM implementation, not a performance, field-p75, production, or release acceptance result. The reviewer did not start a browser, build, PostgreSQL fixture, or performance load.

## Scope and findings

Reviewed contracts and OpenAPI registration, layered server configuration, storefront root bootstrap/client collector/intake, the observation sink and aggregator, offline dashboard/reader, public package exports, `.env.example`, `check-observability.mjs`, and the coordinator's optional `localRum` TEST fixture wiring.

No unresolved blocking source finding remains in this scope. Three concrete faults discovered during the review cycle have reproducible failure tests and are fixed in the reviewed version:

1. The independent reviewer found that the dashboard reader silently discarded malformed JSON even when a line explicitly identified `performance.web_vital`. A truncated observation could disappear from the sample distribution. The author changed `readRumLogs` to fail closed for malformed RUM-marked lines while still ignoring ordinary non-RUM logs. `rum-corrupt-log-red.txt` / `rum-corrupt-log-green.txt` retain the author's transition; the independent CLI tests also pass.
2. The coordinator found a stream timeout race: cancellation could make a complete JSON body without EOF appear successfully finished. The reviewed `readBody` now sets an expiry flag and rejects before cancellation, and checks expiry after the race. The independent storefront suite includes the complete-body-without-EOF regression and passes. A valid prefix without stream completion cannot be acknowledged as 204.
3. The coordinator found that latest-revision-only deduplication could ignore two conflicting old revisions after a newer revision had arrived. The reviewed aggregator now validates values for every observed key/revision before latest-revision selection, under the existing 100000-record limit. The independent rerun includes the newer-first conflict case and passes.

## Boundaries verified in source

- Contract v1 uses strict objects and bounded numbers. Browser data contains only enumerated locale/page-family/viewport/automation, metric name/value/navigation type, and an opaque random per-metric key/revision. No raw URL, query, fragment, DOM entry, business identifier, cookie, support message, or display name is accepted by the observation contract.
- The browser request uses `credentials: omit`, `referrerPolicy: no-referrer`, bounded contract data and a fixed endpoint. The collector does not send raw web-vitals IDs or attribution entries. The server owns mode, sampling configuration and receipt time.
- Default configuration is disabled. Field mode requires the production tier; local mode is limited to development/test/preview/staging. Disabled or zero-sampled bootstrap returns before rendering the collector. Order-access is excluded by the server bootstrap and unsupported current routes are rejected by the client callback.
- Intake requires configured request origin, an exact Origin header, and `Sec-Fetch-Site: same-origin`. Query strings are rejected. JSON body size is capped at 2048 bytes even without Content-Length; body reading is capped at two seconds. Admission is bounded to 600 requests/minute/process and 16 active bodies or unsettled writes. A timed-out sink returns 503 but retains its slot until it actually settles; no unbounded timed-out write queue is created.
- Metrics use actual `web-vitals` subscriptions. There is no synthetic INP or TBT substitute. Ordinary SPA activity retains initial hard-document attribution. Unsupported soft-navigation metrics are rejected. BFCache restore after a pathname change is excluded; same-path restore uses the library's new metric identity, and each key's viewport context stays stable across revisions.
- Aggregation validates input, deduplicates by key/revision, rejects conflicting identity/value, applies an explicit receipt window, and computes nearest-rank p75 per mode/sampling/locale/page/viewport/automation/metric stratum. Missing metrics are not inserted as zero. Local or automated observations are `LOCAL_ONLY`; under-sampled field rows are `INSUFFICIENT`. There is no aggregate release-PASS flag.
- The CLI has bounded input files/bytes/line size/record count, fails closed for invalid RUM records, and does not overwrite existing output files. Dashboard cells use text content and embedded report JSON escapes HTML delimiters. Its warning explains that an apparent field/browser label is not proof of real-user provenance or release acceptance.
- Fixture changes are additive: `localRum=false` preserves the existing environment object and default execution. Explicit enablement is injected only into the owned TEST child runtime, not the preview build. Enabling on a non-TEST environment fails. The H2 read-only viewer is unchanged. Formal performance collection remains explicitly RUM-disabled; the enabled RUM browser run uses same-origin HTTP.
- Contracts and observability expose narrow public RUM exports; the dashboard resolves these through storefront's declared dependencies. Configuration keys are registered in the existing layers and `.env.example` test. The existing observability-boundary check passes with the additive export.

## Independent verification

All commands used Node 24.20.0 through `mise`. Package Vitest commands were run from their package directory with `--config ../../vitest.config.ts --root .`.

| Evidence | Result |
| --- | --- |
| `rum-independent-contracts-2.txt` — `src/rum.test.ts src/rum-openapi.test.ts` | 2 tests PASS |
| `rum-independent-config-2.txt` — `src/rum-config.test.ts` | 1 test PASS |
| `rum-independent-observability-3.txt` — `src/rum.test.ts`, including newer-first revision conflict | 4 tests PASS |
| `rum-independent-storefront-2.txt` — client, intake, bootstrap | 11 tests PASS |
| `rum-independent-env-example.txt` — env example contract | 2 tests PASS |
| `rum-independent-cli-tests.txt` — `node --test scripts/render-rum-dashboard.test.mjs` | 2 tests PASS |
| `rum-independent-fixture-tests.txt` — `node --test apps/api/scripts/storefront-test-rum-config.test.mjs` | 3 tests PASS |
| `rum-independent-observability-boundary.txt` — `node scripts/check-observability.mjs` | PASS, exit 0 |

Total: **25 independent lightweight tests PASS**, plus the observability-boundary check. The earlier observability `-2` log predates the added regression; `-3` is the final rerun. Early logs without the `-2` suffix are intentionally retained: those attempts used the wrong Vitest root/config combination and failed before collecting tests. They were invocation errors, not successful product verification and not concealed product failures.

## Required runtime and external evidence

The coordinator must still execute the owned Chrome runner and prove real `onLCP`/`onINP`/`onCLS` callbacks, 204 acknowledgments, header/body privacy, matching server observations and CLI distribution, and zero order-access collection across all fourteen locale/viewport cells. This review alone does not prove navigation-flush behavior, BFCache behavior in the shipped browser, or bytes actually requested by the compiled build.

In particular, source-level conditional collector rendering does not by itself prove that disabled-mode bundles are absent from Next's compiled network path. Record actual disabled/enabled script/font/resource bytes and explain their delta. The default-disabled formal H2 matrix and local-enabled HTTP observations use different transport paths; their resource sizes can be compared, but their timings must not be presented as a controlled performance A/B experiment.

Local automation establishes instrumentation behavior only. Actual production-origin/proxy configuration, enabled-field network cost, real-user sample volume and p75, staging/gray release, and operating capacity remain separate acceptance work. The existing performance and business-flow gates must remain unchanged.
