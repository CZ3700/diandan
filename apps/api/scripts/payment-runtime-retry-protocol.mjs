import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createCheckoutProtocolClient } from "./checkout-preflight-client.mjs";
import { createPaymentProtocolClient } from "./payment-runtime-client.mjs";
import { changePaymentRuntimeTestHealth } from "../../../packages/persistence-postgres/scripts/payment-runtime-health-fixture.mjs";

export async function verifyPaymentRuntimeRetryProtocol(context) {
  const { check, client, psp, tls, database, published } = context;
  const canaries = [
    `private-${randomUUID()}`,
    `name-${randomUUID().slice(0, 12)}`,
    `test-${randomUUID()}@example.invalid`,
  ];
  const checkout = createCheckoutProtocolClient({ ...context, canaries });
  const payment = createPaymentProtocolClient({ ...context, canaries });
  const session = await checkout.initialize();
  await checkout.add(session);
  const preflight = await checkout.validate(session);
  const created = await checkout.create(
    session,
    preflight.data.preflight,
    canaries[2],
  );
  const id = created.data.checkout.id;
  const cap = (await payment.capabilities(session, id)).data.capabilities
    .capabilities[0];
  const firstKey = randomUUID(),
    secondKey = randomUUID();
  const first = await payment.create(session, id, cap, { key: firstKey });
  const hosted = await tls.fetcher(first.data.attempt.action.url);
  const html = await hosted.text(),
    csrf = /name="csrf" value="([A-Za-z0-9_-]+)"/u.exec(html)?.[1];
  check(
    hosted.status === 200 && csrf,
    "Cancellation uses the actual authorized TEST hosted payment form",
  );
  const cancel = await tls.fetcher(first.data.attempt.action.url, {
    method: "POST",
    headers: {
      origin: psp.origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new globalThis.URLSearchParams({
      csrf,
      outcome: "CANCELED",
    }).toString(),
  });
  check(
    cancel.status === 303,
    "TEST PSP accepts an explicit cancellation and returns normally",
  );
  const deadline = globalThis.performance.now() + 20_000;
  let due;
  do {
    const {
      rows: [row],
    } = await client.query(
      "SELECT next_attempt_at<=clock_timestamp() AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) AS due FROM payment_runtime_operations WHERE attempt_id=$1",
      [first.data.attempt.id],
    );
    due = row.due === true;
    if (!due) await delay(100);
  } while (!due && globalThis.performance.now() < deadline);
  check(
    due,
    "Canceled payment reaches the unchanged durable reconcile due time",
  );
  const canceled = await payment.recover(session, id, first.data.attempt.id);
  check(
    canceled.data.attempt.status === "CANCELED" &&
      canceled.data.attempt.canRetry,
    "Only authenticated terminal cancellation enables a new attempt",
  );
  const before = await psp.counts();
  const nextCap = (await payment.capabilities(session, id)).data.capabilities
    .capabilities[0];
  const second = await payment.create(session, id, nextCap, { key: secondKey });
  check(
    second.data.attempt.id !== first.data.attempt.id &&
      second.data.attempt.checkoutSessionId === id,
    "Valid existing checkout creates a distinct attempt after trusted cancellation",
  );
  const {
    rows: [sameOrder],
  } = await client.query(
    "SELECT count(DISTINCT order_id)::int orders,count(*)::int attempts FROM payment_attempts WHERE id=ANY($1::uuid[])",
    [[first.data.attempt.id, second.data.attempt.id]],
  );
  check(
    sameOrder.orders === 1 &&
      sameOrder.attempts === 2 &&
      (await psp.counts()).payments === before.payments + 1,
    "Actual SQL and PSP prove one order with two distinct sequential attempts",
  );
  const after = await psp.counts();
  const oldReplay = await payment.create(session, id, cap, { key: firstKey });
  check(
    oldReplay.data.action === "REPLAYED" &&
      oldReplay.data.attempt.id === first.data.attempt.id &&
      oldReplay.data.attempt.status === "CANCELED",
    "Old permanent create key keeps the old terminal attempt after a new attempt exists",
  );
  check(
    JSON.stringify(await psp.counts()) === JSON.stringify(after),
    "Old-key replay never dispatches the replacement payment",
  );
  const providerAccountId = published.routes[0].providerAccountId;
  const healthOptions = { clientConfig: database, providerAccountId };
  let health;
  try {
    health = await changePaymentRuntimeTestHealth({
      ...healthOptions,
      healthStatus: "UNAVAILABLE",
    });
    const frozenBefore = await client.query(
      "SELECT provider_account_id,amount_minor::text,currency,order_id FROM payment_attempts WHERE id=$1",
      [second.data.attempt.id],
    );
    const replay = await payment.create(session, id, nextCap, {
      key: secondKey,
    });
    const frozenAfter = await client.query(
      "SELECT provider_account_id,amount_minor::text,currency,order_id FROM payment_attempts WHERE id=$1",
      [second.data.attempt.id],
    );
    check(
      replay.data.action === "REPLAYED" &&
        replay.data.attempt.id === second.data.attempt.id &&
        JSON.stringify(frozenBefore.rows) === JSON.stringify(frozenAfter.rows),
      "Normal health circuit opening does not rewrite frozen attempt account or money",
    );
    check(
      JSON.stringify(await psp.counts()) === JSON.stringify(after),
      "Existing-key recovery through unavailable provider configuration does not create a new PSP payment",
    );
  } finally {
    await changePaymentRuntimeTestHealth({
      ...healthOptions,
      healthStatus: "HEALTHY",
    });
  }
  return {
    schemaVersion: 1,
    status: "PASS",
    canceledThenRetry: true,
    sameOrder: true,
    permanentOldKey: true,
    normalHealthEvent: health.action,
    healthRestored: true,
    requests: payment.events,
  };
}
