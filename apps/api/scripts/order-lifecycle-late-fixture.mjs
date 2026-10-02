import { createHash, randomUUID } from "node:crypto";
import { createOrderNotificationUseCases } from "@fan-support/application";
import { createOrderNotificationTemplates } from "../../../packages/i18n/dist/notifications/index.js";
import { expireOrderPaymentReservations } from "../../../packages/persistence-postgres/scripts/order-payment-expiry-fixture.mjs";
import { createPersistentNotificationGatewayHarness } from "../../worker/scripts/notification-gateway-harness.mjs";
import { createOrderPaymentProtocolClient } from "./order-payment-client.mjs";
import { createOrderAccessProtocolClient } from "./order-access-client.mjs";
import { createAdminOrdersRuntime } from "./admin-orders-runtime.mjs";

const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** A real expired reservation and authenticated late capture stay paid and held. */
export async function verifyLatePaymentLifecycle(
  context,
  { payment, runtime, onStage = async () => {} } = {},
) {
  const { client, check, progress } = context;
  payment ??= createOrderPaymentProtocolClient(context);
  runtime ??= await createAdminOrdersRuntime(context);
  payment.canaries.forEach(runtime.registerSecret);
  const manager = await runtime.login("manager");
  const gift = context.fixtures.gifts.find(
    (candidate) =>
      candidate.giftKind === "PHYSICAL" &&
      candidate.variants[0]?.policy === "TRACKED" &&
      candidate.variants[0].quantity > 0 &&
      candidate.variants[0].eligible.includes(context.fixtures.artists[0].id),
  );
  check(Boolean(gift), "late capture fixture has a purchasable tracked gift");
  const short = await context.createCheckoutApi(8000);
  let gateway;
  try {
    progress("late payment waits for actual reservation expiry");
    const originalAdd = payment.checkout.add;
    payment.checkout.add = async (session, line) => {
      const added = await originalAdd(session, line);
      const item = session.cart.items.find(
        (entry) => entry.id === added.cartItemId,
      );
      // Remove private content normally so RESUME tests the inventory hold, not moderation.
      await payment.checkout.request(
        "LATE_ANONYMOUS_CART",
        `/api/v1/cart/items/${item.id}`,
        {
          target: context.base,
          method: "PATCH",
          cart: true,
          session,
          key: randomUUID(),
          body: {
            schemaVersion: 1,
            expectedCartVersion: session.cart.version,
            expectedItemVersion: item.version,
            presentationLocale: session.cart.presentationLocale,
            change: {
              kind: "PERSONALIZATION",
              displayMode: "anonymous",
              fanMessageLocale: "und",
            },
          },
        },
      );
      return added;
    };
    let late;
    try {
      late = await payment.fresh({
        checkoutBase: short.base,
        lost: true,
        lines: [{ gift }],
      });
    } finally {
      payment.checkout.add = originalAdd;
    }
    const pending = await payment.state(late);
    const action = await context.psp.hostedAction(late.attempt.id);
    check(
      pending.attempt_status === "UNKNOWN" &&
        pending.active === 1 &&
        action?.type === "REDIRECT",
      "lost TEST PSP response leaves its genuine action and one active reservation",
    );
    const expiry = await expireOrderPaymentReservations({
      clientConfig: context.database,
      orderId: pending.order_id,
      timeoutMs: 20000,
    });
    async function stock() {
      return (
        await client.query(
          `WITH reservations AS (SELECT * FROM inventory_reservations WHERE locked_order_id=$1),
            balances AS (SELECT b.* FROM inventory_balances b WHERE EXISTS(SELECT 1 FROM reservations r WHERE r.inventory_item_id=b.inventory_item_id AND r.location_id=b.location_id)),
            ledger AS (SELECT l.* FROM inventory_ledger l WHERE EXISTS(SELECT 1 FROM reservations r WHERE r.id=l.reservation_id))
           SELECT
            (SELECT count(*)::int FROM reservations WHERE status='EXPIRED') expired,
            (SELECT count(*)::int FROM reservations WHERE status='COMMITTED') committed,
            (SELECT count(*)::int FROM reservations WHERE status='ACTIVE') active,
            (SELECT count(*)::int FROM ledger WHERE source_type='EXPIRY') expiry_entries,
            (SELECT count(*)::int FROM ledger WHERE delta_on_hand<0) decrements,
            (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id)::text,'[]')) FROM reservations r) reservation_hash,
            (SELECT md5(coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.inventory_item_id,b.location_id)::text,'[]')) FROM balances b) balance_hash,
            (SELECT md5(coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id)::text,'[]')) FROM ledger l) ledger_hash`,
          [pending.order_id],
        )
      ).rows[0];
    }
    const expiredStock = await stock();
    check(
      expiry.status === "PASS" &&
        expiredStock.expired === 1 &&
        expiredStock.expiry_entries === 1 &&
        expiredStock.committed === 0 &&
        expiredStock.active === 0 &&
        expiredStock.decrements === 0,
      "real expiry releases the reservation once without consuming stock",
    );
    late.attempt = { ...late.attempt, action };
    await payment.settle(late);
    const eventId = await payment.reconcile(late);
    const applied = await payment.apply(eventId);
    check(
      applied.decision === "APPLIED" && applied.outcome === "PAID_REVIEW",
      "authenticated actual late capture enters PAID_REVIEW",
    );
    const paid = await payment.state(late);
    check(
      paid.payment_status === "PAID" &&
        paid.order_status === "OPEN" &&
        paid.attempt_status === "SUCCEEDED" &&
        paid.fulfillment_status === "ON_HOLD" &&
        paid.cart_status === "CONVERTED" &&
        paid.captures === 1 &&
        paid.confirmations === 1 &&
        paid.committed === 0 &&
        paid.active === 0 &&
        paid.decrements === 0 &&
        digest(await stock()) === digest(expiredStock),
      "late capture records its funds without reclaiming expired stock",
    );

    progress("late held order receives only its actual payment email");
    gateway = await createPersistentNotificationGatewayHarness({ context });
    let mailLink;
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
        key === gateway.transportKey
          ? {
              async sendEmail(command) {
                check(
                  command.notification.eventType === "PAYMENT_CONFIRMED",
                  "late order dispatch contains only the confirmed-payment event",
                );
                const match =
                  /https:\/\/[^\s"<>]+#token=([A-Za-z0-9_-]{43})&order=([a-f0-9-]{36})/u.exec(
                    command.content.text,
                  );
                check(
                  Boolean(match),
                  "actual late payment mail contains an exchange fragment",
                );
                const url = new globalThis.URL(match[0]);
                check(
                  url.origin === context.origin &&
                    url.pathname ===
                      `/${command.notification.locale.resolvedLocale}/order-access` &&
                    match[2] === late.checkout.publicOrderId,
                  "actual payment link targets this order at the owned localized access route",
                );
                mailLink = { token: match[1], publicOrderId: match[2] };
                payment.canaries.push(mailLink.token);
                runtime.registerSecret(mailLink.token);
                return gateway.transport.sendEmail(command);
              },
            }
          : undefined,
    });
    const source = (
      await client.query(
        "SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type='ORDER_PAYMENT_CONFIRMED'",
        [paid.order_id],
      )
    ).rows;
    check(
      source.length === 1,
      "late capture retains one canonical payment notification source",
    );
    const notification = await notifications.request(source[0].id);
    check(
      (await notifications.deliver(notification.notificationId)).decision ===
        "SENT",
      "late paid order email reaches the actual isolated TLS receiver",
    );
    await gateway.inspect();
    check(
      gateway.acceptedCount() === 1,
      "late order has one accepted payment email",
    );
    const access = createOrderAccessProtocolClient({
      ...context,
      canaries: payment.canaries,
    });
    const exchanged = await access.exchange(mailLink.token);
    const read = await access.read(exchanged.session, mailLink.publicOrderId);
    const order = read.data.order;
    check(
      order.paymentStatus === "PAID" &&
        order.orderStatus === "OPEN" &&
        order.disputeStatus === "NONE" &&
        order.fulfillmentStatus === "ON_HOLD" &&
        order.items.length === 1 &&
        order.items[0].giftKind === "PHYSICAL" &&
        order.items[0].fulfillmentStatus === "ON_HOLD" &&
        order.items[0].supportCertificate === null &&
        order.items[0].deliveryProofs.length === 0,
      "actual emailed-link exchange safely reads paid funds and held undelivered gift",
    );
    async function heldHistory() {
      const result = {};
      for (const table of [
        "fulfillments",
        "fulfillment_events",
        "notification_deliveries",
        "admin_notification_resends",
      ]) {
        const { rows } = await client.query(
          `SELECT to_jsonb(r) value FROM public.${table} r WHERE order_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"`,
          [paid.order_id],
        );
        result[table] = { count: rows.length, hash: digest(rows) };
      }
      return result;
    }
    const beforeRejected = await heldHistory();
    const admin = await runtime.command(manager, "detail", {
      schemaVersion: 1,
      orderId: paid.order_id,
    });
    check(
      admin.order.fulfillmentStatus === "ON_HOLD" &&
        admin.items.length === 1 &&
        admin.items[0].allowedActions.length === 0 &&
        admin.notification.status === "NONE" &&
        !admin.notification.canResend,
      "payment-owned inventory hold exposes neither operator resume nor resend",
    );
    const resend = await runtime.command(
      manager,
      "notification/resend",
      {
        schemaVersion: 1,
        orderId: paid.order_id,
        expectedOrderVersion: admin.version,
        expectedLatestNotificationId: notification.notificationId,
        reasonCode: "FAN_REQUESTED_UPDATE",
      },
      { key: randomUUID(), status: 409 },
    );
    check(
      resend.code === "STALE_VERSION",
      "inventory hold rejects a new-key payment resend",
    );
    const resume = await runtime.command(
      manager,
      "resume",
      {
        schemaVersion: 1,
        orderId: paid.order_id,
        expectedOrderVersion: admin.version,
        fulfillmentId: admin.items[0].fulfillmentId,
        expectedFulfillmentVersion: admin.items[0].fulfillmentVersion,
        reasonCode: "LOCAL_ACCEPTANCE",
        confirmed: true,
      },
      { key: randomUUID(), status: 409 },
    );
    check(
      resume.code === "TRANSITION_NOT_ALLOWED",
      "manager cannot resume a payment-owned missing-stock hold",
    );
    const stages = (
      await client.query(
        `SELECT public.admin_notification_current_event($1) current_event,
         (SELECT count(*)::int FROM fulfillment_events WHERE order_id=$1 AND to_status IN('PREPARING','DELIVERED')) studio_events,
         (SELECT count(*)::int FROM outbox_events x CROSS JOIN LATERAL public.notification_source_authority(x.id) s WHERE (x.aggregate_id=$1 OR x.secondary_subject_id=$1) AND s.order_id=$1 AND s.event_type IN('PREPARING','DELIVERED')) studio_sources,
         (SELECT count(*)::int FROM notification_deliveries WHERE order_id=$1 AND event_type IN('PREPARING','DELIVERED')) studio_mail`,
        [paid.order_id],
      )
    ).rows[0];
    check(
      stages.current_event === null &&
        stages.studio_events === 0 &&
        stages.studio_sources === 0 &&
        stages.studio_mail === 0,
      "late inventory hold has no preparation or delivery event, authority or mail",
    );
    check(
      digest(await heldHistory()) === digest(beforeRejected) &&
        digest(await stock()) === digest(expiredStock),
      "refused resume and resend preserve held fulfillment, delivery history and expired stock",
    );
    await onStage({
      scenario: "LATE",
      stage: "LATE_ON_HOLD",
      publicOrderId: mailLink.publicOrderId,
      accessSession: exchanged.session,
      order,
      canaries: payment.canaries,
    });
    await gateway.inspect();
    check(
      gateway.acceptedCount() === 1 &&
        digest(await stock()) === digest(expiredStock),
      "held order observation sends no additional mail and never reclaims inventory",
    );
    payment.canaries.forEach(runtime.registerSecret);
    await runtime.assertPrivacy();
    check(
      payment.canaries.every(
        (secret) => !context.logLines.some((entry) => entry.includes(secret)),
      ),
      "late lifecycle logs exclude mail capability and private checkout values",
    );
    return {
      schemaVersion: 1,
      scenario: "LATE",
      stage: "LATE_ON_HOLD",
      status: "PASS",
      actualPostgres: true,
      actualAuthenticatedTestPsp: true,
      actualTlsReceiver: true,
      emailLinkExchanged: true,
      expiredReservations: 1,
      acceptedPaymentEmails: 1,
      studioNotificationSources: 0,
      operatorResumeRejected: true,
      operatorResendRejected: true,
      expiredInventoryPreserved: true,
      scope:
        "Local TEST late capture and held-order lifecycle; no external mail or real funds",
    };
  } finally {
    await gateway?.close();
    await short.stop();
  }
}
