# P4-03 checkout preflight implementation and acceptance

Baseline: 059dd9d70ab9212db9670a0e2fc47fcef460dbb0. Local only.

1. Freeze additive contracts: server observation, current per-object translation/media snapshots, precise policy consent, encrypted contact, safe session response and persistence port.
2. Validate authenticated cart in a consistent transaction, returning a persisted expiring observation of current server totals, lines and approved policies. Validation never reserves stock or creates an order.
3. Create using only observation reference, expected cart version, email and explicit policy acceptance. Prove cookie scope and idempotency before external KMS; roll back provisional claim. Encrypt contact outside transaction. Reauthenticate and revalidate all canonical facts, then atomically persist immutable quote/amount/order/items/initial fulfillment/policy acceptance, tracked reservations/balances/ledger, cart and intent locks, receipt and outbox.
4. Read session with the same authenticated cart. Return historical safe snapshots without rereading mutable catalog and without exposing support intent, object keys, email, private text, fulfillment profile or internal order IDs. A locale shell change cannot resnapshot the order.
5. Failure tests: strict untrusted amounts/IDs, cart and item/intent versions, market/currency, changed artist/product/eligibility/price/stock/policy/media, expired preflight/quote, replay vs conflict, unknown commit recovery, no partial writes, same variant across artists, cumulative tracked stock and repeatable procure/preorder.
6. Actual PostgreSQL migration up/down/up and destructive rollback refusal with existing history, concurrency/HTTP/security and seven-language provenance assertions. Refresh existing required P2 composite/motion collectors after source freeze; no changed product UI in this task.
7. Affected tests, format/lint/typecheck/build, contract compatibility, original full repository gates, source and old-untracked SHA comparison, independent review/S.U.P.E.R, phase/master updates and exact local commit.

Owners: root Application/shared registry/OpenAPI/root scripts/integration/evidence/Git; storefront_read additive contracts/domain/ports; storefront_directory PG/0025 and migration proofs; storefront_e2e API/composition/new PG HTTP protocol. Shared consumers start only after contract freeze. Each author first records a failing test.

Scope limits: no payment capability or provider attempt, no actual PSP/funds, no production policy approval, no new frontend checkout flow, no P3-06 human/performance acceptance or production release. All gift categories remain studio-to-artist delivery. Missing real fulfillment configuration and missing approved critical policies fail closed with explicit codes; TEST fixtures may establish labelled TEST data only.
