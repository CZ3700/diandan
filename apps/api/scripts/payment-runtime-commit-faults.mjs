import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createPostgresPersistence } from "@fan-support/persistence-postgres";
import { PersistenceTransactionFailureError } from "../../../packages/persistence-port/dist/index.js";
import { createCheckoutProtocolClient } from "./checkout-preflight-client.mjs";
import { createPaymentProtocolClient } from "./payment-runtime-client.mjs";

/** TEST transport boundary: the original transaction manager must resolve COMMIT before injection. */
export function wrapPaymentCommitFault(real, method) {
  if (!["beginCreate", "settleCreate"].includes(method))
    throw new TypeError("Unsupported payment commit fault boundary");
  let injections = 0;
  const manager = {
    async runInPaymentRuntimeTransaction(work) {
      let completedWrite = false;
      const result = await real.runInPaymentRuntimeTransaction(
        async (repos) => {
          const paymentRuntime = {
            ...repos.paymentRuntime,
            async [method](...args) {
              const value = await repos.paymentRuntime[method](...args);
              completedWrite = true;
              return value;
            },
          };
          return work({ ...repos, paymentRuntime });
        },
      );
      if (completedWrite && injections === 0) {
        injections++;
        throw new PersistenceTransactionFailureError({
          schemaVersion: 1,
          operation: "RUN_TRANSACTION",
          outcome: "FAILURE",
          error: {
            schemaVersion: 1,
            code: "TRANSACTION_OUTCOME_UNKNOWN",
            recovery: "RECONCILE_REQUIRED",
          },
        });
      }
      return result;
    },
  };
  return { manager, injections: () => injections };
}

