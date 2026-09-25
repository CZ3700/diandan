# P3-06 public stylesheet audit (2026-09-21)

Owner: resource_audit, root remains the only P3-06 Lane D executor. Initial read-only audit followed by root-authorized implementation; final source scope and TDD results are below. No build, Chrome, PostgreSQL or performance sampling run by this agent.

## Implemented scope

Moved the existing `@fan-support/ui/composites.css` import from `apps/storefront/src/app/globals.css` to `apps/storefront/src/app/%5Finternal/design-foundations/layout.tsx`. The original stylesheet is unchanged byte-for-byte. Motion, primitives and interactions remain global in their original order: the public storefront uses Media, Quantity, Button, Icon, Price, Status, Field, Drawer and LanguageControl. It does not use Hero, IdolPortrait, GiftTile, IdolContext, CartLine, OrderTimeline or the signature-motion components. Its corresponding production classes are `storefront-*`, `cart-*` and `order-*`, and its animation rules are already in `storefront.css`.

Exact production scope is two files. The internal layout is the common guarded parent of all seven locale plus en-XA specimens, including the only application consumers in `ui-composites-*` and `ui-motion-lab.tsx`. No import in `apps/storefront/src/storefront` references `@fan-support/ui/composites`, `composites-client`, `motion`, or `motion-client`, and no corresponding component/motion classes occur in its non-test source. Package barrel exports preserve the frozen primitive-only boundary, so a named primitive import does not implicitly render a composite.

The change removes 11,552 source bytes (composites only) from the global import chain. Root then captured fixed three-plus-three current navigations: `comparison-summary.json` verifies 54 raw files and actual stylesheet savings of 11,301 resource bytes / 1,531 transfer bytes. Simulated LCP medians were 4212.1395 → 4359.5727 ms; both groups FAILED. Resource isolation is demonstrated; a stable LCP benefit or performance acceptance is not.

## Actual historical browser evidence

Inputs: `output/checks/p3-06-storefront-acceptance/run-2026-09-17T08-41-18-090Z/browser-attempt-2/gift-render-trace/zh-CN-gift-mobile-{1,2,3}-artifacts.json`.

All three original Stylesheets artifacts contain the same public CSS chunk `40bq4a1qmkc-o.css`, 43,606 content bytes. It contains `.fs-composite-state`, `.fs-motion-hero`, `.fs-motion-add`, `.fs-cart-line` and `.fs-order-timeline`. Across these five groups, 49 rule ranges have zero overlap with any `used: true` CSSUsage range in each sample. The same-navigation MainDocumentContent has none of those class prefixes. This is evidence of unnecessary public CSS delivery in the recorded normal navigation, not merely an inference from present source imports.

These historical samples share the old global composite import. Root separately captured the newer baseline and candidate listed above; historical unused-coverage evidence does not substitute for current interactions, internal specimens or all-language validation.

## Meaningful RED and validation

The new `apps/storefront/src/app/storefront-style-isolation.test.ts` reads actual UI CSS reached by root and internal-layout imports. It requires that internal composite rule families are absent from the public root/public route stylesheet imports but still complete in the internal layout; it also requires primitive, Media, overlay and motion rules to remain public with interaction/motion/primitive order unchanged. Actual old production result was 2 failures / 2 passes; the candidate has 4 passes. Production edits began only after root completed all three baseline samples.

`scripts/check-ui-composites.mjs` required the old global import location. Its ownership check and mutation tests now require the explicit internal layout consumer and reject missing, duplicate, comment, string, type-only and public-root leakage cases. The motion validator is unchanged. The original CSS exports, sideEffects, scope, reduced-motion and visual invariants remain enforced.

Root has compared before/after stylesheet bodies and totals in the fixed three-plus-three standard-profile run and preserved all raw samples; root also owns the seven-language 390x844/1440x900 UI matrix with keyboard/error/reduced-motion. Internal composites and motion specimens must also retain styles under their guarded routes; visual cascade order changes are a risk even when selector audit suggests no overlap. LCP remains OPEN unless actual unchanged-threshold acceptance succeeds.

## Other candidates rejected from this checkpoint

- Five public font layouts import gift-directory and gift-detail CSS on all routes. This is real extra CSS (5,293 and 8,275 source bytes), but gift-detail.css also owns policy/market styles, and shared factories have mixed route dependencies. A second route split would widen this checkpoint and should not be bundled with the one-import candidate.
- Global `experimental.inlineCss` would inline approximately 173 KB of historical CSS and duplicate initial CSS into SSR/RSC while losing independent cross-page stylesheet caching. Prior metricSavings estimate gave FCP benefit but zero LCP benefit. Current source has a narrower waste-removal opportunity first.
- CJK fallback declarations preserve non-UI glyph coverage and exact source mapping; the existing range partitioning already prevents UI duplication. No additional repertoire, priority, font-display or asset change is supported by this audit.
- The LCP image is already eager/high-priority and in initial HTML. Do not lower its dimensions/quality or modify browser scheduling to improve a score.

