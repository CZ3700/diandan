# P3-05 gift storefront evidence

This directory contains isolated TEST evidence. It is separate from the immutable P3-04 evidence directory.

## Final complete browser pass

The complete pass is `run-2026-09-07T07-23-22-566Z/browser-attempt-7/results.json`, also included in the top-level `results.json`. Its production compilation log is `run-2026-09-07T07-23-22-566Z/next-build-8.log`. The frozen implementation contains 1,428 inputs with SHA-256 `689ca8596cac257223c7b3f0445314aebd5c00a34ed48d7bfdad22a05e1a8122`. The run-directory timestamp and top-level `generatedAt` identify the retained fixture's original creation; later compilation and browser attempts reuse that same real fixture.

| Measurement                                      | Final pass |
| ------------------------------------------------ | ---------: |
| Real setup and HTTP/PG/S3 protocol assertions    |     15,714 |
| This compilation and Next health assertions      |          2 |
| This complete browser attempt's assertions       |      5,550 |
| Combined assertions                              |     21,266 |
| Normal authenticated setup HTTP requests         |      1,902 |
| Complete browser scenario groups                 |          8 |
| Screenshots from this complete attempt           |         55 |
| Axe runs                                         |         10 |
| Axe violations / incomplete results              |      0 / 0 |
| Reflow observations                              |         44 |
| Local performance observations                   |         31 |
| Actual responsive candidates / decoded responses |    33 / 33 |
| Unhandled browser page errors                    |          0 |

Chrome was `152.0.7977.82`. Each browser attempt starts with the fixed protocol assertion baseline and fresh scenario, image, accessibility and metric collectors. Prior smoke and failed attempts are not added to the complete attempt's browser totals. The gateway's served-derivative evidence is a cumulative checksum-verified object list for the retained fixture, not a browser performance metric.

The eight passing groups cover seven-language directory/detail/policy pages; pagination and native Back restoration; mobile filters, keyboard focus and IME Enter; invalid price ranges and JPY integer units; navigation between different gifts; recipients, variants, quantities and explicit market changes; language changes preserving the exact current selection; and transport/image errors, missing-gift HTTP 404s, reflow and motion preferences. Explicit market changes clear the previous variant, page and price filters. Language changes preserve the newly selected variant and market. No BFCache hit is claimed: the observed Back reproduction and repair used `pageshow.persisted=false` and navigation type `back_forward`.

## Preserved diagnostic history

- The initial contracts failure came from an obsolete build of a refined Zod object. The fixture then exposed two incorrect expectations: tracked inventory identity creation happens on first adjustment, and an archived published owner fails its current public proof closed with HTTP 503. Both fixture expectations were corrected to match the existing rules.
- The new context endpoint reproduced HTTP 503 twice because a PostgreSQL currency DOMAIN array reached node-pg as a string. A real PG probe showed the precise driver behavior; the smallest `currency::text` aggregation change restored the required array. The full real protocol subsequently passed.
- A later compilation caught an optional subtitle dereference. The product's optional-field handling was fixed before the browser matrix resumed.
- Browser attempt 2 found duplicate policy-navigation landmark labels and a labelled variant container without a semantic group role. The product semantics were corrected; the final ten axe runs have neither violations nor incomplete findings.
- Browser attempt 3 reproduced an actual non-BFCache Back inconsistency: the URL and cards were ascending while the native select retained the unsubmitted descending draft. A targeted history-restoration fix has both a matching real Chrome GREEN probe and the complete browser regression. The neighboring Reload probe already restored the URL's applied values correctly and did not require a broader change.
- Browser attempt 5 sampled Base UI's known inside focus sentinel during Tab wrapping. The captured focus returned to the dialog within two animation frames. The test now uses the existing P2 rule: every ordinary outside focus fails immediately; only the exact inside sentinel may wait up to 500 ms before focus must be back in the popup. The final pass recorded twelve Tab steps, including one such verified transient sentinel. The shared overlay implementation was unchanged.
- Independent review also found that a previous gift's variant could follow a link to another gift. Gift links now clear that foreign variant; the actual gift A → directory → gift B regression passed.
- Attempt 6 was a complete pass at the earlier `fc27375c` freeze. Subsequent repository checks found a final focus-expression formatting omission and contracts-test infrastructure issues: the expected route list lacked the two new endpoints, and module-loading work was counted inside the existing five-second render test. The final freeze includes repository formatting, the corrected route expectations, file-level module imports, and bounded contracts-test concurrency. Product behavior and test assertions were preserved. Attempt 7 recompiled the final freeze and repeated the entire browser matrix successfully; attempt 6 remains as earlier evidence.

Original failed browser attempts, separate compilation logs, and the safe native Back, Reload and focus probe JSON files remain available. This history distinguishes product defects from test-oracle mistakes; a narrower earlier pass is never presented as the final complete matrix.

