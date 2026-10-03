import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createOrderPaymentApplication } from "@fan-support/application";
import { createCheckoutProtocolClient } from "./checkout-preflight-client.mjs";
import { createPaymentProtocolClient } from "./payment-runtime-client.mjs";

export async function waitForOrderPayment(
  label,
  read,
  check,
  { timeoutMs = 15000 } = {},
) {
  const deadline = globalThis.performance.now() + timeoutMs;
  do {
    const value = await read();
    if (value) return value;
    await delay(50);
  } while (globalThis.performance.now() < deadline);
  check(false, label);
}

export function createOrderPaymentProtocolClient(context) {
  const { client, check, tls, psp, fixtures } = context;
  const canaries = [
    `private-${randomUUID()}`,
    `name-${randomUUID().slice(0, 8)}`,
    `test-${randomUUID()}@example.invalid`,
  ];
  const checkout = createCheckoutProtocolClient({ ...context, canaries });
  const payment = createPaymentProtocolClient({ ...context, canaries });
  const application = createOrderPaymentApplication({
    transactions: context.persistence.orderPaymentApplicationTransactionManager,
  });
  const command = (providerEventId) => ({
    schemaVersion: 1,
    providerEventId,
    requestId: randomUUID(),
    correlationId: randomUUID(),
    taskName: "order-payment-protocol",
  });
  async function fresh({
    locale = "en",
    lines = [{}],
    lost = false,
    checkoutBase,
  } = {}) {
    const session = await checkout.initialize(locale);
    for (const line of lines) await checkout.add(session, line);
    const target = checkoutBase ? { target: checkoutBase } : {};
    const preflight = (await checkout.validate(session, target)).data.preflight;
    const order = (
      await checkout.create(session, preflight, canaries[2], target)
    ).data.checkout;
    const capabilities = (
      await payment.capabilities(session, order.id, { locale })
    ).data.capabilities;
    const capability = capabilities.capabilities[0];
    check(
      capability?.environment === "TEST",
      "Order payment uses a normally published TEST capability",
    );
    const key = randomUUID();
    if (lost) await psp.arm({ operation: "CREATE_PAYMENT", mode: "AFTER" });
    const attempt = (
      await payment.create(session, order.id, capability, { key })
    ).data.attempt;
    check(
      attempt?.status === (lost ? "UNKNOWN" : "REQUIRES_ACTION"),
      "Normal checkout creates exactly the expected provider-bound attempt",
    );
    return { session, checkout: order, attempt, capability, key };
  }
  async function settle(value, outcome = "SUCCEEDED") {
    const page = await tls.fetcher(value.attempt.action.url);
    const csrf = /name="csrf" value="([A-Za-z0-9_-]+)"/u.exec(
      await page.text(),
    )?.[1];
    check(
      page.status === 200 && csrf,
      "Actual hosted TEST PSP exposes its protected native form",
    );
    const response = await tls.fetcher(value.attempt.action.url, {
      method: "POST",
      headers: {
        origin: psp.origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new globalThis.URLSearchParams({ csrf, outcome }).toString(),
    });
    check(
      response.status === 303,
      "Actual hosted TEST PSP commits the selected outcome and returns by redirect",
    );
  }
  async function reconcile(value, status = "SUCCEEDED") {
    await waitForOrderPayment(
      "Actual payment recovery becomes due without changing its clock or lease",
      async () => {
        const row = (
          await client.query(
            `SELECT phase='RECONCILE' AND next_attempt_at <= clock_timestamp() AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp()) AS ready FROM payment_runtime_operations WHERE attempt_id=$1::uuid`,
            [value.attempt.id],
          )
        ).rows[0];
        return row?.ready;
      },
      check,
    );
    await payment.recover(value.session, value.checkout.id, value.attempt.id);
    return waitForOrderPayment(
      "Authenticated PSP query stores the requested trusted observation",
      async () => {
        const row = (
          await client.query(
            `SELECT id FROM provider_events WHERE provider_account_id=$1::uuid AND environment='TEST' AND provider_event_id=$2 AND normalized_status=$3`,
            [
              context.endpoint.providerAccountId,
              `test-event/${value.attempt.id}/${status}`,
              status,
            ],
          )
        ).rows[0];
        return row?.id;
      },
      check,
    );
  }
  async function immutableSnapshot(value) {
    const rows = (
      await client.query(
        `SELECT to_jsonb(o)-ARRAY['order_status','payment_status','dispute_status','fulfillment_status','current_payment_attempt_id','version','updated_at'] AS frozen_order,(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM order_items i WHERE i.order_id=o.id) AS items,(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policy_key) FROM policy_acceptances p WHERE p.order_id=o.id) AS policies FROM orders o WHERE o.checkout_session_id=$1::uuid`,
        [value.checkout.id],
      )
    ).rows;
    return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  }
  async function state(value) {
    return (
      await client.query(
        `SELECT o.id AS order_id,o.order_status,o.payment_status,o.fulfillment_status,o.presentation_locale,o.total_amount_minor::text AS amount,o.currency,o.version AS order_version,a.status AS attempt_status,a.version AS attempt_version,c.status AS cart_status,
      (SELECT count(*)::int FROM order_items i WHERE i.order_id=o.id) AS items,
      (SELECT count(*)::int FROM order_items i JOIN support_intents s ON s.id=i.support_intent_id WHERE i.order_id=o.id AND s.status='CONVERTED') AS converted_intents,
      (SELECT count(*)::int FROM fulfillments f WHERE f.order_id=o.id) AS fulfillments,
      (SELECT count(*)::int FROM inventory_reservations r WHERE r.locked_order_id=o.id) AS reservations,
      (SELECT count(*)::int FROM inventory_reservations r WHERE r.locked_order_id=o.id AND r.status='COMMITTED') AS committed,
      (SELECT count(*)::int FROM inventory_reservations r WHERE r.locked_order_id=o.id AND r.status='ACTIVE') AS active,
      (SELECT count(*)::int FROM inventory_reservations r WHERE r.locked_order_id=o.id AND r.status='RELEASED') AS released,
      (SELECT count(*)::int FROM inventory_ledger l JOIN inventory_reservations r ON r.id=l.reservation_id WHERE r.locked_order_id=o.id AND l.delta_on_hand<0) AS decrements,
      (SELECT count(*)::int FROM payment_transactions t WHERE t.payment_attempt_id=a.id AND t.transaction_type='CAPTURE') AS captures,
      (SELECT count(*)::int FROM outbox_events b WHERE b.aggregate_id=o.id AND b.event_type='ORDER_PAYMENT_CONFIRMED') AS confirmations,
      (SELECT count(*)::int FROM payment_attempt_events e WHERE e.payment_attempt_id=a.id) AS attempt_events,
      (SELECT count(*)::int FROM outbox_events b WHERE b.aggregate_id=a.id AND b.event_type='PAYMENT_STATUS_CHANGED') AS payment_outbox
      FROM orders o JOIN carts c ON c.id=o.cart_id JOIN payment_attempts a ON a.id=$2::uuid AND a.order_id=o.id WHERE o.checkout_session_id=$1::uuid`,
        [value.checkout.id, value.attempt.id],
      )
    ).rows[0];
  }
  async function assertPaid(
    value,
    expectedReservations = 0,
    expectedFulfillmentStatus = "PENDING",
  ) {
    const row = await state(value);
    check(
      row?.payment_status === "PAID" &&
        row.order_status === "OPEN" &&
        row.attempt_status === "SUCCEEDED" &&
        row.cart_status === "CONVERTED",
      "Payment, order and cart commit their canonical success together",
    );
    check(
      row.converted_intents === row.items &&
        row.fulfillments === row.items &&
        row.fulfillment_status === expectedFulfillmentStatus,
      "Every historical order line has a converted intent and its expected fulfillment aggregate",
    );
    check(
      row.captures === 1 &&
        row.confirmations === 1 &&
        row.attempt_events === Number(row.attempt_version) &&
        row.payment_outbox === row.attempt_events,
      "One capture and one order confirmation accompany the exact payment event/outbox chain",
    );
    check(
      row.reservations === expectedReservations &&
        row.committed === expectedReservations &&
        row.decrements === expectedReservations &&
        row.active === 0,
      "Tracked reservations commit exactly once while nontracked orders fabricate none",
    );
    check(
      row.presentation_locale === value.checkout.presentationLocale &&
        row.amount === String(value.checkout.amount.totalAmountMinor) &&
        row.currency === value.checkout.currency,
      "Canonical paid order keeps the original locale, amount and currency",
    );
    return row;
  }
  return {
    fresh,
    settle,
    reconcile,
    immutableSnapshot,
    state,
    assertPaid,
    payment,
    checkout,
    canaries,
    fixtures,
    application,
    command,
    apply: (eventId) => application.apply(command(eventId)),
  };
}
