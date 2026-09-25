# P3-03 gift commerce HTTP and browser evidence

Status: final actual HTTP/PG/TLS storage/Next BFF and complete UI passed. The coordinating task records the final whole-repository gate separately.

Run from repository root with the pinned runtime:

```sh
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:postgres:gift-commerce
mise exec node@24.20.0 -- corepack pnpm --filter @fan-support/api test:browser:gift-commerce
```

The first command runs the full real service workflow and the browser BFF protocol. The second adds actual buttons, seven-language screenshots and accessibility checks. Both own and clean up their ephemeral PostgreSQL and TLS S3 resources, real media/publication workers, API and Next development server. No production account, payment provider or real fan order is used.

## Confirmed protocol result

`transport-http-fifth.log`: exit 0, 1658 assertions and 512 setup API requests. The request count covers the server setup helper, not every browser XHR or object storage transfer.

The scenario begins with zero gifts. Real API calls create the gift and three variants, upload an original synthetic image over strict TLS, inspect/process it into responsive derivatives, independently review seven translations and gift detail blocks, publish a configured price book, and publish the gift for the first time. It verifies all seven locales through the additive public classification endpoint and existing public catalog.

- Procurement and preorder variants have no fabricated inventory identity or balance. The tracked variant is prepared through real +1/-1 adjustments at zero stock before publication; stock changes alter the actual public offer.
- The current price head changes 1 → 2 → 1; published gift kind changes WISH → VIRTUAL → WISH through actual content publication and rollback. Ordinary authoring COPY and translation IMPORT inherit the source classification while the public pointer remains unchanged.
- Current pricing permission withdrawal rejects a replay of the same previously successful key. An unconfigured market/currency combination creates neither a price book nor an audit row.
- A temporary normal audit trigger injects a deterministic failure: HTTP returns a safe 503, business/audit/idempotency counts remain unchanged, and the same key succeeds after removing the test trigger.
- Paused gifts retain their readable public paused status and have no purchasable offer. Reactivation uses current publication and profile proof.

The browser uses real Secure/HttpOnly/SameSite=Strict Host cookies on localhost. CSRF is bootstrapped only into process/page memory. No session or preview credential enters a URL, HTML/RSC, browser storage, screenshot, trace, HAR or diagnostic log. The TLS certificate is verified by the Node chain; Chrome pins only the ephemeral certificate SPKI. Source PUT and private derivative GET use the test origin's actual CORS configuration.

## Tests and diagnostic history

The initial contract/transport/Application failures are retained in ignored `transport-*-red.log` files. All 68 affected unit tests pass: Application 40, PG authorization 7, API route/composition 14, BFF map 4 and OpenAPI 3. `transport-types-*-final.log` covers contracts, port, persistence, Application, API and admin types. Final formatting/lint and combined gate are recorded by the coordinating task.

Early real harness failures were corrected without changing production guards: missing tracked inventory identity, a wrong public query alias (`idolId` instead of HTTP `idol`), and an incorrect assumption that paused content becomes unreadable. Browser diagnostics identified label matching versus native combobox names, combined notice text and asynchronous post-review refresh. The final browser must wait for the actual saved revision and its canonical six stale translations before checking the rendered matrix.

The final integration also exposed transaction-time boundaries. Deterministic real PostgreSQL tests drove the publication event and internal authoring timestamp fixes. The Application regression preserves the stable commerce principal for writes and idempotency while retaining all current content permission, locale and same-session checks; a +2-second content authorization observation previously failed at the database receipt guard and now passes. The final bridge scenario reports 117 real PostgreSQL assertions; the exact Application regression and two authorization rejection cases add three tests.

## Final browser evidence

`transport-browser-final-green.log`: exit 0, **1703 assertions and 512 setup API requests**, full UI mode after the final transaction-time fixes and frozen UI. The complete run includes all protocol checks and actual user-interface mutations. The owned Next development process exited normally; no test server is left running by this scenario.

`output/playwright/p3-03-gift-commerce/accessibility.json` is PASS. Four English screens—gift editor, gift preview, price management and inventory management—report zero axe violations and zero incomplete checks. Real Tab navigation reaches the preview link with visible focus, Enter opens the private preview, and its images decode from blob URLs. Five reflow measurements have document/body width equal to the viewport: gift editor and prices at 320px and 720px, inventory at 320px. The 720×450 test is equivalent 200% CSS reflow from 1440×900, not native browser zoom. All browser contexts use reduced motion.

Actual buttons create an empty gift and procurement variant, save and publish a price revision, adjust tracked stock, reject unsaved navigation, save gift text, submit and independently approve English. The test binds the refreshed matrix to the just-saved revision and requires all six canonical/rendered translations to be STALE. The same reviewer then loses commerce.read and six locale scopes: Japanese detail text plus actual English source remains readable, Thai is forbidden, commercial editing controls are absent, and independent Japanese detail approval succeeds.

The final 18 PNG files were all refreshed by this passing run:

- `en-desktop.png`, `en-mobile.png`
- `zh-CN-desktop.png`, `zh-CN-mobile.png`
- `th-desktop.png`, `th-mobile.png`
- `vi-desktop.png`, `vi-mobile.png`
- `ja-desktop.png`, `ja-mobile.png`
- `es-desktop.png`, `es-mobile.png`
- `pt-desktop.png`, `pt-mobile.png`
- `en-preview.png`, `en-prices.png`, `en-inventory.png`, `en-created.png`

The seven locale pairs use 1440×900 and 390×844 browser viewports with full-page captures. Three English operation captures show the decoded preview, published-price panel and adjusted tracked balance. `en-created.png` is the successful gift/variant save followed by its refresh loading state (the success notice is visible); it is not a stable variant panel. Creation success is proven by the actual UI/HTTP assertions. Thus the 18 files comprise 17 stable page captures and one post-save refresh state. Full-page captures retain the sticky action bar at the captured viewport boundary; that screenshot placement is not evidence of an interaction failure. Manual inspection confirmed the final Japanese source/edit field order and empty optional source slot, and the Portuguese mobile matrix now uses two readable columns. All displayed records are synthetic; no private support intent, real administrator identity or capability is shown.
