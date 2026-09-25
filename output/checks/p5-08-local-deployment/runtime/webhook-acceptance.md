# Local signed webhook wiring regression

The local launcher called the canonical API application directly but had not started the repository's Node telemetry lifecycle. The existing Fastify request hooks therefore had no valid span, `createQueuePropagationCarrier()` returned undefined, and the strict webhook route returned HTTP 503 before verification/KMS/inbox receipt. Endpoint status, signing key, KMS envelope encryption and queue provisioning were valid.

The correction starts `startNodeTelemetry({ service: "api" })` before constructing the local API compositions, and the corresponding `worker` lifecycle in the independent Worker process. Ownership is registered first so reverse shutdown drains the API/Worker, queues and persistence before telemetry shutdown. These are the repository's explicit request/span hooks, not automatic HTTP import instrumentation. No payment, signature, propagation or persistence guard was loosened.

## Actual RED / GREEN

`local-experience-runtime-webhook-integration.mjs` opens a separately owned API listener on an ephemeral loopback port against the existing local TEST PostgreSQL database. It reads one explicitly supplied, already captured TEST provider attempt, signs its existing event, and sends the same event twice through the real HTTP route. Its PSP command fetcher rejects every new provider command.

- Before the correction: HTTP 503 versus expected 202; no request trace or inbox receipt.
- After the correction: both requests HTTP 202 with canonical request trace propagation; six assertions PASS.
- Exactly one webhook inbox row for the replayed provider event.
- No additional provider capture or money-ledger transaction.
- KMS encryption and durable queue publication ran through the existing receiver and real PG implementation.
- `local-experience-runtime-config.test.mjs` + `local-experience-kms.test.mjs`: three tests PASS.
- ESLint and Prettier for affected local runtime / Worker / KMS scripts: PASS.

Safe latest output: `webhook-http.txt`. Repeat with an explicitly selected existing captured TEST attempt:

```sh
mise exec node@24.20.0 -- node apps/api/scripts/local-experience-runtime-webhook-integration.mjs test-p508 <existing-captured-attempt-uuid>
```

No fresh purchase, capture, direct payment-state update, or external provider request is performed. The long-running supervisor must be restarted to load the corrected local composition; its durable TEST PSP retry loop then records its own delivery acknowledgement normally. This is local verification, not external merchant acceptance.
