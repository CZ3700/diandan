# RUM lifecycle harness diagnosis and conditional tool handoff

Scope: only owned Chrome processes and ephemeral profiles, controlled public HTML and actual repository collector + locked web-vitals. No product source change, metric callback injection, synthetic visibility event, fabricated metric, real-user claim, or performance gate change.

## Observed failures

1. Original full fixture interactions all passed, with HTTP 200 search and six results. The original exit navigation produced server LCP/INP/CLS but only one browser acknowledgement. Candidate2 diagnostic overlay was restored to original SHA `de75af96bc05ea9ec69b7f6611810f9d4628c0060920e9a627ae86715020e912`; byte backup and overlay identity are retained separately.
2. `rum-lifecycle-probe.json` reproduces this with actual collector/web-vitals and trusted Chrome input: original navigation gives three server records, only LCP request/response in both page and context. Observed headers validate. Thus early headers or a BrowserContext listener alone cannot repair absent events.
3. CDP frozen/active, foregrounding another Playwright tab, and minimizing a headed window did not produce actual hidden state; these experiments remain FAIL, not accepted substitutes.
4. Locked Playwright 1.62.1 normally enables focus emulation. A separate CDP session cannot remove that original session override. Its documented `connectOverCDP({noDefaults:true})` on a fresh owned default context allows actual native tab hiding. `rum-lifecycle-native-green.json` proves a real hidden event and all three 204/header validations. This earlier probe did not gate request completion; it is not final acceptance.
5. The stronger regression added request-failure and response-finished checks. `rum-lifecycle-regression-1/2/3` remain RED with `net::ERR_ABORTED` after 204. No error whitelist was added.
6. `rum-transport-consume-probe.json` isolates the latter without web-vitals or hiding: while the original document remains visible, `void fetch(...).catch(...)`, awaiting status only, and then(status) receive 204 followed by CDP/PW cancellation. Consuming the empty response via text or arrayBuffer instead yields both CDP and PW requestfinished. All these events occur before browser cleanup. This is evidence of response-consumption-dependent behavior, not proof of a specific GC event. Product changes remain the root/author responsibility.

## Frozen tool behavior

- `rum-browser-lifecycle.mjs` creates a Launcher before awaiting startup, with a new owned temporary profile and only the TEST certificate SPKI exemption. It uses the actual Chrome binary and explicit automation flag. Connection uses noDefaults only on the owned default context. Every positive and excluded page gets a separate browser/profile; no existing user browser is attached.
- Actual innerWidth/innerHeight must equal 390×844 or 1440×900; reduced motion is explicitly no-preference as in the original positive measurement.
- Original trusted language menu and artist search actions/query are preserved. The tool opens an empty owned tab, requires visible→hidden with trusted visibilitychange, and proves same Document, URL, and time origin without exporting the raw URL.
- Positive acknowledgement still requires LCP/INP/CLS in the original ten-second poll. Each exchange must pass existing strict schema/header/privacy/204 checks and complete its response. Request attempts, safe stage/status/metric/failure-code metadata, and errors are retained even on failure. Observation waits are bounded; no error code is ignored.
- The order-access negative uses a new owned browser and the same real hidden lifecycle, then observes a full ten-second window and requires zero POST attempts, zero acknowledged exchanges, and zero errors. It cannot pass merely because an unsuccessful or rejected request was excluded from exchanges.
- Every server sink record must still match exactly one browser acknowledgement; seven locales/two actual viewports, CLI report comparison, and real HTML dashboard verification remain required. No TBT/field substitution.
- Cleanup independently attempts bounded browser disconnect, launcher kill, confirmed child exit, and profile removal. An unconfirmed running child preserves its profile and rejects acceptance. Partial launch failure, disconnect failure/timeout, connection failure, failed kill/exit, failed profile removal, and successful cleanup are unit-covered. Locked chrome-launcher has one stderr descriptor per custom profile retained until outer-process exit; this is bounded by the 28 cases and does not keep a browser alive.

## Verification and remaining gate

`mise exec node@24.20.0 -- node --test apps/api/scripts/rum-browser*.test.mjs`: 11 PASS. Targeted ESLint and Prettier PASS. The full performance-tool suite is 36 PASS; no owned RUM Chrome processes remain. Installed Chrome is discovered with chrome-launcher, honoring the existing FAN_SUPPORT_GOOGLE_CHROME_PATH override; recorded launch evidence includes actual version, flags, and owned default-context conditions. Final tool identities are in `rum-lifecycle-tool-freeze.json`.

Real controlled regression entry (must use a new output directory):

```sh
mise exec node@24.20.0 -- node apps/api/scripts/rum-browser-lifecycle-regression.mjs --output /absolute/new-directory
```

The product author then added only successful 204 empty-body consumption. Independent inspection confirmed unchanged request options, no retries, no non-204 body consumption, and handled rejection. The unchanged strict controlled regression now PASSes: `rum-lifecycle-regression-4/results.json`, both 390×844 and 1440×900, two home cells each with three completed 204/private-header-validated exchanges, and two order-access cells with zero attempts over ten seconds. All four cells have trusted native hidden events and same Document/URL/time origin; six browser exchanges exactly match six controlled server records. This directly transpiles the actual collector source and uses the locked web-vitals module; it is not Next production integration or production-sink evidence. No final RUM acceptance is claimed: root must still perform the complete owned production TEST RUM matrix. Existing formal disabled 63-LH/294-resource evidence is not reinterpreted as enabled RUM or field performance.