The checkpoint includes the final attempt's 55 screenshots, the later preview-restoration smoke's three screenshots, each attempt's structured result, and the two targeted native Back diagnostic images. Earlier duplicate screenshot matrices and raw compilation/runtime logs remain local under their original paths; they are not included in Git. Raw logs follow the repository's ignore rules. The prior task's historical untracked artifacts remain untouched.

`screenshots.sha256` binds all 55 final PNG files; its paths are relative to the repository root. The top-level browser result is deeply identical to the final attempt's standalone result.

The fixture creates 27 gift identities through normal authenticated administration: 24 active, one paused, one archived, and one unpublished draft. Twenty-six gifts receive actual approved content publications. Three synthetic artists include two accepting artists and one paused artist. Two explicitly configured TEST market/currency scopes use actual complete published price books. Four policies use normally reviewed, effective publications. No production market, brand or payment authority is inferred.

Media comes from existing fictional performer and gift artwork in this repository. Original pixels are preserved inside clearly synthetic neutral compositions, with source hashes, original dimensions and placement recorded. Real upload authorization, TLS S3 bytes, image worker processing, metadata review, rights records and publication guards remain intact. Reusing three gift artworks across TEST products is fixture reuse, not a claim of twenty-five distinct formal assets. Formal asset and translation approval remain outside this evidence.

## Commands

Run with the repository's Node 24.20.0 toolchain after building the current dependencies:

```sh
node apps/api/scripts/gift-storefront-http.mjs
node apps/api/scripts/gift-storefront-http.mjs --production --ui
node apps/api/scripts/gift-storefront-http.mjs --production --serve
```

The default runs actual PostgreSQL, HTTP and TLS S3 protocols without Next or Chrome. The browser command compiles Next with strict preview build configuration, then runs the compiled artifact under the isolated TEST runtime with the exact local media origin and certificate authority. This is not production or staging release evidence.

The retained preview prints its owned process ID and temporary URL. Signals to that exact owned process have these effects:

- `SIGUSR1`: rebuild its owned Next child and run the full browser matrix against the same fixture.
- `SIGHUP`: rebuild its owned Next child and run the short browser smoke.
- `SIGUSR2`: pause only its owned Next child, retaining PostgreSQL, API and S3.
- `SIGTERM`: close the retained fixture and its owned services.

Each browser process run has a timestamped directory; diagnostic attempts have separate subdirectories. `results.json` is reserved for a successful complete browser matrix. `smoke-results.json` does not replace it. The earlier `seed-protocol-results.json` can describe a narrower successful protocol run; always read its scope and generation time.

## Final preview restoration

The final complete `pnpm check` exited zero, independently recorded in `output/checks/p3-05-gift-storefront/check-final-result.json` at `2026-09-07T08:48:57.366664+00:00`. Only after reading that result, the retained fixture rebuilt Next and passed browser attempt 8's short smoke: 16,076 combined assertions, comprising the same 15,714 protocol baseline, two compilation/health checks, and 360 browser checks. Its three screenshots and report are under `run-2026-09-07T07-23-22-566Z/browser-attempt-8/`; the top-level summary is `smoke-results.json`.

The temporary TEST URL `http://localhost:65096/zh-CN/gifts?market=GLOBAL&currency=USD` was then fetched successfully: HTTP 200, Chinese HTML locale, the actual directory, and twelve gift cards. An unknown gift returned actual HTTP 404. SHA-256 checks confirmed both the top-level complete `results.json` and attempt 7's complete report remained byte-for-byte unchanged by restoration. This retained local preview has a finite process lifetime; the saved screenshots and reports are durable evidence.

## Scope and limitations

The protocol oracle derives expected page order, price ties, availability, recipient eligibility and quantity bounds from the authored TEST scenario. Two tracked locations with quantities five and three prove that maximum selectable stock is five, not eight. Nontracked variants remain without fabricated inventory identities. All locale/media inspections require nonempty actual objects and exact approved requested locale bindings.

Browser verification covers seven languages and 390×844 / 1440×900 CSS viewports, actual pagination and URL restoration, localized money inputs, recipient and variant selection, stock modes, explicit errors, keyboard operation, reduced motion, responsive image decoding and accessibility. The phones are browser emulation; no physical-device claim is made. A successful short smoke is not the complete browser matrix.

Performance figures are local observations without network or CPU throttling. Image transfer totals are sampled after forcing all DOM images to decode, so they are not first-viewport transfer budgets. Formal performance budgets remain P3-06. Actual missing-price lifecycle coverage is not claimed by this fixture; the unavailable-price branch has separate domain tests.

Diagnostic logs remain under `output/checks/p3-05-gift-storefront/`. Initial failures include an obsolete contracts build, an early fixture assertion before tracked inventory identity creation, an incorrect archived HTTP expectation, and the actual PostgreSQL currency DOMAIN-array driver mapping failure. None are hidden by weakening publication, stock, session, locale or pricing rules. Final status and exact counts must be read from the successful result artifacts, not inferred from this document.
