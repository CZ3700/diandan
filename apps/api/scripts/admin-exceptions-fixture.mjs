import { randomUUID } from "node:crypto";
import {
  createProcessWebhookInbox,
  createDispatchOutboxEvent,
  createOrderPaymentWebhookHandler,
  createAdminFinanceWebhookHandler,
  createOrderNotificationUseCases,
  createAdminOrderResendUseCases,
} from "@fan-support/application";
import { createPgBossReliableEventQueue } from "@fan-support/persistence-postgres";
import { createOrderNotificationTemplates } from "@fan-support/i18n/notifications";
import { createLocalAdminExceptionsComposition } from "../dist/admin-exceptions-composition.js";
import { createLocalAdminFinanceComposition } from "../dist/admin-finance-composition.js";
import { createAdminOrdersRuntime } from "./admin-orders-runtime.mjs";
import { createPaidAdminOrder } from "./admin-orders-fixtures.mjs";
import {
  createFinanceBrowserSessionClock,
  createFinanceTokenClock,
} from "./admin-finance-session-clock.mjs";
import { observeFinanceBrowserSession } from "./admin-finance-diagnostics.mjs";
import { createPersistentNotificationGatewayHarness } from "../../worker/scripts/notification-gateway-harness.mjs";
import { waitForOrderPayment } from "./order-payment-client.mjs";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";
import { createWorkerReliableEventsComposition } from "../../worker/dist/reliable-events-composition.js";
import { createReliableEventsWorkerRuntime } from "../../worker/dist/reliable-events-runtime.js";