This candidate cannot explain or fix the independently captured roughly one-second BeginFrame delivery gap. It addresses unnecessary application resource delivery while the scheduler investigation remains separate.

## Reviewed cascade constraint and actual TDD results

The initial proposal included motion.css. Independent review found a real order conflict: `.fs-motion-idol__media` and `.fs-media` both set border-radius with equal specificity; moving motion after primitives would alter the internal IdolSwitcher. Root approved the smaller composites-only candidate. The original global interaction → motion → primitive order remains exactly intact. Composite media aspect rules use `!important` or higher specificity; the existing Hero image positioning winner is also higher specificity. No stylesheet declarations changed. Root owns actual browser/cascade validation.

- `style-red.log`: old application, 4 tests, 2 expected assertion failures and 2 passes; command `mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/storefront test src/app/storefront-style-isolation.test.ts`, exit 1, 2026-09-21 13:31:08 UTC (runner displays local 20:31:08).
- `style-validator-red-result.json`: old checker rejects correctly relocated internal imports, exit 1.
- `style-validator-guards-red-result.json`: seven new acceptance/adversarial checks against old checker, 7 expected failures, exit 1.
- `style-green-result.json`: first candidate check had 1 failure because the retained motion stylesheet legitimately references `.fs-hero` in descendant selectors. The test was narrowed to the independent composite rule selectors; `.fs-composite-state`, which caused the original public-isolation RED, remains covered. No production change was needed for that test-oracle correction.
- `style-green-2-result.json`: 4/4 PASS, exit 0.
- `style-validator-green-result.json`: 9/9 PASS, covering new seven cases plus existing positive package and logical-property/text-clipping checks, exit 0.
- Prettier ran successfully on the five edited source/test/checker files. Root owns full gates, current build, actual CSS network comparison and browsers. No performance pass is asserted by this report.

Production files: globals.css and the internal design-foundations layout. Verification files: the new storefront-style-isolation.test.ts plus check-ui-composites.mjs/.test.mjs. No app UI component, font, image, contracts, database, motion styles or motion checker changed by this agent.

## Read-only follow-up: actual transport fidelity

A bounded offline inventory found **384 LHR files** matching the seven-locale home/artist/gift mobile naming convention under `output/checks/p3-06-storefront-acceptance/`. This includes complete formal matrices, partial failed matrices and diagnosis groups through this run; it is not a new sample collection. All 384 requested URLs are `http://localhost`, and all **9,389 HTTP(S) network audit entries** report `http/1.1`. Independently, the six current `*-devtools.json` files contain 144 `Network.responseReceived` events, all `response.protocol = http/1.1`. The shared entry in `apps/api/scripts/storefront-acceptance-runtime.mjs:50` explicitly allocates `http://localhost`; this supports the recorded measurement scope, not a claim about a deployed site.

Pinned Lighthouse 13.4.1 consumes that evidence: `core/lib/network-request.js:354` copies `response.protocol`, `asLanternNetworkRequest` keeps the record fields, and `core/computed/page-dependency-graph.js:47` passes NetworkRecords into the default Lantern graph. In pinned `@paulirish/trace_engine@0.0.65`, `models/trace/lantern/simulation/ConnectionPool.js:45-55` derives TLS from the URL scheme, H2 from `request.protocol === 'h2'`, and selects a minimum of one H2 connection versus six non-H2 connections. `TCPConnection.js` additionally applies different warm H2 byte/TTFB handling and explicitly notes imperfect warm-H2 timing modeling. Thus the protocol is an actual simulation input, not merely a label; these implementation facts do not establish H2 speedup or explain BeginFrame stalls.

ADR-007 selects CloudFront + ACM for the viewer edge but **does not yet freeze or deploy its HTTP-version setting**; P5-08 remains pending. CloudFront can be configured to negotiate HTTP/2 with viewers using TLS 1.2+ and SNI, according to the [official distribution settings documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesGeneral.html#DownloadDistValuesSupportedHTTPVersions) checked on 2026-09-21. This is provider capability, not evidence that our future distribution already negotiates H2.

**Recommendation for a later bounded experiment:** test a real certificate-validated TLS local reverse proxy in front of the same built Next process, with the same compression, bodies, cache policy, content proof and Chrome/Lighthouse throttling. To isolate HTTP version, compare **HTTPS/H1.1 against HTTPS/H2 through the same proxy**, varying only ALPN/protocol support; retain the existing direct-HTTP/H1.1 measurements as the original separate baseline. Comparing direct HTTP with TLS/H2 alone mixes TLS, proxy and protocol effects. Record actual negotiated protocol for every document/CSS/font/script/image response, cold/warm cache states, resource bytes, observed metrics and unchanged official simulated metrics; fixed sample counts and all failures must remain. Do not rewrite DevTools protocol fields, disable throttling, ignore certificate errors or call a local proxy CloudFront/staging. This is worth testing to improve deployment fidelity, with no promised benefit and no replacement of current FAILED results or formal seven-language/RUM gates. No transport implementation or rerun was performed here.
