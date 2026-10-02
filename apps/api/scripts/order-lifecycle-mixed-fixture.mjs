import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  createAdminOrderResendUseCases,
  createOrderNotificationUseCases,
} from "@fan-support/application";
import { createOrderNotificationTemplates } from "../../../packages/i18n/dist/notifications/index.js";
import { createPersistentNotificationGatewayHarness } from "../../worker/scripts/notification-gateway-harness.mjs";
import { createOrderPaymentProtocolClient } from "./order-payment-client.mjs";
import { createOrderAccessProtocolClient } from "./order-access-client.mjs";
import { createAdminOrdersRuntime } from "./admin-orders-runtime.mjs";
import { createPaidAdminOrder } from "./admin-orders-fixtures.mjs";

const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** One real mixed purchase; callbacks alone receive the protected fan session. */
export async function verifyMixedFulfillmentLifecycle(
  context,
  { payment, runtime, onStage = async () => {} } = {},
) {
  const { client, check, progress, persistence, fixtures } = context;
  payment ??= createOrderPaymentProtocolClient(context);
  runtime ??= await createAdminOrdersRuntime(context);
  const manager = await runtime.login("manager");
  const artist = fixtures.artists[0];
  const lines = ["VIRTUAL", "MERCHANDISE"].map((giftKind) => {
    const gift = fixtures.gifts.find(
      (candidate) =>
        candidate.giftKind === giftKind &&
        candidate.variants[0]?.policy === "PROCURE_ON_DEMAND" &&
        candidate.variants[0].eligible.includes(artist.id),
    );
    check(Boolean(gift), `mixed fixture has an eligible ${giftKind} gift`);
    return { gift, artist };
  });
  const value = await createPaidAdminOrder(context, payment, {
    lines,
    noMessage: true,
    fulfillmentStatus: "PREPARING",
  });
  const access = createOrderAccessProtocolClient({
    ...context,
    canaries: payment.canaries,
  });
  const granted = await access.bootstrap(value);
  const detail = () =>
    runtime.command(manager, "detail", {
      schemaVersion: 1,
      orderId: value.orderId,
    });
  const scalar = async (sql, parameters = [value.orderId]) =>
    (await client.query(sql, parameters)).rows[0];
  const fulfillmentRows = async () =>
    (
      await client.query(
        "SELECT i.gift_kind,to_jsonb(f) fulfillment FROM order_items i JOIN fulfillments f ON f.order_item_id=i.id AND f.order_id=i.order_id WHERE i.order_id=$1 ORDER BY i.gift_kind",
        [value.orderId],
      )
    ).rows;
  async function inventorySnapshot() {
    const rows = {};
    const inventory =
      "SELECT inventory.id FROM inventory_items inventory JOIN order_items item ON item.gift_variant_id=inventory.gift_variant_id WHERE item.order_id=$1";
    for (const table of [
      "inventory_balances",
      "inventory_reservations",
      "inventory_ledger",
    ])
      rows[table] = (
        await client.query(
          `SELECT to_jsonb(record) value FROM ${table} record WHERE inventory_item_id IN (${inventory}) ORDER BY to_jsonb(record)::text COLLATE "C"`,
          [value.orderId],
        )
      ).rows;
    return digest(rows);
  }
  const originalSnapshot = await payment.immutableSnapshot(value);
  const originalInventory = await inventorySnapshot();
  const originalDigital = (await fulfillmentRows()).find(
    (line) => line.gift_kind === "VIRTUAL",
  );
  check(
    originalDigital?.fulfillment.status === "DELIVERED" &&
      originalDigital.fulfillment.delivered_at,
    "mixed virtual line is genuinely delivered at payment",
  );
  const gateway = await createPersistentNotificationGatewayHarness({ context });
  const captures = new Map();
  const shared = {
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
      key === gateway.transportKey
        ? {
            async sendEmail(command) {
              captures.set(command.notification.id, command);
              const link = /#token=([A-Za-z0-9_-]{43})&order=/u.exec(
                command.content.text,
              );
              if (link) {
                payment.canaries.push(link[1]);
                runtime.registerSecret(link[1]);
              }
              return gateway.transport.sendEmail(command);
            },
          }
        : undefined,
  };
  const automatic = createOrderNotificationUseCases({
    ...shared,
    transactions: persistence.notificationTransactionManager,
  });
  const manual = createAdminOrderResendUseCases({
    ...shared,
    transactions: persistence.adminOrderResendNotificationTransactionManager,
  });
  const stages = [];
  let accepted = 0;

  async function send(sourceId, eventType) {
    const authority = await scalar(
      "SELECT order_id,event_type FROM public.notification_source_authority($1)",
      [sourceId],
    );
    check(
      authority?.order_id === value.orderId &&
        authority.event_type === eventType,
      `${eventType}: notification has the actual payment or ADMIN authority`,
    );
    const result = await automatic.request(sourceId);
    check(
      result.decision === "CREATED" &&
        (await automatic.deliver(result.notificationId)).decision === "SENT",
      `${eventType}: automatic email is accepted by the actual TLS receiver`,
    );
    accepted++;
    check(
      gateway.acceptedCount() === accepted &&
        captures.get(result.notificationId)?.notification.eventType ===
          eventType,
      `${eventType}: exactly one message carries the correct stage`,
    );
    return result.notificationId;
  }
  async function advance(action, status) {
    const current = await detail();
    const merchandise = current.items.filter(
      (item) => item.giftKind === "MERCHANDISE",
    );
    check(
      merchandise.length === 1 &&
        merchandise[0].allowedActions.includes(action),
      `${action}: manager can transition the actual merchandise line`,
    );
    const line = merchandise[0];
    const result = await runtime.command(
      manager,
      action.toLowerCase(),
      {
        schemaVersion: 1,
        orderId: value.orderId,
        expectedOrderVersion: current.version,
        fulfillmentId: line.fulfillmentId,
        expectedFulfillmentVersion: line.fulfillmentVersion,
        reasonCode: "LOCAL_LIFECYCLE_ACCEPTANCE",
        ...(action === "HOLD" || action === "RESUME"
          ? { confirmed: true }
          : {}),
      },
      { key: randomUUID() },
    );
    const source = await scalar(
      `SELECT x.id FROM admin_order_fulfillment_receipts r
       JOIN admin_order_operation_receipts c ON c.result_id=r.id AND c.audit_log_id=r.audit_log_id AND c.actor_id=r.actor_id
       JOIN fulfillment_events e ON e.id=r.fulfillment_event_id AND e.audit_log_id=r.audit_log_id AND e.admin_identity_id=r.actor_id
       JOIN audit_logs a ON a.id=r.audit_log_id AND a.actor_id=r.actor_id
       JOIN outbox_events x ON x.id=r.outbox_event_id AND x.request_id=c.request_id
       WHERE r.id=$1 AND r.order_id=$2 AND r.action=$3 AND r.actor_id=$4
         AND e.authority_kind='ADMIN' AND e.to_status=$5
         AND a.action='FULFILLMENT_STATUS_CHANGED' AND a.outcome='SUCCEEDED'
         AND x.event_type='FULFILLMENT_STATUS_CHANGED' AND x.payload_status=$5`,
      [
        result.resultId,
        value.orderId,
        action,
        runtime.actors.manager.id,
        status,
      ],
    );
    check(
      result.outcome === "SUCCESS" && Boolean(source),
      `${action}: real HTTP mutation has matching authority, audit and source receipts`,
    );
    return source.id;
  }
  async function resend(sourceId, status = 200) {
    const current = await detail();
    return runtime.command(
      manager,
      "notification/resend",
      {
        schemaVersion: 1,
        orderId: value.orderId,
        expectedOrderVersion: current.version,
        expectedLatestNotificationId: sourceId,
        reasonCode: "FAN_REQUESTED_UPDATE",
      },
      { key: randomUUID(), status },
    );
  }
  async function stage(name, studioStatus, eventType, canResend) {
    progress(`mixed lifecycle ${name}`);
    const read = await access.read(
      granted.session,
      value.checkout.publicOrderId,
    );
    const order = read.data.order;
    const digital = order.items.filter((item) => item.giftKind === "VIRTUAL");
    const merchandise = order.items.filter(
      (item) => item.giftKind === "MERCHANDISE",
    );
    const aggregate = ["ON_HOLD", "DELIVERED"].includes(studioStatus)
      ? studioStatus
      : "PREPARING";
    check(
      order.paymentStatus === "PAID" &&
        order.disputeStatus === "NONE" &&
        order.fulfillmentStatus === aggregate &&
        order.items.length === 2 &&
        digital.length === 1 &&
        digital[0].fulfillmentStatus === "DELIVERED" &&
        digital[0].supportCertificate?.revoked === false &&
        merchandise.length === 1 &&
        merchandise[0].fulfillmentStatus === studioStatus &&
        merchandise[0].supportCertificate === null,
      `${name}: actual protected fan read keeps independent digital and merchandise outcomes`,
    );
    const state = await payment.state(value);
    check(
      state.attempt_status === "SUCCEEDED" &&
        state.captures === 1 &&
        state.confirmations === 1 &&
        state.reservations === 0 &&
        (await payment.immutableSnapshot(value)) === originalSnapshot &&
        (await inventorySnapshot()) === originalInventory &&
        digest(
          (await fulfillmentRows()).find(
            (line) => line.gift_kind === "VIRTUAL",
          ),
        ) === digest(originalDigital),
      `${name}: fulfillment preserves original payment, purchase, inventory and digital delivery timestamp`,
    );
    const admin = await detail();
    check(
      admin.items.find((item) => item.giftKind === "VIRTUAL")?.allowedActions
        .length === 0 &&
        admin.notification.eventType === eventType &&
        (canResend === undefined || admin.notification.canResend === canResend),
      `${name}: admin notification qualification follows the authoritative current stage`,
    );
    payment.canaries.forEach(runtime.registerSecret);
    await onStage({
      scenario: "MIXED",
      stage: name,
      publicOrderId: value.checkout.publicOrderId,
      accessSession: granted.session,
      order,
      canaries: payment.canaries,
    });
    stages.push({
      stage: name,
      fulfillmentStatus: aggregate,
      merchandiseStatus: studioStatus,
      certificateRevoked: false,
      notificationEvent: admin.notification.eventType,
      canResend: admin.notification.canResend,
      status: "PASS",
    });
  }

  try {
    progress("mixed lifecycle actual digital and merchandise payment");
    const paymentSource = await scalar(
      "SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type='ORDER_PAYMENT_CONFIRMED'",
    );
    await send(paymentSource.id, "PAYMENT_CONFIRMED");
    const digitalSource = await scalar(
      "SELECT x.id FROM outbox_events x JOIN fulfillments f ON f.id=x.aggregate_id JOIN order_items i ON i.id=f.order_item_id WHERE f.order_id=$1 AND i.gift_kind='VIRTUAL' AND x.event_type='FULFILLMENT_STATUS_CHANGED' AND x.payload_status='DELIVERED'",
    );
    check(
      Boolean(digitalSource) &&
        (await automatic.request(digitalSource.id)).decision === "IGNORED",
      "digital system delivery never creates a studio delivery email",
    );
    await stage("PAYMENT_CONFIRMED", "PENDING", "PAYMENT_CONFIRMED", true);

    const preparingSource = await advance("PREPARE", "PREPARING");
    const preparingId = await send(preparingSource, "PREPARING");
    await stage("PREPARING", "PREPARING", "PREPARING", true);
    const queued = await resend(preparingId);
    check(
      queued.outcome === "SUCCESS" && !queued.replayed,
      "real authorized HTTP queues one preparation resend before hold",
    );
    const holdSource = await advance("HOLD", "ON_HOLD");
    check(
      (await automatic.request(holdSource)).decision === "IGNORED",
      "hold has no automatic preparation or delivery notification",
    );
    const held = await detail();
    check(
      held.notification.status === "NONE" &&
        held.notification.latestNotificationId === null &&
        !held.notification.canResend,
      "held mixed order has no current resendable notification",
    );
    check(
      (await resend(preparingId, 409)).code === "STALE_VERSION" &&
        (await manual.deliver(queued.resultId)).decision === "SKIP",
      "hold rejects a new resend and cancels the previously queued dispatch",
    );
    const canceled = await scalar(
      "SELECT status,link_token_id,(SELECT count(*)::int FROM admin_notification_resends WHERE order_id=$2) count FROM admin_notification_resends WHERE id=$1",
      [queued.resultId, value.orderId],
    );
    await gateway.inspect();
    check(
      canceled.status === "CANCELED" &&
        canceled.link_token_id === null &&
        canceled.count === 1 &&
        gateway.acceptedCount() === accepted,
      "hold creates neither an extra request nor a mail or access link",
    );
    await stage("ON_HOLD", "ON_HOLD", null, false);

    const resumeSource = await advance("RESUME", "PREPARING");
    const resumed = await automatic.request(resumeSource);
    check(
      resumed.notificationId === preparingId &&
        (await automatic.deliver(preparingId)).decision === "SKIP",
      "resume reuses the sent preparation notification without duplicate dispatch",
    );
    await gateway.inspect();
    check(
      gateway.acceptedCount() === accepted,
      "resume preserves the actual accepted email count",
    );
    await stage("RESUMED", "PREPARING", "PREPARING");

    const deliveredId = await send(
      await advance("DELIVER", "DELIVERED"),
      "DELIVERED",
    );
    // Cancellation still consumes the existing real 60-second request limit.
    const cooldown = await scalar(
      "SELECT greatest(0,ceil(extract(epoch FROM (max(created_at)+interval '60 seconds'-clock_timestamp()))*1000))::int wait_ms FROM admin_notification_resends WHERE order_id=$1",
    );
    check(cooldown.wait_ms <= 60000, "resend cooldown is finite and unchanged");
    if (cooldown.wait_ms > 0) {
      progress("mixed lifecycle honors the remaining real resend cooldown");
      await delay(cooldown.wait_ms + 25);
    }
    await stage("DELIVERED", "DELIVERED", "DELIVERED", true);
    const final = await resend(deliveredId);
    check(
      final.outcome === "SUCCESS" &&
        (await manual.deliver(final.resultId)).decision === "SENT",
      "final delivered-stage resend reaches the real TLS receiver",
    );
    accepted++;
    const message = captures.get(final.resultId);
    const link = /#token=([A-Za-z0-9_-]{43})&order=([a-f0-9-]{36})/u.exec(
      message?.content.text ?? "",
    );
    check(
      gateway.acceptedCount() === accepted &&
        message?.notification.eventType === "DELIVERED" &&
        link?.[2] === value.checkout.publicOrderId,
      "final resend carries the exact delivered order and one fragment-only capability",
    );
    const exchanged = await access.exchange(link[1]);
    const finalRead = await access.read(exchanged.session, link[2]);
    check(
      finalRead.data.order.fulfillmentStatus === "DELIVERED" &&
        finalRead.data.order.items.every(
          (item) => item.fulfillmentStatus === "DELIVERED",
        ) &&
        finalRead.data.order.items.find((item) => item.giftKind === "VIRTUAL")
          ?.supportCertificate?.revoked === false &&
        (await manual.deliver(final.resultId)).decision === "SKIP",
      "actual final email link reads both delivered lines and the valid digital certificate without duplicate dispatch",
    );
    await gateway.inspect();
    const finalNotifications = (
      await client.query(
        "SELECT event_type,status FROM notification_deliveries WHERE order_id=$1 ORDER BY event_type",
        [value.orderId],
      )
    ).rows;
    check(
      digest(finalNotifications) ===
        digest([
          { event_type: "DELIVERED", status: "SENT" },
          { event_type: "PAYMENT_CONFIRMED", status: "SENT" },
          { event_type: "PREPARING", status: "SENT" },
        ]) && gateway.acceptedCount() === 4,
      "mixed lifecycle leaves exactly three sent automatic stages and one sent manual message",
    );
    const finalResends = (
      await client.query(
        "SELECT status FROM admin_notification_resends WHERE order_id=$1 ORDER BY status",
        [value.orderId],
      )
    ).rows;
    check(
      digest(finalResends) ===
        digest([{ status: "CANCELED" }, { status: "SENT" }]),
      "mixed lifecycle leaves no pending resend for the later shared notification flush",
    );
    check(
      payment.canaries.every((secret) =>
        context.logLines.every((line) => !line.includes(secret)),
      ),
      "mixed lifecycle API logs exclude private capabilities and contact canaries",
    );
    return {
      schemaVersion: 1,
      scenario: "MIXED",
      status: "PASS",
      stages,
      automaticEmails: 3,
      manualEmails: 1,
      canceledResends: 1,
      inventoryUnchanged: true,
      digitalCertificateValid: true,
      actualMailLinkExchanged: true,
    };
  } finally {
    await gateway.close();
  }
}