/** Only owned TEST infrastructure and normal business commands create the four exception sources. */
export async function createAdminExceptionsFixture(context, payment) {
  const { client, persistence, check, own } = context;
  let finance, exceptions, sessionClock, observeSession, loseNextAction;
  const runtime = await createAdminOrdersRuntime(context, {
    beforeValidTokenResponse: createFinanceTokenClock({ client, check }),
    async seedAdditionalRoles({ actors }) {
      for (const key of [
        "exceptions.read",
        "exceptions.replay",
        "finance.manage",
      ])
        await client.query(
          "INSERT INTO role_permissions(role_id,permission_id,granted_by) SELECT $1,id,$2 FROM permissions WHERE permission_key=$3 ON CONFLICT DO NOTHING",
          [actors.manager.roleId, actors.manager.id, key],
        );
      await client.query(
        "INSERT INTO role_permissions(role_id,permission_id,granted_by) SELECT $1,id,$2 FROM permissions WHERE permission_key='exceptions.read' ON CONFLICT DO NOTHING",
        [actors.order.roleId, actors.manager.id],
      );
    },
    composeAdditional({ tokenPepper, adminOrigin }) {
      sessionClock = createFinanceBrowserSessionClock({
        client,
        tokenPepper,
        check,
      });
      observeSession = observeFinanceBrowserSession({
        client,
        tokenPepper,
        own,
      });
      exceptions = createLocalAdminExceptionsComposition({
        environment: "LOCAL_OIDC",
        database: context.database,
        tokenPepper,
        allowedOrigin: adminOrigin,
      });
      const execute = exceptions.adminExceptionsRoute.useCases.execute;
      exceptions = {
        ...exceptions,
        adminExceptionsRoute: {
          ...exceptions.adminExceptionsRoute,
          useCases: {
            execute: async (request) => {
              const response = await execute(request);
              if (
                loseNextAction === request.command.action &&
                response.outcome === "SUCCESS" &&
                response.kind === "MUTATION"
              ) {
                loseNextAction = undefined;
                throw new Error("TEST accepted response unavailable");
              }
              return response;
            },
          },
        },
      };
      finance = createLocalAdminFinanceComposition({
        environment: "LOCAL_OIDC",
        database: context.database,
        tokenPepper,
        allowedOrigin: adminOrigin,
        providers: [context.providerRegistration],
        leaseMs: 2000,
        retryAfterMs: 1000,
      });
      return {
        ...exceptions,
        ...finance,
        adminFinanceRuntime: {
          start: async () => undefined,
          stop: () => finance.adminFinanceRuntime.stop(),
        },
      };
    },
  });
  payment.canaries.forEach(runtime.registerSecret);
  const call = (session, path, body = { schemaVersion: 1 }, options = {}) =>
    runtime.command(session, path, body, {
      ...options,
      namespace: "exceptions",
    });
  const detail = (session, target) =>
    call(session, "detail", { schemaVersion: 1, target });
  const mutate = (session, path, item, options = {}) =>
    call(
      session,
      path,
      {
        schemaVersion: 1,
        target: item.target,
        expectedVersion: item.version,
        reasonCode: "OPERATOR_REVIEW",
        confirmed: true,
      },
      { key: randomUUID(), ...options },
    );
  const gateway = await createPersistentNotificationGatewayHarness({ context });
  own("exception TEST notification gateway", () => gateway.close());
  let mailAvailable = true;
  const shared = {
    configuration: {
      schemaVersion: 1,
      siteName: "TEST Support",
      publicStorefrontOrigin: context.origin,
      transportKey: gateway.transportKey,
      linkPepperVersion: "test-mac",
      linkTtlSeconds: 3600,
      idempotencyRetentionSeconds: 3600,
      leaseSeconds: 30,
      retryDelaySeconds: 1,
      maxAttempts: 1,
    },
    keyManagement: context.kms.adapter,
    templates: createOrderNotificationTemplates({ mode: "TEST_DRAFT" }),
    transportForKey: (key) =>
      mailAvailable && key === gateway.transportKey
        ? gateway.transport
        : undefined,
  };
  const automatic = createOrderNotificationUseCases({
    ...shared,
    transactions: persistence.notificationTransactionManager,
  });
  const manual = createAdminOrderResendUseCases({
    ...shared,
    configuration: { ...shared.configuration, maxAttempts: 6 },
    transactions: persistence.adminOrderResendNotificationTransactionManager,
  });
  const now = () => new Date().toISOString();
  const process = createProcessWebhookInbox({
    transactionManager: persistence.reliableEventTransactionManager,
    createId: randomUUID,
    now,
    handlerForEvent: (event) =>
      event === "PAYMENT_STATUS"
        ? createOrderPaymentWebhookHandler()
        : createAdminFinanceWebhookHandler(),
  });
  const dispatch = createDispatchOutboxEvent({
    transactionManager: persistence.reliableEventTransactionManager,
    createId: randomUUID,
    now,
    consumerForKey: (key) =>
      key === "order-notifications-v1" ? automatic.consumer : undefined,
  });
  let worker;
  async function startWorker() {
    if (worker) return worker;
    let maintenance;
    const composition = createWorkerReliableEventsComposition(
      preflightEnvironment(context.database),
      {
        factories: {
          createRuntime(configuration) {
            maintenance = createReliableEventsWorkerRuntime({
              ...configuration,
              schedule: () => ({ cancel() {} }),
            });
            return maintenance;
          },
          prepareNotifications: () => () => ({
            ...automatic,
            runPending: async (limit) => {
              const a = await automatic.runPending(limit),
                m = await manual.runPending(limit);
              return {
                schemaVersion: 1,
                scanned: a.scanned + m.scanned,
                sent: a.sent + m.sent,
                scheduled: a.scheduled + m.scheduled,
                failed: a.failed + m.failed,
                skipped: a.skipped + m.skipped,
              };
            },
          }),
        },
      },
    );
    own("exception actual recovery worker", () => composition.stop());
    await composition.start();
    worker = { composition, maintenance };
    return worker;
  }
  async function stopWorker() {
    if (worker) {
      await worker.composition.stop();
      worker = undefined;
    }
  }
  const source = async (orderId) =>
    (
      await client.query(
        "SELECT id,correlation_id FROM outbox_events WHERE aggregate_id=$1 AND event_type='ORDER_PAYMENT_CONFIRMED'",
        [orderId],
      )
    ).rows[0];
  const webhook = async (signed) =>
    (
      await client.query(
        "SELECT webhook_inbox_id id FROM provider_events WHERE provider_account_id=$1 AND provider_event_id=$2",
        [
          context.endpoint.providerAccountId,
          JSON.parse(signed.rawBody).event_id,
        ],
      )
    ).rows[0];
  const propagation = () => ({
    schemaVersion: 1,
    requestId: randomUUID(),
    traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
  });
  const webhookJob = (id) => ({
    schemaVersion: 1,
    jobType: "PROCESS_WEBHOOK_INBOX",
    webhookInboxId: id,
    correlationId: randomUUID(),
    propagation: propagation(),
  });
  const outboxJob = (id) => ({
    schemaVersion: 1,
    jobType: "DISPATCH_OUTBOX_EVENT",
    outboxEventId: id,
    consumerKey: "order-notifications-v1",
    correlationId: randomUUID(),
    propagation: propagation(),
  });
  async function financeDetail(session, orderId) {
    return runtime.financeCommand(session, "detail", {
      schemaVersion: 1,
      orderId,
    });
  }
  async function createSources(manager) {
    await stopWorker();
    const paid = await createPaidAdminOrder(context, payment, {
      noMessage: true,
    });
    let order = await runtime.command(manager, "detail", {
      schemaVersion: 1,
      orderId: paid.orderId,
    });
    await runtime.command(
      manager,
      "prepare",
      {
        schemaVersion: 1,
        reasonCode: "LOCAL_ACCEPTANCE",
        orderId: paid.orderId,
        expectedOrderVersion: order.version,
        fulfillmentId: order.items[0].fulfillmentId,
        expectedFulfillmentVersion: order.items[0].fulfillmentVersion,
      },
      { key: randomUUID() },
    );
    const current = await financeDetail(manager, paid.orderId),
      item = current.items[0];
    const refund = await runtime.financeCommand(
      manager,
      "refund",
      {
        schemaVersion: 1,
        orderId: paid.orderId,
        expectedOrderVersion: current.order.version,
        amountMinor: Math.min(100, item.availableAmountMinor),
        currency: current.order.currency,
        allocations: [
          {
            orderItemId: item.orderItemId,
            amountMinor: Math.min(100, item.availableAmountMinor),
          },
        ],
        reasonCode: "CUSTOMER_REQUEST",
        confirmed: true,
      },
      { key: randomUUID() },
    );
    await context.psp.settleRefund({
      refundId: refund.refundId,
      status: "SUCCEEDED",
    });
    const signed = await context.signRefundWebhook(refund.refundId);
    check(
      (await context.sendWebhook(signed)).accepted,
      "signed refund is durably accepted before failed worker delivery",
    );
    const refundInbox = await webhook(signed),
      outbox = await source(paid.orderId);
    const notificationOrder = await createPaidAdminOrder(context, payment, {
      noMessage: true,
    });
    const requested = await automatic.request(
      (await source(notificationOrder.orderId)).id,
    );
    mailAvailable = false;
    check(
      (await automatic.deliver(requested.notificationId)).decision === "FAILED",
      "real notification lifecycle records definite unavailable transport failure",
    );
    mailAvailable = true;
    const uncertainOrder = await createPaidAdminOrder(context, payment, {
      noMessage: true,
    });
    const uncertain = await automatic.request(
      (await source(uncertainOrder.orderId)).id,
    );
    await gateway.dropNextResponse();
    check(
      (await automatic.deliver(uncertain.notificationId)).decision === "FAILED",
      "actual accepted but lost TLS mail response remains failed with unknown outcome",
    );
    const unknown = await payment.fresh({ lost: true });
    const action = await context.psp.hostedAction(unknown.attempt.id);
    await payment.settle({
      ...unknown,
      attempt: { ...unknown.attempt, action },
    });
    return {
      webhookTarget: { kind: "WEBHOOK", id: refundInbox.id, consumerKey: null },
      deadLetterTarget: {
        kind: "DEAD_LETTER",
        id: outbox.id,
        consumerKey: "order-notifications-v1",
      },
      paymentTarget: {
        kind: "PAYMENT",
        id: unknown.attempt.id,
        consumerKey: null,
      },
      notificationTarget: {
        kind: "NOTIFICATION",
        id: requested.notificationId,
        consumerKey: null,
      },
      blockedNotificationTarget: {
        kind: "NOTIFICATION",
        id: uncertain.notificationId,
        consumerKey: null,
      },
      paid,
      refund,
      unknown,
      notificationOrder,
      uncertainOrder,
    };
  }
  async function exhaustQueue(fixture) {
    const queueFacts = async () =>
      (
        await client.query(
          `SELECT name,state,
           count(*) FILTER(WHERE data->>'webhookInboxId'=$1::text OR data->>'outboxEventId'=$2::text)::int target_jobs,
           count(*) FILTER(WHERE coalesce(data->>'webhookInboxId'=$1::text OR data->>'outboxEventId'=$2::text,false)=false)::int other_jobs,
           max(retry_count)::int retries FROM pgboss.job WHERE
           name IN('payment-webhook-inbox-v1','outbox-dispatch-v1','payment-webhook-dead-letter-v1','outbox-dispatch-dead-letter-v1')
         GROUP BY name,state ORDER BY name,state`,
          [fixture.webhookTarget.id, fixture.deadLetterTarget.id],
        )
      ).rows;
    const failProcess = createProcessWebhookInbox({
      transactionManager: persistence.reliableEventTransactionManager,
      createId: randomUUID,
      now,
      handlerForEvent: () => undefined,
    });
    const failDispatch = createDispatchOutboxEvent({
      transactionManager: persistence.reliableEventTransactionManager,
      createId: randomUUID,
      now,
      consumerForKey: () => undefined,
    });
    const queue = createPgBossReliableEventQueue({
      schemaVersion: 1,
      connectionString: preflightEnvironment(context.database)
        .FAN_SUPPORT_DATABASE_URL,
      schema: "pgboss",
      managementMode: "VERIFY",
      localConcurrency: 4,
    });
    own("exception fault queue", () => queue.stop());
    await queue.start({
      processWebhookInbox: (job, delivery) =>
        job.webhookInboxId === fixture.webhookTarget.id
          ? failProcess(job, delivery)
          : process(job, delivery),
      dispatchOutboxEvent: (job, delivery) =>
        job.outboxEventId === fixture.deadLetterTarget.id &&
        job.consumerKey === fixture.deadLetterTarget.consumerKey
          ? failDispatch(job, delivery)
          : dispatch(job, delivery),
    });
    await queue.publishOutboxDispatch(outboxJob(fixture.deadLetterTarget.id));
    let lastFacts;
    let lastSnapshot = "";
    await waitForOrderPayment(
      "actual bounded queues retain dead letters after six failed deliveries",
      async () => {
        const row = (
          await client.query(
            `SELECT (SELECT count(*)::int FROM webhook_processing_attempts WHERE webhook_inbox_id=$1 AND outcome='DEAD_LETTER') webhook_dead,
            (SELECT count(*)::int FROM outbox_dispatch_attempts WHERE outbox_event_id=$2 AND consumer_key='order-notifications-v1' AND outcome='DEAD_LETTER') outbox_dead,
            (SELECT count(*)::int FROM pgboss.job WHERE name IN('payment-webhook-dead-letter-v1','outbox-dispatch-dead-letter-v1')) dead_jobs,
            (SELECT count(*)::int FROM pgboss.job WHERE state='failed' AND
             ((name='payment-webhook-inbox-v1' AND data->>'webhookInboxId'=$1::text) OR
              (name='outbox-dispatch-v1' AND data->>'outboxEventId'=$2::text AND data->>'consumerKey'='order-notifications-v1'))) failed_sources,
            (SELECT jsonb_agg(jsonb_build_object('queue',name,'state',state,'retries',retry_count,
              'ageSeconds',floor(extract(epoch FROM clock_timestamp()-created_on)),
              'dueInSeconds',ceil(extract(epoch FROM start_after-clock_timestamp()))))
             FROM pgboss.job WHERE name IN('payment-webhook-inbox-v1','outbox-dispatch-v1')
             AND(data->>'webhookInboxId'=$1::text OR data->>'outboxEventId'=$2::text)) source_timing,
            (SELECT jsonb_object_agg(outcome,total) FROM (SELECT outcome,count(*)::int total FROM webhook_processing_attempts WHERE webhook_inbox_id=$1 GROUP BY outcome) attempts) webhook_attempts,
            (SELECT jsonb_object_agg(outcome,total) FROM (SELECT outcome,count(*)::int total FROM outbox_dispatch_attempts WHERE outbox_event_id=$2 AND consumer_key='order-notifications-v1' GROUP BY outcome) attempts) outbox_attempts`,
            [fixture.webhookTarget.id, fixture.deadLetterTarget.id],
          )
        ).rows[0];
        lastFacts = row;
        const snapshot = JSON.stringify(await queueFacts());
        if (snapshot !== lastSnapshot) {
          lastSnapshot = snapshot;
          context.progress(`source queue states ${snapshot}`);
        }
        return (
          row.webhook_dead === 1 &&
          row.outbox_dead === 1 &&
          row.dead_jobs >= 2 &&
          row.failed_sources === 2
        );
      },
      (condition, label) => {
        if (!condition)
          context.progress(
            `source queue diagnostic ${JSON.stringify(lastFacts)}`,
          );
        check(condition, label);
      },
      { timeoutMs: 180000 },
    );
    context.progress(`source queues exhausted ${JSON.stringify(lastFacts)}`);
    await queue.stop();
  }
  const recover = async () => {
    await finance.adminFinanceRoute.useCases.recoverNext();
    await finance.adminFinanceRoute.useCases.runPending(100);
    await (await startWorker()).maintenance.runMaintenanceOnce();
  };
  async function facts() {
    const row = (
      await client.query(
        "SELECT (SELECT count(*)::int FROM payment_transactions WHERE transaction_type='REFUND') refunds,(SELECT count(*)::int FROM fulfillments) fulfillments,(SELECT count(*)::int FROM fulfillments WHERE status='DELIVERED') delivered,(SELECT count(*)::int FROM fulfillment_events) fulfillment_events,(SELECT count(*)::int FROM notification_deliveries) notifications,(SELECT count(*)::int FROM admin_notification_resends) resends,(SELECT count(*)::int FROM outbox_effect_receipts) outbox_effects,(SELECT count(*)::int FROM webhook_effects) webhook_effects",
      )
    ).rows[0];
    return {
      ...row,
      receiverAccepted: gateway.acceptedCount(),
      psp: await context.psp.counts(),
    };
  }
  return {
    ...runtime,
    call,
    detail,
    mutate,
    automatic,
    manual,
    gateway,
    createSources,
    exhaustQueue,
    recover,
    facts,
    process,
    dispatch,
    webhookJob,
    outboxJob,
    restartRecovery: stopWorker,
    armApiResponseLoss: (action) => {
      loseNextAction = action;
    },
    revokeAccess: () =>
      client.query(
        "DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=(SELECT id FROM permissions WHERE permission_key='exceptions.read')",
        [runtime.actors.manager.roleId],
      ),
    restoreAccess: () =>
      client.query(
        "INSERT INTO role_permissions(role_id,permission_id,granted_by) SELECT $1,id,$2 FROM permissions WHERE permission_key='exceptions.read' ON CONFLICT DO NOTHING",
        [runtime.actors.manager.roleId, runtime.actors.manager.id],
      ),
    authenticate: async (page, role, locale) => {
      observeSession(page);
      const release = await sessionClock.install(page);
      try {
        await runtime.authenticate(page, role, locale);
      } finally {
        await release();
      }
    },
    assertPrivacy: async () => {
      await runtime.assertPrivacy();
      check(
        payment.canaries.every(
          (value) => !context.logLines.some((line) => line.includes(value)),
        ),
        "shared worker logs exclude private order canaries",
      );
    },
  };
}
