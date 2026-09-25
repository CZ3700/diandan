# P4-05 order presentation subtask

Owner: `/root/order_view`, delegated under the root P4-05 executor. Local implementation only; no commit, push, merchant activation or release.

## Scope and design

- `OrderDetail({ order, locale, copy })` renders the validated historical `OrderAccessDetail`: saved artist/gift text and photos, nullable option, quantity, original unit/line amounts, full order amount breakdown, public order number and actual creation timestamp. It does not read today's catalog or any private fan content.
- Four canonical status axes remain independent. Progress describes the current state; no payment/preparation/delivery timestamps or estimated SLA are invented. The one visible timestamp is the recorded `createdAt`, explicitly formatted in UTC. The UI never claims an email was sent.
- Black/gold visual baseline, existing tokens, shared `Price` and `Media`. Square media frames use `contain` so horizontal and vertical images retain the original composition. The `width=1, height=1` pair expresses the display-frame ratio only; the historical media DTO has no intrinsic dimensions, and the UI does not manufacture asset metadata.
- All four object/media languages are applied independently. DAILY originals and saved translated/fallback languages have explicit source notices; changing shell locale leaves content, quantity, currency and integer minor amounts unchanged.
- 52 order/recovery/status messages added to all seven catalogs. Every review remains DRAFT with null reviewer/approvedCommit and exact current source/translation hashes; these are not human translation approvals.
- Order lookup and action controls use tokens, a minimum 44 px target, visible focus, wrapping, stable image boxes and no new motion. Browser acceptance belongs to the root's integrated matrix.

## RED and GREEN

Commands use `mise exec node@24.20.0 -- corepack pnpm`.

| Verification                                                                                                                     | Result                                              | Evidence                                          |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------- |
| Storefront `exec vitest run --config ../../vitest.config.ts --root . src/storefront/order-detail.test.tsx` before implementation | Expected missing-OrderDetail assertion; 10 failed   | `view-red.log`                                    |
| i18n order-message tests before implementation                                                                                   | Missing order keys and absent ICU message; 2 failed | `view-messages-red.log`                           |
| Same storefront detail command after implementation                                                                              | 10 passed                                           | `view-green-attempt1.log`, final `view-green.log` |
| i18n package `test`, `typecheck`, `build`                                                                                        | 6 files / 28 tests passed; typecheck/build exit 0   | `view-i18n-green.log`                             |
| ESLint on the delegated TS/TSX and storefront catalogs                                                                           | Exit 0                                              | `view-lint.log`                                   |
| Prettier on delegated code/catalogs and final CSS                                                                                | Exit 0                                              | `view-format.log`, `view-css-format.log`          |

The RED collection shell printed the failed command log afterwards, so that outer shell returned 0; the preserved Vitest output contains the actual test command's exit 1. GREEN commands were chained with `&&` and all exited 0. No failed checks were overwritten.

The 20-file delegated-source snapshot is `view-source-manifest.json`. Root integration may deliberately revise these files later; the final combined source/evidence authority remains the root manifest.

## S.U.P.E.R scope review

1. Single purpose per module: historical rendering, status wording, view tests, fixture and messages.
2. Helpers handle only line rendering, language provenance or status presentation.
3. UI consumes the contracts; no persistence/API writes from this view.
4. No circular dependency introduced.
5. Boundary uses `OrderAccessDetail`, `SupportedLocale` and typed `StorefrontCopy`.
6. Component inputs and status outputs are serializable; no credentials are accepted.
7. No production ID/domain/currency/secret configuration introduced. Reserved `.example.test` media and USD are unit fixtures only.
8. No dependency changes.
9. The view and status mapping can be replaced without changing the read-model API.
10. Delegated unit/i18n/type/build/lint/format checks passed as above. Storefront combined build, real-browser seven-language matrix, privacy lifecycle and the full task gates are still the root's integration responsibility.

No phase status or task counts were changed by this subagent. Real PSP, email delivery, manual translation review, staging and physical-phone acceptance are outside this subtask.
