import { createHash, randomUUID } from "node:crypto";
import { createOrderNotificationUseCases } from "@fan-support/application";
import { createOrderNotificationTemplates } from "../../../packages/i18n/dist/notifications/index.js";
import { createPersistentNotificationGatewayHarness } from "../../worker/scripts/notification-gateway-harness.mjs";
import {
  createOrderPaymentProtocolClient,
  waitForOrderPayment,
} from "./order-payment-client.mjs";
import { createOrderAccessProtocolClient } from "./order-access-client.mjs";
import { createAdminFinanceFixture } from "./admin-finance-fixture.mjs";
import { createPaidAdminOrder } from "./admin-orders-fixtures.mjs";

const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Actual finance evidence and protected reads; capabilities remain callback-local, never in the report. */
export async function verifySupportCertificateFinance(
  context,
  { payment, runtime, onStage = async () => {} } = {},
) {
  const { client, check, progress } = context;
  payment ??= createOrderPaymentProtocolClient(context);
  runtime ??= await createAdminFinanceFixture(context, payment);
  const manager = await runtime.login("manager");
  const artists = context.fixtures.artists.slice(0, 2);
  const gift = context.fixtures.gifts.find(
    (candidate) =>
      candidate.giftKind === "VIRTUAL" &&
      artists.every((artist) =>
        candidate.variants[0]?.eligible.includes(artist.id),
      ),
  );
  check(
    Boolean(gift),
    "certificate fixture has a virtual gift eligible for both recipients",
  );
  const value = await createPaidAdminOrder(context, payment, {
    noMessage: true,
    fulfillmentStatus: "DELIVERED",
    lines: artists.map((artist) => ({ gift, artist })),
  });
  const detail = () => runtime.detail(manager, value.orderId);
  const initialFinance = await detail();
  check(
    initialFinance.items.length === 2 &&
      initialFinance.items.every((item) => item.amountMinor > 1),
    "certificate finance uses two distinct purchased lines with refundable amounts",
  );
  const [lineA, lineB] = initialFinance.items;
  const access = createOrderAccessProtocolClient({
    ...context,
    canaries: payment.canaries,
  });
  const granted = await access.bootstrap(value);
  const fulfillment = async () =>
    (
      await client.query(
        "SELECT f.id,f.order_item_id,f.status,f.delivered_at::text delivered_at,f.version,i.gift_kind FROM fulfillments f JOIN order_items i ON i.id=f.order_item_id WHERE f.order_id=$1 ORDER BY i.created_at,i.id",
        [value.orderId],
      )
    ).rows;
  const originalFulfillment = await fulfillment();
  check(
    originalFulfillment.length === 2 &&
      originalFulfillment.every(
        (line) =>
          line.gift_kind === "VIRTUAL" &&
          line.status === "DELIVERED" &&
          line.delivered_at,
      ),
    "both purchased virtual lines were actually delivered by the payment application",
  );
  const originalSnapshot = await payment.immutableSnapshot(value);
  const gateway = await createPersistentNotificationGatewayHarness({ context });
  const notifications = createOrderNotificationUseCases({
    transactions: context.persistence.notificationTransactionManager,
    keyManagement: context.kms.adapter,
    templates: createOrderNotificationTemplates({ mode: "TEST_DRAFT" }),
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
      maxAttempts: 6,
    },
    transportForKey: (key) =>
      key === gateway.transportKey ? gateway.transport : undefined,
  });
  const source = (
    await client.query(
      "SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type='ORDER_PAYMENT_CONFIRMED'",
      [value.orderId],
    )
  ).rows[0];
  const notification = await notifications.request(source.id);
  check(
    (await notifications.deliver(notification.notificationId)).decision ===
      "SENT",
    "certificate order has an actual original payment email accepted by the TLS receiver",
  );
  await gateway.inspect();
  check(
    gateway.acceptedCount() === 1,
    "certificate fixture begins with one actual accepted payment notification",
  );
  const worker = await context.createOrderWorker();
  const stages = [];

  async function effects() {
    const result = {};
    for (const [table, condition] of [
      [
        "payment_transactions",
        "payment_attempt_id IN (SELECT id FROM payment_attempts WHERE order_id=$1)",
      ],
      ["fulfillments", "order_id=$1"],
      ["fulfillment_events", "order_id=$1"],
      ["notification_deliveries", "order_id=$1"],
      ["admin_notification_resends", "order_id=$1"],
      [
        "notification_submissions",
        "automatic_notification_id IN (SELECT id FROM notification_deliveries WHERE order_id=$1) OR admin_resend_id IN (SELECT id FROM admin_notification_resends WHERE order_id=$1)",
      ],
    ]) {
      const { rows } = await client.query(
        `SELECT to_jsonb(record) value FROM public.${table} record WHERE ${condition} ORDER BY to_jsonb(record)::text COLLATE "C"`,
        [value.orderId],
      );
      result[table] = { count: rows.length, sha256: digest(rows) };
    }
    await gateway.inspect();
    return { ...result, acceptedEmails: gateway.acceptedCount() };
  }
  async function replay(signed) {
    const before = await effects();
    check(
      (await context.sendWebhook(signed)).accepted,
      "exact original signed finance webhook can be replayed",
    );
    await worker.maintenance();
    check(
      digest(await effects()) === digest(before),
      "finance webhook replay adds no economic transaction, fulfillment or notification side effect",
    );
  }
  async function stage(name, paymentStatus, disputeStatus, revokedPositions) {
    progress(`certificate finance ${name}`);
    const expected = { paymentStatus, disputeStatus, revokedPositions };
    const read = await access.read(
      granted.session,
      value.checkout.publicOrderId,
    );
    const order = read.data.order;
    check(
      order.paymentStatus === paymentStatus &&
        order.disputeStatus === disputeStatus &&
        order.fulfillmentStatus === "DELIVERED" &&
        order.items.length === 2 &&
        order.items.every(
          (item) =>
            item.giftKind === "VIRTUAL" &&
            item.fulfillmentStatus === "DELIVERED" &&
            item.supportCertificate?.revoked ===
              revokedPositions.includes(item.position),
        ),
      `${name}: actual protected order read has exact per-line certificate withdrawal`,
    );
    check(
      (await runtime.readFacts(value.orderId)).attemptStatus === "SUCCEEDED" &&
        digest(await fulfillment()) === digest(originalFulfillment) &&
        (await payment.immutableSnapshot(value)) === originalSnapshot,
      `${name}: finance preserves original capture, delivered timestamps and immutable purchase snapshots`,
    );
    const admin = await runtime.command(manager, "detail", {
      schemaVersion: 1,
      orderId: value.orderId,
    });
    check(
      admin.items.every((item) => item.allowedActions.length === 0),
      `${name}: delivered digital lines expose no manual fulfillment action`,
    );
    if (name === "PAID") {
      check(
        admin.notification.status === "SENT" &&
          admin.notification.canResend &&
          admin.notification.latestNotificationId ===
            notification.notificationId,
        "paid certificate notification is genuinely resendable before the financial restriction",
      );
    } else {
      check(
        admin.notification.status === "NONE" && !admin.notification.canResend,
        `${name}: current financial state suppresses operator notification resend`,
      );
      const before = await effects();
      const rejected = await runtime.command(
        manager,
        "notification/resend",
        {
          schemaVersion: 1,
          orderId: value.orderId,
          expectedOrderVersion: admin.version,
          expectedLatestNotificationId: notification.notificationId,
          reasonCode: "FAN_REQUESTED_UPDATE",
        },
        { key: randomUUID(), status: 409 },
      );
      check(
        rejected.code === "STALE_VERSION",
        `${name}: financial gate rejects a new-key resend of the former payment source`,
      );
      check(
        digest(await effects()) === digest(before),
        `${name}: refused resend changes no delivery history or receiver receipt`,
      );
    }
    check(
      (await effects()).acceptedEmails === 1,
      `${name}: financial evidence does not emit another payment or studio-delivery email`,
    );
    await onStage({
      stage: name,
      publicOrderId: value.checkout.publicOrderId,
      checkoutId: value.checkout.id,
      checkoutSession: value.session,
      accessSession: granted.session,
      canaries: payment.canaries,
      order,
      expected,
    });
    stages.push({ stage: name, ...expected, status: "PASS" });
  }
  async function refund(amountMinor) {
    const current = await detail();
    const result = await runtime.mutation(manager, "refund", {
      orderId: value.orderId,
      expectedOrderVersion: current.order.version,
      amountMinor,
      currency: current.order.currency,
      allocations: [{ orderItemId: lineA.orderItemId, amountMinor }],
    });
    await context.psp.settleRefund({
      refundId: result.refundId,
      status: "SUCCEEDED",
    });
    const signed = await context.signRefundWebhook(result.refundId);
    check(
      (await context.sendWebhook(signed)).accepted,
      "original signed line refund enters actual webhook inbox",
    );
    await waitForOrderPayment(
      "certificate refund reaches SUCCEEDED through actual Worker",
      async () => {
        await worker.maintenance();
        return (await detail()).refunds.some(
          (item) =>
            item.refundId === result.refundId && item.status === "SUCCEEDED",
        );
      },
      check,
    );
    await replay(signed);
  }
  try {
    await stage("PAID", "PAID", "NONE", []);
    const partial = Math.floor(lineA.amountMinor / 2);
    await refund(partial);
    await stage("PARTIAL_REFUND", "PARTIALLY_REFUNDED", "NONE", []);
    await refund(lineA.amountMinor - partial);
    await stage("FULL_LINE_REFUND", "PARTIALLY_REFUNDED", "NONE", [
      lineA.position,
    ]);
    const refunded = await detail();
    check(
      refunded.order.refundedAmountMinor === lineA.amountMinor &&
        refunded.items.find((item) => item.orderItemId === lineB.orderItemId)
          ?.occupiedAmountMinor === 0,
      "cumulative refunds cover only line A and never allocate money to line B",
    );
    const disputeId = randomUUID();
    for (const status of ["OPEN", "LOST"]) {
      await context.psp.settleDispute({
        attemptId: value.attempt.id,
        disputeId,
        status,
        amountMinor: initialFinance.order.capturedAmountMinor,
      });
      const signed = await context.signDisputeWebhook(disputeId);
      check(
        (await context.sendWebhook(signed)).accepted,
        "original signed dispute enters actual webhook inbox",
      );
      await waitForOrderPayment(
        `certificate dispute ${status} reaches order through actual Worker`,
        async () => {
          await worker.maintenance();
          return (await detail()).order.disputeStatus === status;
        },
        check,
      );
      await replay(signed);
      await stage(
        `DISPUTE_${status}`,
        "PARTIALLY_REFUNDED",
        status,
        status === "LOST" ? [lineA.position, lineB.position] : [lineA.position],
      );
      const current = await detail(),
        before = await context.psp.counts();
      const blocked = await runtime.mutation(
        manager,
        "refund",
        {
          orderId: value.orderId,
          expectedOrderVersion: current.order.version,
          currency: current.order.currency,
          amountMinor: 1,
          allocations: [{ orderItemId: lineB.orderItemId, amountMinor: 1 }],
        },
        { status: 409 },
      );
      const after = await context.psp.counts();
      check(
        blocked.code === "DISPUTE_REQUIRES_REVIEW" &&
          before.refunds === after.refunds &&
          before.refundCalls === after.refundCalls,
        `${status}: existing financial guard prevents an additional outgoing refund`,
      );
    }
    await runtime.assertPrivacy();
    check(
      payment.canaries.every(
        (secret) => !context.logLines.some((entry) => entry.includes(secret)),
      ),
      "certificate finance API and Worker logs exclude capabilities and personal values",
    );
    return {
      schemaVersion: 1,
      status: "PASS",
      stages,
      actualPostgres: true,
      actualSignedTestPsp: true,
      actualTlsReceiver: true,
      actualProtectedOrderRead: true,
      refunds: 2,
      replayedFinanceWebhooks: 4,
      fulfillmentPreserved: true,
      originalCapturePreserved: true,
      scope:
        "Local synthetic orders and TEST TLS PSP/mail only; browser evidence is recorded by the caller",
    };
  } finally {
    await worker.stop();
    await gateway.close();
  }
}
