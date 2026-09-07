# Compiled asynchronous validation browser regression

PASS: nine independent fresh Chrome contexts, 51 assertions, nine screenshots. Actual browser version: 152.0.7977.82. Compiled product source is iteration 3 (`7f4695db1562591e674b91776af7ca095ecea0cb44da77d62e94555fe49a4446`); the newly added standalone harness has its separate hash in `verification-summary.json`, so it is not presented as included in that earlier source manifest.

The helper finds the unique emitted gift and artist validation export registrations in the actual compiled chunks, records their hashes, confirms each relevant validation chunk is absent from fresh page traffic, and observes the first actual interaction requesting it. Only those script URLs are delayed or returned as an explicit TEST 503. Successful scripts, filtering, searches and recovery always use the real compiled server, PostgreSQL-backed API and existing TEST media. No valid business response is stubbed.

- Gift pending apply: changing the draft, starting IME composition or closing the mobile drawer prevents stale navigation. A subsequent explicit apply uses the current draft, exact 200 minor-unit filter, preserved market and real gift results.
- Gift first validation script failure: the visible alert and actual context-preserving page recovery link restore normal filtering after network recovery.
- Artist pending first import: Escape, clearing the query or starting IME prevents the obsolete API request and stale suggestions. Changing Mira to Kai sends only Kai after loading and displays the actual expected artist.
- Artist first script failure: the visible error and existing retry affordance recover the actual Mira API result in this measured Chrome/Turbopack build. This is observed browser evidence, not a general promise about every future browser module loader.

Attempt 1 remains FAIL with eight cases passing and one fixture locator error: the unscoped Drawer trigger also matched the header menu. Attempt 2 changes only that locator to the existing mobile gift-filter container; all cancellation, error and recovery assertions are preserved. The mobile successful result screenshot was manually viewed.

This is a focused regression, not another complete seven-language matrix, BFCache verification, physical mobile device, VoiceOver or performance measurement. No Lighthouse ran concurrently. The compiled application source was unchanged during both attempts.

Reproduction command shape (a live owned fixture and its current public certificate are required):

```sh
mise exec node@24.20.0 -- node apps/api/scripts/storefront-acceptance-lazy-validation.mjs \
  "$TEST_STOREFRONT_ORIGIN" "$TEST_FIXTURE_MANIFEST" "$TEST_MEDIA_CERTIFICATE" \
  "$NEW_EVIDENCE_DIRECTORY" "$COMPILED_SOURCE_MANIFEST"
```

The script is independent from Lighthouse and the full UI callback. A fresh output directory preserves each attempt. It exits nonzero after retaining every focused case if any assertion fails. The certificate parameter is the public certificate, never a private key or credential.
