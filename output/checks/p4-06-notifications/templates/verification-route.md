# Correct actual order-access route

Independent integration review found that the previous unpublished candidate
generated `/:locale/orders/exchange`, while the existing protected storefront
entry is `/:locale/order-access`. The contracts/application owner corrected the
producer and validation. Template variable refinement material, test input and
safe preview runner now use the actual entry route. No alias or new storefront
route was added.

This intentionally changes all three unpublished template identities and their
historical content hashes. `pre-route-reviews.json`,
`pre-route-identity.fixture.json`, `pre-route-history.fixture.json`, and earlier
browser directories preserve the rejected candidate. The current 21 manifest
rows remain DRAFT, with no human reviewer or approval commit.

- `route-red.log`: the archived output digest failed after correcting input.
- `route-green.log`: all 9 files / 44 tests pass after updated version material
  and historical fixture; the archived reproduction test runs all 21 messages
  in three worker time zones.
- `route-build.log` and `route-lint.log`: exit 0.
- `route-browser.log`: 44 cases / 842 assertions pass in real Chromium.
- Browser evidence: `browser-2026-09-16T02-27-19-394Z`; seven locales, three
  events, both 390×844 and 1440×900, plus 500-line summary in both viewports.
- Visual inspection of the Vietnamese mobile payment preview confirms legible
  wrapping, exact money, original-language historical names and visible CTA.
- `source-manifest-route.json` pins this candidate.

These template previews deliberately replace only the credential-bearing href
with a harmless preview link before screenshots or HTML artifacts. They test
template layout, not the protected entry flow. The new
`apps/worker/scripts/notification-link-browser.mjs` separately clicks the actual
transient Worker-generated email CTA and checks the real Next/PostgreSQL order
session. Its actual result must be taken from the integrated notification run;
the template browser matrix alone is not evidence of a working email link.

Production remains blocked on human translation approval and the verified real
mail provider/domain/inbox gates. No actual email was sent by these checks.
