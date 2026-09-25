# Payment connector directory verification

Scope: six files in `directory-source-freeze.json`. The existing runtime context type remains unchanged. Root owns shared exports, configuration contracts, API composition, package wiring and the final workspace gates.

The registry accepts only deployed synchronous factories and a schema-validated complete published snapshot. It validates the complete new configuration before constructing adapters, then publishes only after every construction succeeds. It rejects revision conflicts/rollback, historical account removal or any connection rewrite, unsupported adapter/version/protocol/instrument, missing core creation/recovery operations, and non-durable/no-reference-lookup descriptors. Old registrations are retained. Descriptors are declarations requiring real provider conformance, not merchant approval or financial evidence.

Application retains the existing static `providers` API and adds an optional live `providerDirectory`. Both paths share binding/duplicate/method validation. Later directory snapshots cannot remove or alter seen bindings; old callable façades stay pinned. Binding/array/factory inputs are defensive copies and frozen. Bound method copies retain original adapter receivers without freezing mutable transport state. The directory never replaces PostgreSQL account/routing/health/capability authorization, and no SQL, payment transition or idempotency logic changed.

## Commands and results

All commands use `mise exec node@24.20.0 -- corepack pnpm`.

- `--filter @fan-support/application test src/payment-runtime-directory.test.ts`: effective initial 5 assertion failures in `directory-application-red.log`; first 5 GREEN in `directory-application-green.log`.
- `--filter @fan-support/payment-gateway test src/registry.test.ts`: initial missing-entry assertions 19 FAIL / 1 PASS in `registry-red.log`; first 20 GREEN. Additional actual missing-core-operation assertions 4 FAIL / 26 PASS in `registry-operations-red.log`, followed by 30 GREEN. Final `registry-final.log`: 30 tests, exit 0.
- `--filter @fan-support/application test src/payment-runtime`: final `directory-application-final.log`, 3 files / 30 tests, exit 0. Includes 8 new directory cases and the existing payment runtime/recovery tests.
- Application `typecheck` and `build`: `directory-application-types-final.log` / `directory-application-build.log`, exit 0.
- Gateway `typecheck`: first checkpoint exit 0 (`directory-gateway-types.log`); later package check exit 2 only in concurrently authored `client.ts` / `webhook.test.ts` (`directory-gateway-types-final.log`). Registry files have no diagnostics. Root will run the completed package build/types; this report does not label that later package check green.
- Scoped ESLint six files: `directory-lint-final.log`, exit 0. Scoped Prettier check six files: `directory-format-check.log`, exit 0. Earlier branded test URL and one test-only `this` alias diagnostics remain preserved in the earlier logs.

## S.U.P.E.R review

1. Single module responsibility: registry assembly, Application provider validation, optional dependency type, and behavior tests remain separate.
2. Functions perform construction, validation/snapshot reading or lookup; no business/payment I/O is added to registry assembly.
3. Dependency direction remains Application → payment port and adapter → contracts/port; the live directory supplies deployed dependencies only.
4. No reverse or circular module imports were introduced. The port adds only a type; Application uses its existing content canonicalizer dependency.
5. Connections/descriptors/snapshots/bindings use the shared versioned schemas; the directory is an explicitly typed composition dependency.
6. All business I/O remains serializable port commands/results. Provider functions are process-local composition objects and are never persisted or sent over business interfaces.
7. Production registry uses configuration-driven account/adapter/protocol/origins. Only test fixtures contain dummy origins/IDs. Core operation names are protocol constants, not vendor routing.
8. No dependencies were added by this scope. Gateway dependencies/package registration are owned by root.
9. Deployed factory/directory implementations can be exchanged through their port types. Existing callers may continue to supply static providers.
10. All scoped behavior/static checks above pass; later full package/workspace/real HTTP gates remain root's pending acceptance and are not inferred from unit results.

No browser, PostgreSQL instance, real merchant, real PSP sandbox, or production deployment was started for this scope. Factory construction is contractually synchronous and free of business I/O; factories are deployed trusted code, never uploaded code. The registry is a rebuildable process projection, not a durable publication/broadcast service.
