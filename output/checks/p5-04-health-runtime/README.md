# P5-04 runtime health wiring evidence

Scope: local application/composition/gateway changes only. PostgreSQL integration, the shared contracts/domain implementation, the real TEST HTTP proof and final repository gates belong to the root task's combined acceptance. This checkpoint does not complete P5-04 or approve a live merchant.

## Verified behavior

- Real checkout and published-route context feeds a read-only capability probe; no fabricated market, currency, amount or attempt.
- PostgreSQL policy bootstrap is explicit and idempotent. Missing policy/bootstrap/health-record failures close new capability admission; existing payment recovery still runs.
- Finite technical/business/configuration classifications contain no provider payload. Valid empty capabilities remain successful communication; correlated unavailable capabilities and canceled payments are business outcomes.
- Health persistence failure cannot replace an accepted create response or discard authenticated reconcile. Existing create receipts still prevent duplicate payment calls.
- The existing recovery lifecycle supplies one independent health probe slot per sweep. The probe has a policy-bounded local deadline; a late response cannot complete the same lease twice. PostgreSQL remains authoritative for expiry and fencing.
- Production factories require a complete explicit `FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON` set for their bindings. The TEST factory remains backward compatible when health is explicitly omitted.

## Commands and results

All commands use `mise exec node@24.20.0 --`.

| Check | Command after the prefix | Evidence | Result |
| --- | --- | --- | --- |
| Application regressions | `corepack pnpm --filter @fan-support/application test src/payment-runtime.test.ts src/payment-runtime-provider.test.ts src/payment-runtime-directory.test.ts src/payment-runtime-health.test.ts` | `application-regression-final-2.log` | 4 files / 55 tests PASS, including 25 health cases |
| Gateway regression | `corepack pnpm --filter @fan-support/payment-gateway test` | `gateway-regression.log` | 9 files / 106 tests PASS |
| API runtime regression | `corepack pnpm --filter @fan-support/api test src/payment-runtime-composition.test.ts src/payment-runtime-lifecycle.test.ts src/payment-runtime-bootstrap.test.ts src/payment-runtime-route.test.ts` | `api-regression.log` | 4 files / 20 tests PASS |
| Application types | `corepack pnpm --filter @fan-support/application typecheck` | `application-typecheck-final.log` | PASS |
| Gateway types | `corepack pnpm --filter @fan-support/payment-gateway typecheck` | `gateway-typecheck.log` | PASS |
| ESLint | Explicit owned runtime/application/API/gateway file list | `lint-final.log` | PASS |

RED evidence is retained in `gateway-red.log`, `lifecycle-red.log`, `application-red.log`, `application-classification-red.log`, `application-probe-red.log`, `composition-red.log`, `probe-deadline-red.log`, `gateway-unavailable-red.log`, `application-unavailable-red.log`, and `canceled-red.log`. Each failure concerns the missing/faulty target behavior. `gateway-lifecycle-red.log` is separately retained as an initial incorrect root-level Vitest invocation that found no tests; it is not RED behavior evidence. Intermediate typecheck failures were corrected and retained.

## Boundaries

- No live PSP, funds, merchant credentials or production deployment were used.
- The adapter port has no abort parameter. A deadline stops awaiting a probe and ignores late results; an adapter should still enforce its own network deadline. The normalized gateway already aborts its bounded transport.
- A failed health-record transaction may lose that observation; it cannot justify replaying a financial provider call. New capabilities close, and the original durable payment/reconcile path retains priority.
- No new process, queue, PSP or administrative policy publishing UI was added.
