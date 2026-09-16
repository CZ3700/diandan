# P4-06 independent application/Worker review

Reviewer: `/root/order_view`, non-author of the contracts, application, Worker
composition and persistence modules reviewed here. This reviewer authored the
mail renderer and gateway harness, so observations about those are integration
cross-checks rather than an independent approval of their implementation.

## P2 fixed: static sender credential was checked after link rotation

`apps/worker/src/notification-composition.ts:43–52` captures the environment map
and reads the configured credential only when `sendEmail` asks for it. A missing,
empty, too short, too long or non-printable value does not stop composition.

A lightweight probe using the built `createTestWorkerNotifications`, a valid
TEST profile and `credentials: {}` returned
`{"missingCredentialAcceptedAtConstruction":true}`. No service was started and
no mail was sent. The production path shares `prepare`; its DRAFT approval gate
currently prevents activation, but eventual human approval would expose the same
configuration defect.

`packages/application/src/order-notifications.ts:203–227` attaches the new link
before sending. `attachNotificationLink` retires previous links at first attach.
The predictably missing sender credential therefore causes a retry/failure only
after losing a previously usable link. It also allows the mutable environment
object to change credentials under a supposedly fixed runtime composition.

Recommended correction: validate and copy credentials for every active/retained
profile during preparation, using the gateway's actual length and printable
ASCII rules. Reject configuration with a stable error before infrastructure or
order mutation. Keep the raw credential out of errors/logs. Add missing, malformed,
retained-profile-missing and input-environment-mutation tests. A deliberate
credential rotation should rebuild the composition.

### Fix re-verification

The updated `prepare` validates every profile credential before creating any
transport, then captures only the validated string in its resolver. Missing,
short, long, control-character and retained-profile missing credentials are
rejected with a stable configuration error. Mutation of the input environment
cannot change an existing resolver.

The original RED is preserved in `credential-config-red.log`; root's
`credential-config-green-validated.log` has 7 passing tests. An independent
lightweight probe against the rebuilt module returned both
`missingCredentialRejectedAtConstruction: true` and
`credentialSnapshotFrozen: true`. This closes the P2. No production source was
changed by this reviewer.

## Reviewed boundaries

- Request creation freezes the template identity, requested/resolved locale,
  fallback reason, historical public order data, public origin, transport key,
  link nonce/pepper/TTL and absolute dedupe deadline in PostgreSQL.
- Worker retention is derived from the selected immutable gateway profile.
  Retained profiles are indexed by their own hash; an absent old profile fails
  without rerouting the old command to the new sender.
- UNKNOWN recovery preserves notification id, idempotency key, template and
  credential derivation. Lease-specific metadata is excluded from provider
  command bytes. The confirmed content hash detects any regeneration drift.
- Receiver admission is bounded by the frozen absolute deadline. The client
  rejects ACCEPTED receipts at/after that deadline and permits earlier stored
  receipt replay. This remains a custom receiver protocol, not an SMTP guarantee.
- Deterministic template/schema validation now precedes contact decryption and
  link rotation. Contact authorization/audit commits before KMS decryption; final
  send confirmation checks lease, contact, content hash and link status again.
- Notification failures are isolated from previously committed payment/order
  transitions. Worker maintenance catches notification errors and continues
  expiry; shutdown waits for active maintenance and queue processing.
- The existing `/:locale/order-access` entry is now used by contracts,
  application and renderer fixtures. The actual Worker-mail browser integration
  must pass separately; safe template previews are not a substitute.
- Production composition requires real template approval. All currently checked
  in language reviews remain DRAFT; tests do not constitute human approval.
- No new P1 or additional reproducible P2 was found in this read-only pass.

## S.U.P.E.R checks

| Check                        | Result in reviewed scope                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1. Module responsibility     | Pass: contracts, orchestration, config and runtime remain separated.                                  |
| 2. Function responsibility   | Pass: request/claim/render/recipient/confirm/send/finish are explicit steps.                          |
| 3. Dependency direction      | Pass: application uses ports; Worker supplies adapters.                                               |
| 4. Circular imports          | No new cycle identified by inspection; final repository check belongs to root.                        |
| 5. Schema-defined boundaries | Pass: new cross-module commands/results are strict versioned schemas.                                 |
| 6. Serializable data         | Pass: queue/persistence carry identifiers and frozen data, not raw credentials.                       |
| 7. Injected configuration    | Pass after re-verification: declared sender credentials are validated and frozen before mutation.     |
| 8. Explicit dependencies     | Pass in inspected application/Worker/provider package declarations.                                   |
| 9. Replaceable adapters      | Pass: renderer, key management, transport and persistence are injected.                               |
| 10. Validation               | Scoped tests/evidence exist; combined Worker/PG/browser and final repository gates are still running. |

No production readiness or P4-06 DONE statement is implied. Real mail provider,
domain/inbox verification and human translation approval remain release gates.
