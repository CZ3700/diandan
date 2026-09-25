# Gift directory implementation evidence

Owner: storefront_directory. Scope: gift-directory.tsx, gift-directory-card.tsx,
gift-filters.tsx, gift-query.ts and their directory/query tests plus gift-directory.css.
The seven implementation/test/style files are frozen for integration.

- `directory-query-red.log`: five tests fail because the query implementation is absent.
- `directory-query-green.log`: those five query tests pass.
- `directory-ui-red.log`: five SSR tests fail because GiftDirectory is absent. Earlier test setup/import errors were corrected before this behavioral RED was recorded.
- `directory-green.log`: final query + SSR run, 2 files / 10 tests PASS.
- `directory-format.log`, `directory-lint.log`, `directory-design-scan.log`: scoped formatting, lint and repository design foundation scan PASS. Successful eslint produces an empty log.
- `directory-typecheck-integration-pending.log`: a point-in-time full storefront typecheck; the remaining factory narrowing error belongs to concurrent integration. This is not a typecheck PASS claim.

The component preserves market/currency/artist and unrelated navigation context,
uses real SSR pagination/detail/reset links, supports the same directory inside an
artist route, and keeps actual totals with a maximum navigable page of 1000. Invalid
queries and missing context remain distinct at the presentation adapter. Localized
price editing converts decimal input to safe integer minor units using BigInt, with
no grouping/exponent ambiguity. Filter changes reset page 1. The initial pageshow
handler was intended to restore applied filters after a BFCache return; it was not
evidence that a real BFCache hit had been tested. The mobile drawer cancels drafts on
close and retains the shared focus/scroll/keyboard behavior. No cart action exists.

Money/status/media reuse Price, Status and PublishedImage; inputs/actions/overlay
reuse Field, Button and Drawer. The directory does not infer inventory policy or
fine-grained unavailability from its limited offer DTO. It renders an honest
unavailable state for null price and uses square contained gift images. No new
dependency, data store, persistence, business ID, configured market or currency was
introduced. The URL adapter, filter editor, cards and list renderer have separate
responsibilities and serializable contract props; data flows from the published
read DTO to display only. Local code simplification retained behavior and tokens.

The unit/SSR tests are presentation evidence, not actual PostgreSQL/S3/browser or
production-release evidence. Real seven-locale browser, error, Back, IME, mobile
Drawer, optimizer and database checks are owned by the integration harness.

## Cross-gift variant regression follow-up

Final independent review found that a selected variant from gift A survived the
browse link and was included in gift B's detail URL, falsely leaving B without a
matching offer. `giftDetailHref` now validates the target handle and deletes all
`variant` values only when entering a gift from a card; artist, market, currency,
filters, pagination and unrelated repeated query context remain intact. The card
uses this helper; the same issue in the homepage featured gift link was reported
to root for its independently owned module. Same-gift selectors and retry links
were not changed.

`directory-cross-gift-red.log` records two new failing regression tests with the
prior stale URL and absent helper. `directory-cross-gift-green.log` records all
12 directory/query tests passing after the fix; this supersedes the earlier 10-test
run for the changed source. `directory-cross-gift-format.log` and
`directory-cross-gift-lint.log` pass. No Next build or old browser evidence refresh
was performed by this agent; integration rebuild and browser verification remain
root/harness-owned.

## Ordinary browser Back regression

The actual Chrome attempt 3 failed after applying DESC / 10.00–20.00 from the
ASC/page-2 directory and navigating Back. The URL, cards and amount fields returned
to the old query, but the native select remained DESC even one second later.
`native-back-diagnostic.log` and `.json` preserve the observations; pageshow reported
`persisted: false`, and Navigation Timing reported `type: back_forward`. The failure
is also retained in
`output/playwright/p3-05-gift-storefront/run-2026-09-07T07-23-22-566Z/browser-attempt-3/results.json`.
This proves an ordinary history-return regression, not a BFCache hit.

The original effect only handled persisted pageshow events. The minimal change now
also recognizes back_forward navigation at mount and pageshow. Both entry points
share a cancellable animation-frame callback to reapply the URL's draft after native
form-state restoration; unmount removes the listener and cancels pending work.
Ordinary navigate entries do not reset an in-progress draft.

The real browser failure is the regression RED. After this change,
`directory-native-back-unit.log` has 12 query/SSR tests passing; the corresponding
`directory-native-back-format.log` and `directory-native-back-lint.log` pass.
These checks do not prove the browser fix. Root/E2E must rebuild and rerun the same
actual history path before recording browser GREEN. No old failed evidence was
replaced and no BFCache verification is claimed.

The rebuilt implementation subsequently passed the identical actual Chrome
152.0.7977.82 path. `native-back-fixed.json` and `.log` show `persisted: false` and
`back_forward`, with ASC/empty minimum/empty maximum restored both immediately and
one second after Back. This is the browser GREEN for the ordinary-history defect.
The adjacent `native-reload-diagnostic.json` also confirms that reloading an
unsubmitted DESC/10.00 draft restores the URL's ASC/empty minimum under `type: reload`;
no reload-specific change was needed. The original RED remains intact, and none of
these observations claim an actual BFCache hit.
