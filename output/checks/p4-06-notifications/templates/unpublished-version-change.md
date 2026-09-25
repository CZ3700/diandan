# Unpublished template candidate revision

The initial 42-case browser run at `browser-2026-09-16T01-52-34-383Z` remains
unchanged. Its `source-manifest.json` and copied `pre-summary-reviews.json`,
`pre-summary-identity.fixture.json`, and `pre-summary-history.fixture.json` record
the first, unpublished candidate. No record was human-approved or sent.

During independent review, the root accepted two improvements to this still-DRAFT
candidate before integration:

1. Large legal orders could exceed the provider content bounds. Mail now shows a
   fixed first-ten-item summary, an ICU-localized remainder count and the complete
   order total. The protected order remains the source of the complete item list.
2. Delayed messages must describe historical events rather than claim current
   readiness. Payment only confirms payment and points to current order status;
   preparation states that work has started; delivery states studio confirmation.

These changes intentionally produced new event template hashes and updated all
21 DRAFT reviews and historical render fixtures. Tests for both problems failed
before the changes (`summary-red.log`, `summary-events-red.log`) and then passed
(`summary-green.log`: 44 total i18n tests). This is an unpublished candidate
revision, not rewriting a released template. Once published, v1 must be retained
and subsequent behavioral/content changes must use a new archive version.
