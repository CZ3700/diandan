import { randomBytes, randomUUID } from "node:crypto";
import { waitForOrderPayment } from "./order-payment-client.mjs";
const economic = (value) => ({
  payments: value.payments,
  captures: value.captures,
  createCalls: value.createCalls,
  refunds: value.refunds,
  refunded: value.refunded,
  refundCalls: value.refundCalls,
  cancelCalls: value.cancelCalls,
});
/** Normal HTTP commands and the actual Worker must restore original evidence without duplicate effects. */
export async function verifyAdminExceptionsProtocol(context, runtime) {
  const { client, check, progress } = context;
  const manager = await runtime.login("manager"),
    operator = await runtime.login("order"),
    editor = await runtime.login("editor");
  check(
    (await runtime.call(manager, "context")).permissions.canReplayWebhook,
    "manager holds explicit exception replay permission",
  );
  check(
    !(await runtime.call(operator, "context")).permissions.canReplayWebhook,
    "read-only actor cannot replay source events",
  );
  check(
    (
      await runtime.call(
        editor,
        "context",
        { schemaVersion: 1 },
        { status: 403 },
      )
    ).code === "FORBIDDEN",
    "content-only role cannot read exceptions",
  );
  progress(
    "create authentic refund, queue, UNKNOWN and failed-notification sources",
  );
  const fixture = await runtime.createSources(manager);
  progress("wait for actual pg-boss six-attempt dead letters");
  await runtime.exhaustQueue(fixture);
  const initial = await runtime.facts(),
    sourceStates = {};
  for (const key of [
    "webhookTarget",
    "deadLetterTarget",
    "paymentTarget",
    "notificationTarget",
  ]) {
    const detail = await runtime.detail(manager, fixture[key]);
    check(
      detail.item.allowedAction !== null,
      `${key} is a current actionable source`,
    );
    sourceStates[key] = detail.item;
  }
  const blocked = await runtime.detail(
    manager,
    fixture.blockedNotificationTarget,
  );
  check(
    blocked.item.status === "UNKNOWN" &&
      blocked.item.allowedAction === null &&
      blocked.item.blockedReason === "NOTIFICATION_UNCERTAIN",
    "accepted but unknown mail remains review-only",
  );
  check(
    (
      await runtime.mutate(manager, "retry-notification", blocked.item, {
        status: 409,
      })
    ).code === "RECONCILIATION_REQUIRED",
    "unknown notification cannot create a new send",
  );
  for (const category of [
    "ALL",
    "WEBHOOK",
    "DEAD_LETTER",
    "PAYMENT",
    "NOTIFICATION",
  ]) {
    const result = await runtime.call(manager, "list", {
      schemaVersion: 1,
      page: 1,
      pageSize: 2,
      category,
      status: "OPEN",
    });
    check(
      result.items.length <= 2 &&
        result.items.every(
          (item) => category === "ALL" || item.target.kind === category,
        ),
      "bounded category list matches canonical sources",
    );
  }
  check(
    (
      await runtime.mutate(
        operator,
        "replay-webhook",
        sourceStates.webhookTarget,
        { status: 403 },
      )
    ).code === "FORBIDDEN",
    "read-only actor fails before event mutation",
  );
  const changed = { ...sourceStates.webhookTarget, version: "0".repeat(64) };
  check(
    (await runtime.mutate(manager, "replay-webhook", changed, { status: 409 }))
      .code === "STALE_VERSION",
    "stale version cannot authorize recovery",
  );
  progress("durable HTTP response loss, concurrent retries and source fencing");
  const key = randomUUID();
  runtime.armApiResponseLoss("REPLAY_WEBHOOK");
  check(
    (
      await runtime.mutate(
        manager,
        "replay-webhook",
        sourceStates.webhookTarget,
        { key, status: 503 },
      )
    ).code === "TEMPORARY_UNAVAILABLE",
    "actual API loses result after durable acceptance",
  );
  const copies = await Promise.all(
    Array.from({ length: 10 }, () =>
      runtime.mutate(manager, "replay-webhook", sourceStates.webhookTarget, {
        key,
      }),
    ),
  );
  check(
    copies.every(
      (item) => item.replayed && item.operationId === copies[0].operationId,
    ),
    "ten concurrent same-key retries return one permanent operation",
  );
  const active = await runtime.detail(manager, fixture.webhookTarget);
  check(
    active.item.blockedReason === "IN_PROGRESS",
    "different command cannot own an already pending source",
  );
  check(
    (
      await runtime.mutate(manager, "replay-webhook", active.item, {
        status: 409,
      })
    ).code === "SOURCE_IN_PROGRESS",
    "different-key replay cannot create a concurrent operation",
  );
  check(
    (
      await runtime.call(
        manager,
        "replay-webhook",
        {
          schemaVersion: 1,
          target: fixture.webhookTarget,
          expectedVersion: sourceStates.webhookTarget.version,
          reasonCode: "RETRY_AFTER_REPAIR",
          confirmed: true,
        },
        { key, status: 409 },
      )
    ).code === "IDEMPOTENCY_CONFLICT",
    "same key cannot silently change its reason or request identity",
  );
  await runtime.revokeAccess();
  check(
    (
      await runtime.mutate(
        manager,
        "replay-webhook",
        sourceStates.webhookTarget,
        { key, status: 403 },
      )
    ).code === "FORBIDDEN",
    "even existing receipts require current permission",
  );
  await runtime.restoreAccess();
  const interruptedClaim =
    await context.persistence.adminExceptionsTransactionManager.runInAdminExceptionsTransaction(
      (repository) =>
        repository.claim({
          schemaVersion: 1,
          operationId: copies[0].operationId,
          requestId: randomUUID(),
          correlationId: randomUUID(),
          leaseTokenDigest: randomBytes(32).toString("hex"),
          leaseDurationMs: 1000,
        }),
    );
  check(
    interruptedClaim?.operationId === copies[0].operationId,
    "real database lease binds the original replay operation before interruption",
  );
  await runtime.process(interruptedClaim.job, {
    schemaVersion: 1,
    jobId: interruptedClaim.operationId,
    attemptNumber: 6,
    maxAttempts: 6,
  });
  const committedBeforeCrash = await runtime.facts();
  check(
    committedBeforeCrash.refunds === initial.refunds + 1,
    "trusted refund side effect commits before the simulated worker interruption",
  );
  // Simulate interruption after business commit by omitting settlement. A fresh worker
  // must reclaim the expired lease and reuse the original handler's effect keys.
  await runtime.restartRecovery();
  await waitForOrderPayment(
    "fresh worker recovers expired lease after refund business commit",
    async () => {
      await runtime.recover();
      return (
        await client.query(
          "SELECT status='SUCCEEDED' AND generation=2 ready FROM admin_exception_operations WHERE id=$1",
          [interruptedClaim.operationId],
        )
      ).rows[0]?.ready;
    },
    check,
  );
  const refundApplied = await runtime.facts();
  check(
    refundApplied.refunds === initial.refunds + 1,
    "trusted replay adds exactly one economic refund transaction",
  );
  check(
    refundApplied.webhook_effects === committedBeforeCrash.webhook_effects &&
      refundApplied.fulfillment_events ===
        committedBeforeCrash.fulfillment_events,
    "crash lease recovery never duplicates committed webhook or fulfillment effects",
  );
  const staleSettlement =
    await context.persistence.adminExceptionsTransactionManager.runInAdminExceptionsTransaction(
      (repository) =>
        repository.settle({
          schemaVersion: 1,
          claim: interruptedClaim,
          outcome: "SUCCEEDED",
          reasonCode: "PROCESSED",
        }),
    );
  check(
    staleSettlement.decision === "STALE",
    "interrupted worker cannot settle after a new generation owns completion",
  );
  for (let iteration = 0; iteration < 10; iteration++)
    await runtime.process(runtime.webhookJob(fixture.webhookTarget.id), {
      schemaVersion: 1,
      jobId: randomUUID(),
      attemptNumber: 1,
      maxAttempts: 6,
    });
  const afterRepeatedWebhook = await runtime.facts();
  check(
    afterRepeatedWebhook.refunds === refundApplied.refunds &&
      afterRepeatedWebhook.fulfillment_events ===
        refundApplied.fulfillment_events &&
      afterRepeatedWebhook.webhook_effects === refundApplied.webhook_effects,
    "ten real handler replays do not repeat refund, fulfillment or webhook effects",
  );
  const done = await runtime.detail(manager, fixture.webhookTarget);
  check(
    (
      await runtime.mutate(manager, "replay-webhook", done.item, {
        status: 409,
      })
    ).code === "TRANSITION_NOT_ALLOWED",
    "new key cannot reopen a completed event",
  );
  progress(
    "recover original dead-letter consumer identity and preserve notification history",
  );
  const dlq = await runtime.detail(manager, fixture.deadLetterTarget),
    dlqKey = randomUUID();
  const dlqReceipts = await Promise.all(
    Array.from({ length: 3 }, () =>
      runtime.mutate(manager, "retry-dead-letter", dlq.item, { key: dlqKey }),
    ),
  );
  check(
    new Set(dlqReceipts.map((value) => value.operationId)).size === 1,
    "dead-letter retries own one operation",
  );
  await runtime.restartRecovery();
  await waitForOrderPayment(
    "actual worker restores the original notification consumer",
    async () => {
      await runtime.recover();
      return (
        (await runtime.detail(manager, fixture.deadLetterTarget)).item
          .status === "SUCCEEDED"
      );
    },
    check,
  );
  await runtime.recover();
  const beforeDispatch = await runtime.facts();
  for (let iteration = 0; iteration < 10; iteration++)
    await runtime.dispatch(runtime.outboxJob(fixture.deadLetterTarget.id), {
      schemaVersion: 1,
      jobId: randomUUID(),
      attemptNumber: 1,
      maxAttempts: 6,
    });
  const afterDispatch = await runtime.facts();
  check(
    beforeDispatch.notifications === afterDispatch.notifications &&
      beforeDispatch.receiverAccepted === afterDispatch.receiverAccepted &&
      beforeDispatch.outbox_effects === afterDispatch.outbox_effects,
    "ten real consumer replays create no duplicate notification or transport send",
  );
  const notification = await runtime.detail(
      manager,
      fixture.notificationTarget,
    ),
    originalNotification = (
      await client.query(
        "SELECT status,attempt_count,version FROM notification_deliveries WHERE id=$1",
        [fixture.notificationTarget.id],
      )
    ).rows[0];
  const notificationKey = randomUUID();
  const resends = await Promise.all(
    Array.from({ length: 3 }, () =>
      runtime.mutate(manager, "retry-notification", notification.item, {
        key: notificationKey,
      }),
    ),
  );
  check(
    new Set(resends.map((value) => value.operationId)).size === 1,
    "definite notification failure delegates once to the existing resend receipt",
  );
  await gatewayRestartAndRecover(
    runtime,
    check,
    resends[0].operationId,
    client,
  );
  check(
    JSON.stringify(
      (
        await client.query(
          "SELECT status,attempt_count,version FROM notification_deliveries WHERE id=$1",
          [fixture.notificationTarget.id],
        )
      ).rows[0],
    ) === JSON.stringify(originalNotification),
    "operator resend leaves original failure and attempt history unchanged",
  );
  const beforeResendDuplicate = await runtime.facts();
  await runtime.manual.deliver(resends[0].operationId);
  check(
    (await runtime.facts()).receiverAccepted ===
      beforeResendDuplicate.receiverAccepted,
    "completed original resend ID cannot dispatch twice",
  );
  progress("UNKNOWN reconciles only the frozen provider account");
  const unknown = await runtime.detail(manager, fixture.paymentTarget);
  const beforePspCounts = await context.psp.counts();
  const beforePsp = economic(beforePspCounts);
  const beforeObservationCount = (await context.psp.observations()).length;
  const reconciliation = await runtime.mutate(
    manager,
    "reconcile-payment",
    unknown.item,
  );
  await waitForOrderPayment(
    "original account reconcile safely confirms UNKNOWN",
    async () => {
      await runtime.recover();
      return (
        (await runtime.detail(manager, fixture.paymentTarget)).item.status ===
        "SUCCEEDED"
      );
    },
    check,
  );
  check(
    JSON.stringify(economic(await context.psp.counts())) ===
      JSON.stringify(beforePsp),
    "reconciliation performs no create, cancel or refund call",
  );
  const observations = (await context.psp.observations())
    .slice(beforeObservationCount)
    .filter((value) => value.operation === "RECONCILE_PAYMENT");
  check(
    observations.length >= 1 && observations.every((value) => value.accepted),
    "this UNKNOWN recovery makes a new authenticated successful PSP reconciliation",
  );
  check(
    (await context.psp.counts()).reconcileCalls >
      beforePspCounts.reconcileCalls,
    "durable independent PSP confirms a new reconcile call",
  );
  const [binding] = (
    await client.query(
      `SELECT x.attempt_id=a.id AND x.provider_account_id=a.provider_account_id
       AND x.environment=a.environment AND x.adapter_key=p.adapter_key
       AND x.phase='COMPLETE' original_binding,
       EXISTS(SELECT 1 FROM provider_events e JOIN audit_logs l ON l.id=e.reconcile_audit_log_id
        WHERE e.provider_account_id=a.provider_account_id AND e.environment=a.environment
        AND e.external_payment_reference=a.external_reference
        AND e.evidence_kind='AUTHENTICATED_RECONCILE' AND l.subject_id=a.provider_account_id
        AND l.action='PAYMENT_PROVIDER_RECONCILE' AND l.outcome='SUCCEEDED'
        AND EXISTS(SELECT 1 FROM audit_logs dispatch WHERE dispatch.subject_id=x.id
         AND dispatch.action='FINANCE_RECONCILE_DISPATCH_AUTHORIZED'
         AND dispatch.request_id=l.request_id AND dispatch.correlation_id=l.correlation_id)) original_evidence
       FROM admin_finance_operations x JOIN payment_attempts a ON a.id=$2
       JOIN payment_provider_accounts p ON p.id=a.provider_account_id AND p.environment=a.environment
       WHERE x.id=$1`,
      [reconciliation.operationId, fixture.paymentTarget.id],
    )
  ).rows;
  check(
    binding?.original_binding && binding.original_evidence,
    "reconcile operation and authenticated provider evidence retain original attempt account environment and adapter",
  );
  const final = await runtime.facts();
  check(
    final.delivered === initial.delivered,
    "exception work never automatically delivers a gift",
  );
  check(
    (await runtime.detail(manager, fixture.blockedNotificationTarget)).item
      .allowedAction === null,
    "unknown notification remains blocked after all recovery work",
  );
  return {
    manager,
    fixture,
    initial,
    final,
    sameKeyReplays: 10,
    realWebhookHandlerReplays: 10,
    realOutboxHandlerReplays: 10,
    originalNotificationPreserved: true,
    unknownNotificationResent: false,
    originalPaymentAccountReconciled: true,
    simulatedPostCommitInterruptionRecovered: true,
    newReconcileObservations: observations.length,
  };
}
async function gatewayRestartAndRecover(runtime, check, id, client) {
  await runtime.gateway.restart();
  await runtime.restartRecovery();
  await waitForOrderPayment(
    "restarted mail and worker consume one authorized resend",
    async () => {
      await runtime.recover();
      return (
        await client.query(
          "SELECT status='SENT' ready FROM admin_notification_resends WHERE id=$1",
          [id],
        )
      ).rows[0]?.ready;
    },
    check,
  );
}
export { economic as exceptionEconomicCounts };
