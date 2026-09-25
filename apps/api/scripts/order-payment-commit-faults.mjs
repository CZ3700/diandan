import assert from "node:assert/strict";
import { createOrderPaymentApplication } from "@fan-support/application";

/** Faults wrap the actual PostgreSQL manager; the inner repository/guards/COMMIT are unchanged. */
export async function verifyOrderPaymentCommitFaults(context, api) {
  const value = await api.fresh();
  await api.settle(value);
  const eventId = await api.reconcile(value);
  const real = context.persistence.orderPaymentApplicationTransactionManager;
  const before = await api.state(value),
    calls = await context.psp.counts();
  let rolledBack = false;
  const rollback = createOrderPaymentApplication({
    transactions: {
      runInOrderPaymentApplicationTransaction: (work) =>
        real.runInOrderPaymentApplicationTransaction(async (repository) => {
          await work(repository);
          rolledBack = true;
          throw new Error("OWNED_TEST_BEFORE_COMMIT");
        }),
    },
  });
  await assert.rejects(
    rollback.apply(api.command(eventId)),
    (error) => error.code === "PERSISTENCE_FAILURE",
  );
  context.check(
    rolledBack,
    "Owned fault occurs only after the real application repository writes inside the transaction",
  );
  context.check(
    JSON.stringify(await api.state(value)) === JSON.stringify(before),
    "Actual transaction rollback leaves payment, order, inventory, intents and outbox unchanged",
  );
  const receiptCount = (
    await context.client.query(
      "SELECT count(*)::int AS count FROM order_payment_application_receipts WHERE provider_event_id=$1::uuid",
      [eventId],
    )
  ).rows[0].count;
  context.check(
    receiptCount === 0,
    "Pre-COMMIT failure rolls back the permanent application receipt",
  );
  let committed = false;
  const unknown = createOrderPaymentApplication({
    transactions: {
      async runInOrderPaymentApplicationTransaction(work) {
        await real.runInOrderPaymentApplicationTransaction(work);
        committed = true;
        throw new Error("OWNED_TEST_AFTER_COMMIT");
      },
    },
  });
  await assert.rejects(
    unknown.apply(api.command(eventId)),
    (error) => error.code === "PERSISTENCE_FAILURE",
  );
  context.check(
    committed,
    "Unknown-result injection occurs only after actual PostgreSQL COMMIT succeeds",
  );
  const paid = await api.assertPaid(value);
  context.check(
    (await api.apply(eventId)).decision === "ALREADY_APPLIED",
    "Retry after an unknown COMMIT result recovers the permanent receipt",
  );
  context.check(
    JSON.stringify(await api.state(value)) === JSON.stringify(paid),
    "Unknown-result recovery does not repeat any order or inventory effect",
  );
  context.check(
    JSON.stringify(await context.psp.counts()) === JSON.stringify(calls),
    "Evidence application and recovery never dispatch a new PSP call",
  );
  return {
    cases: ["BEFORE_COMMIT_ROLLBACK", "AFTER_COMMIT_RESULT_UNKNOWN"],
    actualPostgresCommit: true,
    actualNetworkDisconnect: false,
  };
}
