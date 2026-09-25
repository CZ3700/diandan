# P6-03 performance tool scope and execution

Reviewer/implementation owner: `/root/performance_matrix_audit`. Baseline: `b7df3400`. Read the SPEC, MASTER, Phase 6, task breakdown, project skill, previous P3-06 H2 evidence and current source. This record does not claim a browser or performance run; no build/browser/database load was started by this agent.

## Fixed formal plan

1. Preserve the existing `verifyAcceptancePerformance`: 84 initial resource navigations (seven locales, six original page families, 390×844 and 1440×900), then 63 mobile Lighthouse 13.4.1 samples (home/artist/gift × seven locales × three). All three samples remain; score median ≥0.9, LCP median <2500ms, CLS median <0.1. JS <150000 gzip bytes and hero/regular image <600000/<400000 bytes remain distinct SHOULD recommendations. The only compatible extension is an optional configuration factory with the old factory as default.
2. Add seven public page families × seven locales × the six SPEC viewports = 294 resource cells. Page families are the original six plus `/gifts` without market/currency. Every cell records current same-navigation content, actual width/height, overflow, first-navigation script/style/font/image bytes and errors, font asset SHA against the current locale profile, unique catalog-message markers and foreign-script count. Lab LCP/CLS is observed without throttling in this same navigation; this is neither a Lighthouse score nor field p75/INP.
3. The Lighthouse extension adds a separate current-content audit to the original validity category. It retains the original hero/artist checks and additionally requires populated homepage gift cards. It changes no standard Lighthouse category weight, network/CPU option, viewport default or metric budget. Current content cannot be replaced with an HTTP-200 error/skeleton page.
4. `--diagnostic` is a fixed zh-CN home/artist/gift set: three 390×844 resources and nine Lighthouse samples (three each). Its terminal state is `DIAGNOSTIC_COLLECTED`, `formal=false`; formal aggregation explicitly rejects it. It is not a shortened acceptance matrix.

The formal plan deliberately does not produce 378 additional desktop/tablet Lighthouse runs using a mobile scoring profile. The original mobile baseline remains comparable, while the six actual screen sizes have independent resource/layout/lab timing observations. Estimated duration must come from actual runs; sampling must remain exclusive of builds, browsers and PG benchmarks. No best-run selection, retries or hidden prewarm.

## Execution in a frozen owned workspace

Build the original dependency selection first (outside sampling):

```sh
mise exec node@24.20.0 -- corepack pnpm exec turbo run build --filter=@fan-support/api... --filter=@fan-support/worker... --filter=@fan-support/storefront^... --output-logs=errors-only --concurrency=2
```

Then run one of:

```sh
POSTGRES_TEST_BIN=/absolute/path/to/native/postgres/bin mise exec node@24.20.0 -- node apps/api/scripts/performance-owned.mjs --diagnostic
POSTGRES_TEST_BIN=/absolute/path/to/native/postgres/bin mise exec node@24.20.0 -- node apps/api/scripts/performance-owned.mjs
```

The entry accepts no user instance or external URL. It uses the existing real ephemeral PostgreSQL/TLS S3 fixture, 120 normally published artists, published gifts/policies/homepage, production-compiled Next and original protocol preflight. `catalogDirectoryRoute` currently includes the new `browseGifts` use case, so the old fixture can serve the new homepage gift area. The runtime builds once before collection. The owned GET/HEAD H2 viewer preserves its original transport restrictions, certificate pin exception and cleanup. This is local TEST H2, not deployed CDN, production TLS or cloud acceptance.

Results use a new timestamped `output/checks/p3-06-storefront-acceptance/run-*/browser-attempt-1/` directory: original `performance/`, `six-screen/results.json`, optional `diagnostic-lighthouse/`, `performance-context.json` and viewer snapshots. The outer fixture callback can finish normally for diagnostics; only the inner plan/status defines formal acceptance. Keep failures and all original raw reports. Root is responsible for copying/freezing the tool version into both baseline/candidate workspaces, retaining source manifests, actual versions and final archive SHA checks.

The H2 matrix explicitly records RUM disabled, matching the current default delivered configuration. Enabled local RUM uses a separate same-origin TEST verification; it must not be silently enabled behind the read-only viewer or counted as measured in this matrix.

## Gaps and guardrails

- The old collector observed only script/image responses and only two sizes. It cannot independently prove font/CSS delivery, locale catalog isolation, new homepage gifts or six viewport coverage; the new matrix supplies those checks.
- Catalogs currently load by locale server-side and pass current copy through RSC. Marker checks examine actual received JS/document bytes, retain only counts/locale identities, and reject foreign unique catalog markers. This is direct loaded-byte evidence, not a claim that server build artifacts contain only one locale.
- Font hashes come from the canonical `FONT_PROFILE_BY_LOCALE` CSS cascade, including generated subsets and fallback files; no unrelated locale font may be loaded. No font-byte mutation or fake font success is used.
- Every current page requires nonempty expected text/card content and no visible error/empty state. Metrics and resource observations missing from a cell cannot satisfy formal coverage. Only initial-navigation resources are measured: no forced eager images or scroll preloading.
- Third-party script absence means no non-origin script response in the observed public pages. RUM transport tests, authenticated checkout/order behavior, large-catalog PG response cost and public cache revalidation remain separate evidence; do not infer them from this matrix.
- Images/JS recommendations retain original strict decimal byte budgets. Six-screen unthrottled timings do not replace mobile slow-4G Lighthouse or real-user p75. Current synthetic media does not substitute for final approved photography, real network/phone or staging.

## Tool verification so far

`matrix-tools-red.txt` retains the initial missing-implementation failure. `matrix-tools-final.txt`: 15/15 lightweight tests PASS (new plan/resource/current-content tests plus original seven performance tests). Targeted Prettier and ESLint passed. A dynamic import of `performance-browser.mjs` succeeded without opening a browser. Runtime validation is still for root to execute serially; none is claimed here.