/** Called by the owned HTTP fixture with its recovery worker stopped; no source rows are forged. */
export async function verifyPaymentRuntimeCommitFaults(context) {
  let assertions = 0;
  const check = (value, label) => {
    assertions++;
    context.check(value, label);
  };
  const canaries = [
    `commit-private-${randomUUID()}`,
    `commit-name-${randomUUID().slice(0, 8)}`,
    `commit-${randomUUID()}@example.invalid`,
  ];
  const checkout = createCheckoutProtocolClient({
    ...context,
    check,
    canaries,
  });
  const payment = createPaymentProtocolClient({ ...context, check, canaries });
  const cases = [];
  async function stored(checkoutId, key) {
    const { rows } = await context.client.query(
      `SELECT a.id,a.order_id,a.status,a.version::int,a.provider_call_started,
        a.action_type,a.action_ciphertext IS NOT NULL AS encrypted_action,
        operation.phase,receipt.id AS receipt_id,receipt.create_command_hash,
        (SELECT count(*)::int FROM public.payment_attempts sibling WHERE sibling.order_id=a.order_id) AS attempts,
        (SELECT count(*)::int FROM public.payment_create_receipts sibling WHERE sibling.checkout_session_id=receipt.checkout_session_id) AS receipts,
        (SELECT count(*)::int FROM public.orders sibling WHERE sibling.checkout_session_id=receipt.checkout_session_id) AS orders,
        (SELECT count(*)::int FROM public.payment_attempt_events event WHERE event.payment_attempt_id=a.id) AS events,
        (SELECT count(*)::int FROM public.outbox_events event WHERE event.event_type='PAYMENT_STATUS_CHANGED' AND event.aggregate_id=a.id) AS outbox
       FROM public.payment_create_receipts receipt
       JOIN public.payment_attempts a ON a.id=receipt.attempt_id
       JOIN public.payment_runtime_operations operation ON operation.id=receipt.operation_id
       WHERE receipt.checkout_session_id=$1::uuid AND receipt.idempotency_key=$2::text`,
      [checkoutId, key],
    );
    check(
      rows.length === 1,
      "Commit-loss lookup finds the permanent receipt under the original key",
    );
    const row = rows[0];
    check(
      row.attempts === 1 && row.receipts === 1 && row.orders === 1,
      "Commit recovery preserves one actual order, attempt and permanent create receipt",
    );
    check(
      row.events === row.version && row.outbox === row.events,
      "Committed payment versions retain exact original history and outbox authority",
    );
    return row;
  }
  async function waitForRealLease(attemptId) {
    const deadline = globalThis.performance.now() + 10_000;
    while (true) {
      const { rows } = await context.client.query(
        `SELECT phase='CREATE' AND next_attempt_at<=clock_timestamp()
          AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) AS ready
         FROM public.payment_runtime_operations WHERE attempt_id=$1::uuid`,
        [attemptId],
      );
      if (rows[0]?.ready === true) return;
      if (globalThis.performance.now() >= deadline) {
        check(
          false,
          "Original committed CREATE lease naturally expires within the bounded recovery window",
        );
        return;
      }
      await delay(50);
    }
  }
  for (const method of ["beginCreate", "settleCreate"]) {
    context.progress(`real payment commit response loss: ${method}`);
    const session = await checkout.initialize();
    await checkout.add(session);
    const validated = await checkout.validate(session);
    const created = await checkout.create(
      session,
      validated.data.preflight,
      canaries[2],
    );
    const checkoutId = created.data.checkout.id;
    const selected = await payment.capabilities(session, checkoutId);
    const capability = selected.data.capabilities.capabilities[0];
    check(
      capability?.environment === "TEST",
      "Commit-loss probe uses a normal published TEST capability",
    );
    const key = randomUUID();
    let injected;
    const api = await context.createPaymentApi({
      recovery: false,
      createPersistence(database, options) {
        const actual = createPostgresPersistence(database, options);
        injected = wrapPaymentCommitFault(
          actual.paymentRuntimeTransactionManager,
          method,
        );
        return {
          paymentRuntimeTransactionManager: injected.manager,
          close: () => actual.close(),
        };
      },
    });
    try {
      check(
        injected !== undefined,
        "Owned TEST composition forwards the real persistence factory",
      );
      const before = await context.psp.counts();
      await payment.create(session, checkoutId, capability, {
        key,
        target: api.base,
        expected: 503,
        code: "TRANSACTION_OUTCOME_UNKNOWN",
      });
      check(
        injected.injections() === 1,
        "Exactly one completed PostgreSQL write transaction loses its response",
      );
      const committed = await stored(checkoutId, key);
      const afterFault = await context.psp.counts();
      const expectedCalls = method === "beginCreate" ? 0 : 1;
      check(
        afterFault.createCalls === before.createCalls + expectedCalls &&
          afterFault.payments === before.payments + expectedCalls,
        "PSP call and payment counts match the actual interrupted transaction boundary",
      );
      check(
        method === "beginCreate"
          ? committed.status === "CREATED" &&
              committed.phase === "CREATE" &&
              !committed.provider_call_started &&
              !committed.encrypted_action
          : committed.status === "REQUIRES_ACTION" &&
              committed.phase === "RECONCILE" &&
              committed.provider_call_started &&
              committed.encrypted_action,
        "Real PostgreSQL state proves the first or second transaction committed completely",
      );
      const current = await payment.current(session);
      check(
        current.data.action === "CURRENT" &&
          current.data.checkout.id === checkoutId &&
          current.data.attempt?.id === committed.id &&
          current.data.attempt.status === committed.status,
        "Same protected Cookie discovers the committed checkout and attempt without browser payment IDs",
      );
      const replay = await payment.create(session, checkoutId, capability, {
        key,
      });
      check(
        replay.data.action === "REPLAYED" &&
          replay.data.attempt.id === committed.id,
        "Original permanent key replays its actual committed attempt",
      );
      check(
        JSON.stringify(await context.psp.counts()) ===
          JSON.stringify(afterFault),
        "Cookie status and permanent-key replay do not redispatch the PSP command",
      );
      let final = replay.data.attempt;
      if (method === "beginCreate") {
        await waitForRealLease(committed.id);
        const recovered = await payment.recover(
          session,
          checkoutId,
          committed.id,
        );
        final = recovered.data.attempt;
      }
      check(
        final.id === committed.id &&
          final.status === "REQUIRES_ACTION" &&
          final.action?.type === "REDIRECT" &&
          new globalThis.URL(final.action.url).origin === context.psp.origin,
        "Recovery returns the same attempt and genuine hosted action from the allowed TEST PSP",
      );
      const after = await stored(checkoutId, key);
      check(
        after.receipt_id === committed.receipt_id &&
          after.create_command_hash === committed.create_command_hash &&
          after.order_id === committed.order_id &&
          after.id === committed.id,
        "Recovery retains the original receipt, frozen create command, attempt and order",
      );
      const finalCounts = await context.psp.counts();
      check(
        finalCounts.createCalls === before.createCalls + 1 &&
          finalCounts.payments === before.payments + 1,
        "Each commit-loss scenario creates exactly one actual PSP payment",
      );
      cases.push({
        boundary: method,
        status: "PASS",
        injectedAfterCommittedTransaction: 1,
        createCallsBeforeRecovery: expectedCalls,
        totalCreateCalls: 1,
        originalOrderAndAttemptPreserved: true,
      });
    } finally {
      await api.stop();
    }
  }
  return {
    schemaVersion: 1,
    status: "PASS",
    assertions,
    cases,
    scope:
      "Actual PostgreSQL transactions and normal HTTP/TEST PSP; only the successful COMMIT response boundary is fault injected",
  };
}
