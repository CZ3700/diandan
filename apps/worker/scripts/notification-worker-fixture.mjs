import { verifyNotificationLinkBrowser } from "./notification-link-browser.mjs";
import { preflightEnvironment } from "../../api/scripts/publication-preflight-http-fixtures.mjs";
import { randomUUID } from "node:crypto";
import { createOrderNotificationUseCases } from "@fan-support/application";
import { createOrderNotificationTemplates } from "@fan-support/i18n/notifications";
import { createPgBossReliableEventQueue } from "@fan-support/persistence-postgres";
import { createWorkerReliableEventsComposition } from "../dist/reliable-events-composition.js";
import { createReliableEventsWorkerRuntime } from "../dist/reliable-events-runtime.js";
import { createPersistentNotificationGatewayHarness } from "./notification-gateway-harness.mjs";
import {
  createOrderPaymentProtocolClient,
  waitForOrderPayment,
} from "../../api/scripts/order-payment-client.mjs";

/** Explicit TEST-only composition: normal pg-boss consumers and repositories, with local TLS mail. */
export async function verifyNotificationWorker(context) {
  const { client, check } = context;
  const gateway = await createPersistentNotificationGatewayHarness({ context });
  const payment = createOrderPaymentProtocolClient(context);
  const value = await payment.fresh({ locale: "vi" });
  await payment.settle(value);
  const signed = await context.signWebhook(value.attempt.id);
  check(
    (await context.sendWebhook(signed)).accepted,
    "Worker fixture receives an actual signed payment capture",
  );
  const event = (
    await client.query(
      "SELECT id FROM provider_events WHERE provider_account_id=$1 AND provider_event_id=$2",
      [context.endpoint.providerAccountId, JSON.parse(signed.rawBody).event_id],
    )
  ).rows[0];
  await payment.apply(event.id);
  const state = await payment.assertPaid(value);
  let queue;
  let emailCommand;
  const composition = createWorkerReliableEventsComposition(
    preflightEnvironment(context.database),
    {
      factories: {
        createQueue(configuration) {
          queue = createPgBossReliableEventQueue(configuration);
          return queue;
        },
        createRuntime(configuration) {
          return createReliableEventsWorkerRuntime({
            ...configuration,
            schedule: () => ({ cancel() {} }),
          });
        },
        prepareNotifications() {
          return ({ notificationTransactionManager }) =>
            createOrderNotificationUseCases({
              transactions: notificationTransactionManager,
              keyManagement: context.kms.adapter,
              templates: createOrderNotificationTemplates({
                mode: "TEST_DRAFT",
              }),
              transportForKey: (key) =>
                key === gateway.transportKey
                  ? {
                      sendEmail: async (command) => {
                        emailCommand = command;
                        return gateway.transport.sendEmail(command);
                      },
                    }
                  : undefined,
              configuration: {
                schemaVersion: 1,
                siteName: "TEST Support",
                publicStorefrontOrigin: context.origin,
                transportKey: gateway.transportKey,
                linkPepperVersion: "test-mac",
                linkTtlSeconds: 3600,
                idempotencyRetentionSeconds: 60,
                leaseSeconds: 30,
                retryDelaySeconds: 1,
                maxAttempts: 6,
              },
            });
        },
      },
    },
  );
  context.own("notification TEST Worker", () => composition.stop());
  const publish = async (source) =>
    queue.publishOutboxDispatch({
      schemaVersion: 1,
      jobType: "DISPATCH_OUTBOX_EVENT",
      outboxEventId: source.id,
      consumerKey: "order-notifications-v1",
      correlationId: source.correlation_id,
      propagation: {
        schemaVersion: 1,
        requestId: randomUUID(),
        traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
      },
    });
  try {
    await composition.start();
    const source = (
      await client.query(
        "SELECT id,correlation_id FROM outbox_events WHERE aggregate_id=$1 AND event_type='ORDER_PAYMENT_CONFIRMED'",
        [state.order_id],
      )
    ).rows[0];
    await publish(source);
    const notification = await waitForOrderPayment(
      "real pg-boss Worker materializes payment notification",
      async () =>
        (
          await client.query(
            "SELECT id,status FROM notification_deliveries WHERE order_id=$1",
            [state.order_id],
          )
        ).rows[0],
      check,
    );
    const requested = (
      await client.query(
        "SELECT id,correlation_id FROM outbox_events WHERE aggregate_id=$1 AND event_type='NOTIFICATION_REQUESTED'",
        [notification.id],
      )
    ).rows[0];
    await publish(requested);
    await waitForOrderPayment(
      "real Worker dispatches notification through TLS and records acceptance",
      async () =>
        (
          await client.query(
            "SELECT status='SENT' ready FROM notification_deliveries WHERE id=$1",
            [notification.id],
          )
        ).rows[0]?.ready,
      check,
    );
    await waitForOrderPayment(
      "both durable outbox consumer effects complete",
      async () =>
        (
          await client.query(
            "SELECT count(*)::int count FROM outbox_effect_receipts WHERE outbox_event_id=ANY($1::uuid[]) AND consumer_key='order-notifications-v1'",
            [[source.id, requested.id]],
          )
        ).rows[0]?.count === 2,
      check,
    );
    await publish(source);
    await publish(requested);
    await gateway.inspect();
    check(
      gateway.acceptedCount() === 1,
      "duplicate queued notification has exactly one durable TLS acceptance",
    );
    const persisted = (
      await client.query(
        "SELECT requested_locale,resolved_locale,attempt_count FROM notification_deliveries WHERE id=$1",
        [notification.id],
      )
    ).rows[0];
    check(
      persisted.requested_locale === "vi" &&
        persisted.resolved_locale === "vi" &&
        persisted.attempt_count === 1,
      "Worker uses order locale with one persisted delivery attempt",
    );
    check(
      Boolean(emailCommand),
      "actual Worker sent a captured transient email command",
    );
    const browser = await verifyNotificationLinkBrowser({
      context: { ...context, canaries: payment.canaries },
      emailCommand,
    });
    return {
      browser,
      schemaVersion: 1,
      status: "PASS",
      actualWorkerComposition: true,
      actualPgBoss: true,
      actualPostgres: true,
      actualTls: true,
      consumerEffects: 2,
      mailAccepted: 1,
      scope:
        "Local TEST gateway acceptance; no real email or production approval",
    };
  } finally {
    await composition.stop();
    await gateway.close();
  }
}
