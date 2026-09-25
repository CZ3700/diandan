# P5-05 independent contract, domain and runtime review

Reviewer: UI owner (`/root/refund_admin_audit`), 2026-09-22. This is an independent read of root/runtime-owned implementation; those files were not edited by this reviewer. The final native PostgreSQL/HTTP/browser candidate is locally accepted; raw result aggregation and scope are recorded in `ui-verification.md`.

## Finding and resolution

**Fixed and independently rechecked against compiled application output:** `adminPaymentConfigurationResponseMatches` originally accepted a PUBLISH/ROLLBACK mutation with the requested action/revision but `publicationId: null` and `generation: 0`. A direct execution of the built contracts/application returned `{responseSchemaAccepts:true,responseMatchesAccepts:true,publicationId:null,generation:0}` for a valid publish command. Because both application and API route use the helper, an impossible publication receipt could have been returned as success.

The runtime owner added the required publication identity and positive generation checks, plus null publication identity for SAVE/SUBMIT/APPROVE. The UI client now enforces the same distinction and preserves uncertain requests. `ui-receipt-red.log` records the actual failing assertion; `ui-receipt-green.log` records 3 passing client tests. `ui-independent-application-tests.log` includes the updated helper tests. A later direct execution against the rebuilt packages returned `responseMatchesAccepts:false` for the same impossible publication receipt. No unrelated production authentication was changed.

Root's UI review also identified a permission/lifecycle mismatch. UI preflight now follows `canEdit` (VALIDATE requires `payments.configure`), whereas publication confirmation still requires `canPublish`. PUBLISH preflight is offered only for DRAFT/VALIDATED; restoration is offered only for a previously published SUPERSEDED revision different from the current head. `ui-authority-red.log` / `ui-authority-green.log` preserve this change's tests.

## Reviewed scope and conclusions

- Public configuration and persistence contracts, domain validation/diff, OpenAPI paths, persistence port, application command handler and reply correlation, API transport/composition/runtime/poller, dynamic health policy reader, and gateway registry activation were read.
- Schemas keep country, market, currency, payment method and locale separate. The browser supplies explicit scopes; no language-derived production defaults are introduced. Integer minor amounts and bounded rollout percentages are validated before the API call.
- Safe deployment facts contain account identity, labels, environment, declared methods and health settings. Credential references, merchant credentials and executable adapters are absent from public responses, editable documents and diff values. Strict command parsing rejects extra authority/secret fields. The UI renders text rather than executable HTML or serialized JSON.
- Validation checks the current English lineage and independent seven-language approval for enabled channels, eligible deployed account/merchant/health facts, supported methods, explicit scope lists and amount order. The server remains authoritative for transaction permissions, live MFA/CSRF/session, review locale, current publication and permanent receipts. UI role names do not grant authority.
- Domain diff emits actual bounded before/after values for operator-visible fields. UI displays those values without rendering internal translation hashes; legacy unknown health values are labeled as unrecorded. Current selected configuration also has a readable channel/rule summary.
- Publication projection selects from statically deployed immutable connectors. No database text loads code or changes credentials. All historically activated accounts must remain available for existing attempt/recovery bindings. Each node polls independently; queue delivery is not treated as a broadcast.
- Follow-up review covered the HTTP-discovered action-origin defect: the route originally captured the allowed provider origins at registration, so a newly published deployed account could create a valid attempt that its response validator rejected. The corrected route reads and validates the current composition directory for each response. The composition supplies static registrations plus the current activated directory; no request-provided origin becomes authority. The regression covers CREATE/READ/RECOVER for the newly activated origin, the retained historical origin, and rejection of an unregistered origin. `ui-independent-dynamic-origin-tests.log` records the independent targeted run.
- Projection validation and policy validation complete before registry activation; registry validates and constructs the entire next snapshot before swapping its visible references. No awaited work separates registry activation, policy assignment and generation update. Invalid/regressing/incomplete projection leaves the previous complete snapshot intact. A database refresh failure does not manufacture a new generation.
- Health readers reject version regression or changes under the same version, and validate the complete policy set. A changed policy is initialized through the persistence boundary; a stale in-flight initialization cannot mark a different version ready.
- API lifecycle is explicitly local OIDC composition here. It is a production-code path exercised locally, not evidence of a deployed production environment or merchant onboarding. The browser fixture uses Next development mode; a production build is a separate root gate.

No additional reproducible defect was found in this reviewed scope. The accepted real PostgreSQL/TEST PSP/dual-node/browser run supplements this source review. External merchant/staging evidence remains separate.

## Independently executed affected checks

All commands used `mise exec node@24.20.0 -- corepack pnpm`, exited 0:

- Domain `vitest run src/payment-configuration.test.ts`: 1 file / 25 tests (`ui-independent-domain-tests.log`).
- Application `vitest run src/admin-payment-configuration.test.ts src/payment-runtime-health-dynamic.test.ts`: 2 files / 9 tests (`ui-independent-application-tests.log`).
- API `vitest run src/payment-configuration-runtime.test.ts src/payment-configuration-lifecycle.test.ts src/admin-payment-configuration-route.test.ts`: 3 files / 12 tests (`ui-independent-api-tests.log`).
- Final receipt client tests: 3 tests; Admin typecheck, owned ESLint and formatting passed (`ui-receipt-*.log`).

Earlier view/editor/access tests have real missing-module/behavior RED evidence. `ui-diff-red.log` is a test JSX parse error and is explicitly **not** counted as valid RED behavior evidence; the corrected before/after render test is covered by `ui-tests-second.log` and subsequent candidate tests.
