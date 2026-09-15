import { randomUUID } from "node:crypto";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  createOrderPaymentProtocolClient,
  waitForOrderPayment,
} from "./order-payment-client.mjs";
import { verifyOrderPaymentCommitFaults } from "./order-payment-commit-faults.mjs";

export async function verifyOrderPaymentProtocol(context) {
  const { client, check, fixtures, psp } = context;
  const api = createOrderPaymentProtocolClient(context);
  const cases = [];
  const same = (left, right, label) =>
    check(JSON.stringify(left) === JSON.stringify(right), label);
  const eventRow = async (signed) =>
    (
      await client.query(
        `SELECT id FROM provider_events WHERE provider_account_id=$1::uuid AND environment='TEST' AND provider_event_id=$2`,
        [
          context.endpoint.providerAccountId,
          JSON.parse(signed.rawBody).event_id,
        ],
      )
    ).rows[0]?.id;
  async function accepted(signed, options) {
    const reply = await context.sendWebhook(signed, options);
    check(
      reply.accepted,
      "Original raw webhook HTTP route accepts a valid signed TEST observation",
    );
    check(
      api.canaries.every((value) => !reply.body.includes(value)),
      "Webhook acknowledgement contains no private cart/contact values",
    );
    return eventRow(signed);
  }
  async function waitPaid(value, reservations = 0) {
    await waitForOrderPayment(
      "Actual registered worker applies durable payment evidence",
      async () => (await api.state(value))?.payment_status === "PAID",
      check,
    );
    return api.assertPaid(value, reservations);
  }
  context.progress(
    "seven locale authenticated evidence then independent atomic order application",
  );
  for (const locale of SUPPORTED_LOCALES) {
    const value = await api.fresh({ locale });
    const immutable = await api.immutableSnapshot(value);
    await api.settle(value);
    const eventId = await api.reconcile(value);
    const pending = await api.state(value);
    check(
      pending.payment_status === "PENDING" &&
        pending.order_status === "PENDING_PAYMENT" &&
        pending.cart_status === "LOCKED" &&
        pending.confirmations === 0,
      "Receiving authenticated capture evidence alone does not mark an order paid",
    );
    const applied = await api.apply(eventId);
    check(
      applied.decision === "APPLIED" && applied.outcome === "PAID",
      "Separate application transaction consumes the trusted durable event",
    );
    const stored = await api.assertPaid(value);
    check(
      (await api.apply(eventId)).decision === "ALREADY_APPLIED",
      "Permanent application receipt makes repeated processing a replay",
    );
    same(
      await api.state(value),
      stored,
      "Reapplying payment evidence changes no aggregate counter or stock",
    );
    same(
      await api.immutableSnapshot(value),
      immutable,
      "Applying payment preserves every immutable order/item/policy snapshot",
    );
    const counts = await psp.counts();
    const status = await api.checkout.read(value.session, value.checkout.id);
    check(
      status.data.checkout.paymentStatus === "PAID",
      "Authorized historical checkout HTTP reader observes canonical paid status",
    );
    same(
      status.data.checkout.lines,
      value.checkout.lines,
      "Seven-language historical checkout lines do not drift after payment",
    );
    same(
      status.data.checkout.amount,
      value.checkout.amount,
      "Historical checkout total stays exact after payment",
    );
    const paidRead = await api.payment.read(
      value.session,
      value.checkout.id,
      value.attempt.id,
    );
    const paidCurrent = await api.payment.current(value.session);
    for (const reply of [paidRead, paidCurrent]) {
      check(
        reply.data.attempt.id === value.attempt.id &&
          reply.data.attempt.status === "SUCCEEDED" &&
          reply.data.attempt.recovery === "NONE" &&
          reply.data.attempt.action === undefined,
        "Existing payment GET contracts expose the completed attempt without a stale recovery action",
      );
    }
    check(
      paidCurrent.data.checkout.id === value.checkout.id &&
        paidCurrent.data.checkout.presentationLocale === locale &&
        paidCurrent.data.checkout.paymentStatus === "PAID",
      "Current checkout GET preserves the authorized paid session and frozen locale",
    );
    same(
      await psp.counts(),
      counts,
      "Checkout, payment read and current GET perform no PSP query or mutation",
    );
    cases.push({
      kind: "RECONCILE_THEN_APPLY",
      locale,
      outcome: "PAID",
      immutableSnapshot: immutable,
    });
  }

  context.progress(
    "nontracked preorder and shared finite inventory atomic application",
  );
  for (const [kind, lines, reservations] of [
    [
      "PREORDER",
      [{ gift: fixtures.gifts[0], variant: fixtures.gifts[0].variants[2] }],
      0,
    ],
    [
      "SHARED_TRACKED",
      [
        { gift: fixtures.gifts[6], artist: fixtures.artists[0], quantity: 2 },
        { gift: fixtures.gifts[6], artist: fixtures.artists[1], quantity: 3 },
      ],
      2,
    ],
  ]) {
    const value = await api.fresh({ lines });
    await api.settle(value);
    const eventId = await api.reconcile(value);
    await api.apply(eventId);
    await api.assertPaid(value, reservations);
    if (reservations) {
      const row = (
        await client.query(
          `SELECT count(DISTINCT l.balance_version_after)::int AS versions,count(DISTINCT r.inventory_item_id)::int AS inventory_items,sum(-l.delta_on_hand)::int AS consumed FROM inventory_ledger l JOIN inventory_reservations r ON r.id=l.reservation_id JOIN orders o ON o.id=r.locked_order_id WHERE o.checkout_session_id=$1::uuid AND l.delta_on_hand<0`,
          [value.checkout.id],
        )
      ).rows[0];
      check(
        row.versions === 2 && row.inventory_items === 1 && row.consumed === 5,
        "Two artists sharing finite stock commit separate progressive balance versions and exact total quantity",
      );
    }
    cases.push({ kind, outcome: "PAID", reservations });
  }

  context.progress(
    "raw signed webhook, real inbox worker and cross-source capture idempotency",
  );
  const webhookFirst = await api.fresh({ locale: "ja" });
  const earlier = await context.signWebhook(webhookFirst.attempt.id);
  const bad = await context.sendWebhook(earlier, {
    rawBody: earlier.rawBody + " ",
  });
  check(
    bad.status === 400,
    "Raw webhook byte tampering is rejected by actual HTTP signature verification",
  );
  check(
    (await eventRow(earlier)) === undefined,
    "Invalid signature creates no provider event",
  );
  const unknownEndpoint = await context.sendWebhook(earlier, {
    endpointId: randomUUID(),
  });
  check(
    unknownEndpoint.status === 404,
    "Unknown endpoint cannot select a verifier from untrusted payload",
  );
  await api.settle(webhookFirst);
  const signed = await context.signWebhook(webhookFirst.attempt.id);
  const webhookId = await accepted(signed);
  check(
    Boolean(webhookId) &&
      (await api.state(webhookFirst)).payment_status === "PENDING",
    "Valid webhook is durably accepted before any order worker is started",
  );
  const worker = await context.createOrderWorker();
  try {
    const paid = await waitPaid(webhookFirst);
    const duplicates = await Promise.all([
      context.sendWebhook(signed),
      context.sendWebhook(signed),
    ]);
    check(
      duplicates.every((reply) => reply.accepted),
      "Concurrent same-event HTTP retries are safely acknowledged",
    );
    await worker.maintenance();
    same(
      await api.state(webhookFirst),
      paid,
      "Duplicate webhook never repeats capture, fulfillment or inventory effects",
    );
    await accepted(earlier);
    await worker.maintenance();
    same(
      await api.state(webhookFirst),
      paid,
      "An older verified payment observation cannot reverse settled order state",
    );
    cases.push({ kind: "WEBHOOK_FIRST_AND_DUPLICATE", outcome: "PAID" });
  } finally {
    await worker.stop();
  }

  // Both observations are genuine: distinct PSP event IDs and the same immutable capture reference.
  for (const sequence of ["WEBHOOK_FIRST", "RECONCILE_FIRST", "CONCURRENT"]) {
    const dual = await api.fresh();
    await api.settle(dual);
    const dualSigned = await context.signWebhook(dual.attempt.id);
    let reconcileId, dualWebhookId;
    if (sequence === "WEBHOOK_FIRST") {
      dualWebhookId = await accepted(dualSigned);
      const untouched = await api.state(dual);
      check(
        untouched.payment_status === "PENDING" && untouched.captures === 0,
        "Canonical webhook may be accepted unmatched before any ledger or order application exists",
      );
      reconcileId = await api.reconcile(dual);
    } else if (sequence === "RECONCILE_FIRST") {
      reconcileId = await api.reconcile(dual);
      dualWebhookId = await accepted(dualSigned);
    } else
      [reconcileId, dualWebhookId] = await Promise.all([
        api.reconcile(dual),
        accepted(dualSigned),
      ]);
    check(
      reconcileId !== dualWebhookId,
      "Webhook and authenticated reconcile retain their independent provider event rows",
    );
    const observations = [reconcileId, dualWebhookId].map((id) =>
      context.observeSqlStates(() => api.apply(id)),
    );
    const applications = await Promise.allSettled(
      observations.map((value) => value.promise),
    );
    check(
      applications.some((result) => result.status === "fulfilled") &&
        applications.every((result, index) =>
          result.status === "fulfilled"
            ? ["APPLIED", "ALREADY_APPLIED"].includes(result.value.decision)
            : result.reason?.code === "PERSISTENCE_FAILURE" &&
              observations[index].sqlStates.length > 0 &&
              observations[index].sqlStates.every((code) => code === "40001"),
        ),
      "Concurrent application has a real successful transaction and only explicitly observed serialization conflicts may need durable recovery",
    );
    const initialApplications = applications.map((result, index) => ({
      status: result.status,
      ...(result.status === "fulfilled"
        ? { decision: result.value.decision }
        : { code: result.reason.code }),
      sqlStates: observations[index].sqlStates,
    }));
    console.log(
      `Order payment concurrent application ${JSON.stringify({ sequence, initialApplications })}`,
    );
    const initialPaid = await api.assertPaid(dual);
    const restarted = await context.createOrderWorker();
    try {
      await waitForOrderPayment(
        "Actual worker and durable maintenance converge both independent source receipts",
        async () => {
          await restarted.maintenance();
          return (
            (
              await client.query(
                `SELECT count(*)::int AS count FROM order_payment_application_receipts WHERE provider_event_id=ANY($1::uuid[]) AND decision='APPLIED'`,
                [[reconcileId, dualWebhookId]],
              )
            ).rows[0].count === 2
          );
        },
        check,
        { timeoutMs: 45000 },
      );
      same(
        await api.state(dual),
        initialPaid,
        "Restarted actual worker replays durable references without reapplying settlement",
      );
    } finally {
      await restarted.stop();
    }
    cases.push({
      kind: `DOUBLE_SOURCE_${sequence}`,
      outcome: "PAID",
      initialApplications,
      finalSourceReceipts: 2,
    });
  }

  context.progress(
    "unmatched early evidence remains recoverable after provider binding",
  );
  const early = await api.fresh({ lost: true });
  const earlySigned = await context.signWebhook(early.attempt.id);
  const earlyId = await accepted(earlySigned);
  const unmatched = await api.apply(earlyId);
  check(
    unmatched.decision === "UNMATCHED",
    "Authenticated early event remains pending until external reference is authoritatively bound",
  );
  const recoveryId = await api.reconcile(early, "REQUIRES_ACTION");
  check(
    Boolean(recoveryId),
    "Normal authenticated recovery binds the original attempt without a replacement payment",
  );
  const earlyWorker = await context.createOrderWorker();
  try {
    await earlyWorker.maintenance();
    await waitForOrderPayment(
      "Unmatched event is revisited after its real payment binding exists",
      async () => {
        await earlyWorker.maintenance();
        return (
          (
            await client.query(
              `SELECT count(*)::int AS count FROM order_payment_application_receipts WHERE provider_event_id=$1::uuid`,
              [earlyId],
            )
          ).rows[0].count === 1
        );
      },
      check,
      { timeoutMs: 45000 },
    );
    const state = await api.state(early);
    check(
      state.payment_status === "PENDING" &&
        state.confirmations === 0 &&
        state.captures === 0,
      "Recovering a nonterminal early event does not fabricate successful payment",
    );
  } finally {
    await earlyWorker.stop();
  }
  cases.push({ kind: "UNMATCHED_RECOVERY", outcome: "PENDING" });

  context.progress(
    "bounded pending scan advances beyond unmatched observations",
  );
  for (let index = 0; index < 3; index++) {
    const unmatchedValue = await api.fresh({ lost: true });
    await accepted(await context.signWebhook(unmatchedValue.attempt.id));
  }
  const fairValue = await api.fresh();
  await api.settle(fairValue);
  await api.reconcile(fairValue);
  const firstBatch = await api.application.runPending(2);
  check(
    firstBatch.scanned === 2 &&
      firstBatch.unmatched === 2 &&
      firstBatch.failed === 0,
    "First bounded scan claims two true unmatched observations",
  );
  const secondBatch = await api.application.runPending(2);
  check(
    secondBatch.scanned === 2 &&
      secondBatch.unmatched === 1 &&
      secondBatch.applied === 1 &&
      secondBatch.failed === 0,
    "Immediate second bounded scan advances to later matched evidence without waiting for unmatched retries",
  );
  await api.assertPaid(fairValue);
  cases.push({
    kind: "UNMATCHED_SCAN_FAIRNESS",
    limit: 2,
    unmatched: 3,
    outcome: "PAID",
  });

  context.progress(
    "trusted terminal failure releases real finite reservation without automatic retry",
  );
  for (const terminal of ["FAILED", "CANCELED"]) {
    const failed = await api.fresh({ lines: [{ gift: fixtures.gifts[1] }] });
    await api.settle(failed, terminal);
    const failedId = await accepted(
      await context.signWebhook(failed.attempt.id),
    );
    const pendingFailure = await api.state(failed);
    check(
      pendingFailure.active === 1 &&
        pendingFailure.attempt_status === "REQUIRES_ACTION",
      "Failure webhook begins with the actual nonterminal attempt and its active reservation, without prior reconcile",
    );
    const failureWorker = await context.createOrderWorker();
    try {
      await waitForOrderPayment(
        "Real webhook worker terminates the failed attempt and releases its reservation atomically",
        async () => {
          const value = await api.state(failed);
          return value?.attempt_status === terminal && value.released === 1;
        },
        check,
      );
      const released = await api.apply(failedId);
      check(
        released.decision === "ALREADY_APPLIED" &&
          released.outcome === "FAILED_RELEASED",
        "Trusted terminal webhook has one durable resource-release receipt",
      );
      const failureState = await api.state(failed);
      check(
        failureState.released === 1 &&
          failureState.active === 0 &&
          failureState.captures === 0 &&
          failureState.confirmations === 0 &&
          failureState.order_status === "PENDING_PAYMENT" &&
          failureState.cart_status === "LOCKED",
        "Failure leaves financial truth unpaid, releases stock once and does not silently create a new order",
      );
      await api.apply(failedId);
      same(
        await api.state(failed),
        failureState,
        "Failure replay preserves exact aggregate and stock counters",
      );
    } finally {
      await failureWorker.stop();
    }
    cases.push({
      kind: `WEBHOOK_${terminal}_RELEASED`,
      outcome: "FAILED_RELEASED",
    });
  }

  context.progress(
    "actual expiry and late authenticated capture retain payment as PAID_REVIEW",
  );
  const short = await context.createCheckoutApi(8000);
  try {
    const late = await api.fresh({
      checkoutBase: short.base,
      lost: true,
      lines: [{ gift: fixtures.gifts[1] }],
    });
    const action = await psp.hostedAction(late.attempt.id);
    check(
      action?.type === "REDIRECT",
      "Owned TEST PSP exposes only its already stored hosted action after the API response loss",
    );
    const { expireOrderPaymentReservations } =
      await import("../../../packages/persistence-postgres/scripts/order-payment-expiry-fixture.mjs");
    const expiry = await expireOrderPaymentReservations({
      clientConfig: context.database,
      orderId: (await api.state(late)).order_id,
      timeoutMs: 20000,
    });
    late.attempt = { ...late.attempt, action };
    await api.settle(late);
    const lateId = await api.reconcile(late);
    const result = await api.apply(lateId);
    check(
      result.decision === "APPLIED" && result.outcome === "PAID_REVIEW",
      "A true captured payment after reservation expiry enters paid manual review",
    );
    const state = await api.state(late);
    check(
      state.payment_status === "PAID" &&
        state.order_status === "OPEN" &&
        state.attempt_status === "SUCCEEDED" &&
        state.fulfillment_status === "ON_HOLD" &&
        state.cart_status === "CONVERTED" &&
        state.captures === 1 &&
        state.confirmations === 1 &&
        state.committed === 0 &&
        state.decrements === 0,
      "Late success retains the actual capture and never recommits expired stock or silently oversells",
    );
    check(
      (await api.apply(lateId)).decision === "ALREADY_APPLIED",
      "Late payment review is permanently idempotent",
    );
    same(
      await api.state(late),
      state,
      "Repeated late evidence cannot consume stock again",
    );
    cases.push({
      kind: "EXPIRED_LATE_CAPTURE",
      outcome: "PAID_REVIEW",
      expiry,
    });
  } finally {
    await short.stop();
  }
  context.progress(
    "actual order application rollback and unknown COMMIT result recovery",
  );
  const commitFaults = await verifyOrderPaymentCommitFaults(context, api);
  check(
    api.canaries.every((value) =>
      context.logLines.every((line) => !JSON.stringify(line).includes(value)),
    ),
    "Actual API and worker logs do not contain private contact or message canaries",
  );
  return {
    schemaVersion: 1,
    cases,
    commitFaults,
    checkoutRequests: api.checkout.events.length,
    paymentRequests: api.payment.events.length,
    actualPostgres: true,
    actualIndependentTestPsp: true,
    actualPspSandbox: false,
    orderLookupImplemented: false,
    browserEvidence: false,
  };
}
