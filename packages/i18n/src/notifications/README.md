# Order notification templates

Server-only entry point: `@fan-support/i18n/notifications`.

```ts
const templates = createOrderNotificationTemplates({ mode: "TEST_DRAFT" });
const selection = templates.select("PAYMENT_CONFIRMED", "ja");
// Persist selection and historical order variables before delivery.
const content = templates.render(command);
```

The returned synchronous `select` and `render` methods implement the
`OrderNotificationTemplates` port structurally. The factory has no provider,
database, catalog, clock, network, or log dependencies. The worker composition
must permit `TEST_DRAFT` only for its explicit local TEST transport. A real send
requires `APPROVED`; this currently fails because all 21 review records are
machine-assisted drafts with no human reviewer or approval commit.

## Version and review evidence

`v1/` is an archive, not an editable “latest” catalog. Each event's `v1.<sha256>`
identity covers all seven locales' subject, preheader, body copy, HTML and text
layouts, the variable JSON schema and custom refinements, and renderer version.
Email styles are a frozen projection of the existing design tokens; live shared
token changes must not change previously requested mail. The renderer uses system
fonts and no external media or trackers.

The 21 records in `v1/reviews.json` bind the exact English source, translation,
variable schema and template version. `APPROVED` requires the full seven-language
set for all three events, valid human-review evidence and exact hashes. Updating
hashes does not approve a translation. Never manufacture reviewer names or
approval commits. Runtime incident fallback cannot bypass this gate.

Add a new version directory and registry entry when changing shipped copy,
variables or renderer behavior; preserve the old renderer, parser, material,
reviews and fixtures for the required outbox/retry and audit retention period.
Do not regenerate old fixtures to make an altered archived version pass.
`identity.fixture.json` pins the three identities. `history.fixture.json` retains
independent historical input and 21 rendered-content digests; no live credential
or recipient is stored. Its tests render the archived identities across three
worker time zones. Runtime/ICU upgrades must pass these byte fixtures; keep the
release runtime available for historical replay if formatting behavior changes.

## Fallback and privacy

`incidentFallbackLocales` is trusted runtime incident configuration. A new
selection for an affected non-English locale resolves the entire template to
English and supplies `LOCALE_TEMPLATE_INCIDENT`. Persist the requested/resolved
locale, fallback flag and reason, and issue the worker's allowlisted incident
alert before delivery. Existing commands render their saved identity independently
of today's incident configuration. This renderer does not emit its own alerts.

Only order snapshots are accepted: artist/gift/option names retain their distinct
recorded languages, values are HTML-escaped, integer minor units use BigInt, and
the actual order creation date renders in UTC. No preparation/delivery timestamp,
PSP settlement claim, fan name, private message or address is inferred or accepted.
Emails describe the payment/preparation/delivery event that actually occurred;
they do not assert that a delayed notification still reflects the current order
status. Orders with more than ten lines show the first ten historical items and
an explicit, localized remaining-item count. The total always represents the
complete order, which is available through the protected order link. This fixed
summary threshold and all seven ICU plural messages belong to the version hash.
The transient HTTPS fragment credential must identify the same public order.
Neither the content nor `orderUrl` may be persisted in logs, queue payloads,
analytics, browser preview files or test failure reports.

## Verification

Run the i18n package's test, typecheck and build commands, plus scoped ESLint and
Prettier. `notifications.test.ts` covers rendering, money, escaping, fallback,
identity and safe errors. `version-review.test.ts` covers ICU parameters and
approval/material gates; its synthetic approval fixture exists only inside tests.
`history.test.ts` validates immutable replay.

The P4-06 browser script lives at
`output/checks/p4-06-notifications/templates/verify-browser.mjs`. It renders all
seven languages and three events at 390 × 844 and 1440 × 900, plus a 500-item long
order at both sizes, then checks keyboard
activation, visible focus, reduced motion, original-language names, overflow and
axe. Before any browser navigation or artifact writing, it replaces the single
credential-bearing link with a safe preview URL. The report retains original and
preview HTML hashes and checks the original content against the archive fixture.
This proves Chromium email-HTML layout, not actual Gmail/Outlook inbox delivery.
