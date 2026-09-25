# P3-06 cart restoration hint — independent source review

- Reviewer: `/root/order_bff`, non-author of this change.
- Baseline: `7d1a539`; review performed after the author confirmed the production/test freeze on 2026-09-16.
- Verdict: **ACCEPT for the reviewed source scope; no blocking finding.** This is not performance acceptance or completion of P3-06.
- Execution: read source, final diff, existing RED/GREEN logs and framework implementation only. No source edit, test, build, browser run or database operation was performed by this reviewer. This report is the sole review artifact added.

## Reviewed scope

Production: `server/cart-cookie-name.ts`, `server/cart-restoration-hint.ts`, the constant import in `server/cart-proxy.ts`, `storefront/cart-provider.tsx`, `storefront/cart-header.tsx`, `storefront/storefront-page-shell.tsx`, and `storefront/gift-page-factory.tsx`, all under `apps/storefront/src`.

Tests: the new restoration-hint, header-restoration, provider-restoration and page-shell tests; changes to gift-page scheduling and page-factory tests. Also reviewed the coordinating agent's final `apps/api/scripts/cart-storefront-browser.mjs` assertions.

Unchanged consumers inspected: cart session/body/panel, gift add, shared-shell consumers for artist/home/cart/checkout/order, proxy, root layout and Next configuration. The homepage/database proof-reuse ideas from the preceding read-only audit are outside this implementation.

## Behavior and boundaries

1. The server helper uses request-local `cookies().has(CART_COOKIE_NAME)` and returns only a boolean. Both modules are server-only. The BFF retains its existing cookie name, credential parsing, response validation and CSRF behavior; the shared constant is a protocol identifier, not a new deployment value.
2. The hint only controls the header's automatic restoration effect. `false` does not create a cart, mark the session empty, clear an existing cart, authorize access, or bypass a request. A malformed or expired but present cookie still enables the original BFF validation.
3. `CartProvider` retains one session via `useState` and defaults the new optional hint to `true`, preserving existing consumers. Its initial session remains `idle` for either boolean. The header checks the current session status before an automatic read, so an interaction that has already started restoration is not repeated by a late load event.
4. Manual drawer opening mounts `CartBody`, which still performs a real read. Gift initialization still reads before deciding whether to create a cart. A false hint captured before another tab creates a cookie is therefore not treated as proof of absence. This change does not promise live cross-tab badge synchronization; subsequent interaction or full navigation obtains the current truth.
5. The shared shell and the independent gift-family shell both pass the explicit request hint. All production shared-shell consumers use JSX server-component composition, compatible with the shell becoming async. Existing entity existence checks remain before the shell, retaining the prior 404 boundary. Gift noncritical context streaming remains intact.
6. No raw cookie, token or private draft is passed into client props. Actual response headers remain a required runtime gate: the local Next implementation maps dynamic `revalidate=0` output to `private, no-cache, no-store, max-age=0, must-revalidate`, and these pages already use dynamic request inputs. Source review alone is not evidence for an upstream CDN configuration.

## Browser assertion review

The final script filters cart reads by origin, path and GET method; checks zero reads after navigation and again before explicit keyboard opening; observes and schema-validates the first 404 `CART_NOT_FOUND` response; checks private/no-store and absence of a newly invented cookie; verifies focus return; and compares the returning badge against the successful add response's actual quantity sum. Returning HTML is checked against the cookie value in memory without persisting raw HTML or the credential.

`networkidle` is a bounded observation, not proof that every future effect can never run. The explicit loading/complete lifecycle unit tests cover the structural no-auto-read guarantee. The browser fixture visits `/en/cart` before this browse case, so its first-visitor case proves behavior with no cart cookie, not cold-bundle performance. Root's independent fresh performance sampling must establish the latter.

## Evidence read

- `cart-hint/red.log`: 5 failed / 3 passed; absent-cookie automatic reads and missing helper were detected.
- `cart-hint/wiring-red.log`: 9 failed / 36 passed; missing provider/shell wiring was detected.
- `cart-hint/green-final.log`: 9 test files, 100 tests passed, 2.96 seconds.
- `cart-hint/format-check-final.log`: all matched files passed formatting; `cart-hint/result.json` records 13 files and the exact targeted command.

These are existing author-run results read by the reviewer, not additional independently executed tests.

## S.U.P.E.R 1–9

| Check | Assessment and actual basis |
| --- | --- |
| 1. Single responsibility per module | PASS: one server-only protocol constant, one request-presence reader; existing provider/header/shell roles remain distinct. |
| 2. One conceptual task per function | PASS: helper reads presence; header effect decides automatic restoration; session code continues to own actual reads and mutations. |
| 3. Inward, one-way flow | PASS: server request → boolean prop → context → header decision → existing private transport. Browser modules do not import the server helper or cookie module. |
| 4. No introduced cycle | PASS: both server consumers import a leaf constant; shell imports helper and existing client provider; provider imports the existing session only. |
| 5. Defined interfaces | PASS: `Promise<boolean>`, typed optional `restoreOnLoad?: boolean`, typed context value; no business or cross-package contract changed. |
| 6. Serializable I/O | PASS: server/client boundary adds only a boolean. The session/functions remain inside the existing client context boundary. |
| 7. No new hardcoded deployment values | PASS: existing cookie protocol name was centralized; no URL, market, locale exception, credential or configuration value was added. |
| 8. Explicit dependencies | PASS: no new dependency. Uses existing React, Next and repository modules. |
| 9. Replaceable implementation | PASS: callers depend on the typed presence reader and boolean provider prop. Cookie-validation and persistence implementations remain independent. |

## Pending verification / S.U.P.E.R 10

At review time the coordinating agent's workspace `check:dev` was still running. Actual compiled-browser behavior at both viewports, private/no-store HTTP output, returning badge, keyboard interaction, and fresh performance comparisons are still coordinating-agent gates. Do not substitute the targeted 100-test result for the combined gate, Lighthouse budgets, all-locale acceptance, physical-device evidence, or production release evidence. No additional abstraction or source change is requested by this review.
