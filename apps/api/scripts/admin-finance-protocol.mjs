import { randomUUID } from "node:crypto";
import { createPaidAdminOrder } from "./admin-orders-fixtures.mjs";
import { waitForOrderPayment } from "./order-payment-client.mjs";
/** Real HTTP commands, real platform PG, and independently durable TEST PSP outcomes. */
export async function verifyAdminFinanceProtocol(context, runtime, payment) {
  const { check, client } = context,
    { detail, mutation } = runtime;
  const manager = await runtime.login("manager"),
    operator = await runtime.login("order"),
    editor = await runtime.login("editor");
  const paid = await createPaidAdminOrder(context, payment, {
    noMessage: true,
    lines: [{}, { artist: context.fixtures.artists[1] }],
  });
  const ordersDetail = () =>
    runtime.command(manager, "detail", {
      schemaVersion: 1,
      orderId: paid.orderId,
    });
  const fulfill = (path, order, line, status = 200) =>
    runtime.command(
      manager,
      path,
      {
        schemaVersion: 1,
        reasonCode: "LOCAL_ACCEPTANCE",
        orderId: paid.orderId,
        expectedOrderVersion: order.version,
        fulfillmentId: line.fulfillmentId,
        expectedFulfillmentVersion: line.fulfillmentVersion,
      },
      { key: randomUUID(), status },
    );
  const beforeRefundOrder = await ordersDetail();
  await fulfill("prepare", beforeRefundOrder, beforeRefundOrder.items[0]);
  let current = await detail(manager, paid.orderId);
  check(
    current.kind === "DETAIL" &&
      current.items.length === 2 &&
      current.canManage,
    "manager sees exact original item refund capacities",
  );
  check(
    !(await detail(operator, paid.orderId)).canManage,
    "order operator receives only financial read capability",
  );
  check(
    (
      await runtime.financeCommand(
        editor,
        "detail",
        { schemaVersion: 1, orderId: paid.orderId },
        { status: 403 },
      )
    ).code === "FORBIDDEN",
    "editor cannot inspect order finance",
  );
  const item = current.items[0],
    amount = Math.min(100, item.availableAmountMinor),
    body = {
      orderId: paid.orderId,
      expectedOrderVersion: current.order.version,
      amountMinor: amount,
      currency: current.order.currency,
      allocations: [{ orderItemId: item.orderItemId, amountMinor: amount }],
    };
  check(
    (await mutation(operator, "refund", body, { status: 403 })).code ===
      "FORBIDDEN",
    "operator cannot request a refund",
  );
  const key = randomUUID(),
    before = await context.psp.counts();
  const [first, replay] = await Promise.all([
    mutation(manager, "refund", body, { key }),
    mutation(manager, "refund", body, { key }),
  ]);
  check(
    first.refundId === replay.refundId &&
      [first, replay].filter((r) => r.replayed).length === 1,
    "concurrent duplicate HTTP command has one permanent receipt and refund",
  );
  check(
    (await context.psp.counts()).refunds === before.refunds + 1 &&
      (await context.psp.counts()).refundCalls === before.refundCalls + 1,
    "duplicate command reaches one durable PSP refund",
  );
  check(
    (
      await mutation(
        manager,
        "refund",
        {
          ...body,
          amountMinor: amount + 1,
          allocations: [
            { orderItemId: item.orderItemId, amountMinor: amount + 1 },
          ],
        },
        { key, status: 409 },
      )
    ).code === "IDEMPOTENCY_CONFLICT",
    "same key changed refund is rejected",
  );
  current = await detail(manager, paid.orderId);
  check(
    current.refunds[0].status === "PROCESSING" &&
      current.order.occupiedRefundAmountMinor === amount &&
      current.order.refundedAmountMinor === 0,
    "accepted processing refund reserves capacity but does not invent completed money",
  );
  const held = await ordersDetail();
  check(
    held.items.every(
      (line) =>
        !line.allowedActions.includes("PREPARE") &&
        !line.allowedActions.includes("DELIVER"),
    ),
    "pending refund suppresses preparation and delivery actions",
  );
  for (const line of held.items) {
    const path =
      line.fulfillmentId === beforeRefundOrder.items[0].fulfillmentId
        ? "deliver"
        : "prepare";
    check(
      (await fulfill(path, held, line, 409)).code === "PAYMENT_NOT_CONFIRMED",
      "pending refund blocks preparation and delivery through real HTTP",
    );
  }
  const tooMuch = current.order.availableRefundAmountMinor + 1;
  check(
    (
      await mutation(
        manager,
        "refund",
        {
          ...body,
          expectedOrderVersion: current.order.version,
          amountMinor: tooMuch,
          allocations: [
            { orderItemId: item.orderItemId, amountMinor: tooMuch },
          ],
        },
        { status: 409 },
      )
    ).code === "REFUND_CAPACITY_EXCEEDED",
    "pending refund counts toward full capture capacity",
  );
  check(
    (
      await mutation(
        manager,
        "refund",
        {
          ...body,
          expectedOrderVersion: current.order.version,
          currency: current.order.currency === "USD" ? "EUR" : "USD",
        },
        { status: 409 },
      )
    ).code === "CURRENCY_MISMATCH",
    "refund currency remains original capture currency",
  );
  const worker = await context.createOrderWorker();
  await context.psp.settleRefund({
    refundId: first.refundId,
    status: "SUCCEEDED",
  });
  const signed = await context.signRefundWebhook(first.refundId);
  check(
    (await context.sendWebhook(signed, { rawBody: signed.rawBody + " " }))
      .status === 400,
    "changed refund webhook bytes cannot authenticate",
  );
  check(
    (await context.sendWebhook(signed)).accepted,
    "real signed refund enters the real inbox",
  );
  await waitForOrderPayment(
    "actual durable worker applies signed refund",
    async () => {
      await worker.maintenance();
      const value = await detail(manager, paid.orderId);
      return value.order.refundedAmountMinor === amount ? value : null;
    },
    check,
  );
  check(
    (await context.sendWebhook(signed)).accepted,
    "duplicate signed refund is safely accepted",
  );
  current = await detail(manager, paid.orderId);
  check(
    current.order.paymentStatus === "PARTIALLY_REFUNDED" &&
      (await runtime.readFacts(paid.orderId)).attemptStatus === "SUCCEEDED",
    "refund projection does not undo payment success",
  );
  const allocations = current.items
    .filter((i) => i.availableAmountMinor > 0)
    .map((i) => ({
      orderItemId: i.orderItemId,
      amountMinor: i.availableAmountMinor,
    }));
  const rest = await mutation(manager, "refund", {
    ...body,
    expectedOrderVersion: current.order.version,
    amountMinor: current.order.availableRefundAmountMinor,
    allocations,
  });
  await context.psp.settleRefund({
    refundId: rest.refundId,
    status: "SUCCEEDED",
  });
  current = await detail(manager, paid.orderId);
  const restSigned = await context.signRefundWebhook(rest.refundId);
  const [, concurrentWebhook] = await Promise.all([
    mutation(manager, "reconcile", {
      orderId: paid.orderId,
      expectedOrderVersion: current.order.version,
      target: { kind: "REFUND", refundId: rest.refundId },
    }),
    context.sendWebhook(restSigned),
  ]);
  check(
    concurrentWebhook.accepted,
    "concurrent authenticated reconcile and signed webhook are both retained",
  );
  current = await detail(manager, paid.orderId);
  check(
    current.order.paymentStatus === "REFUNDED" &&
      current.order.refundedAmountMinor === current.order.capturedAmountMinor,
    "partial then remainder produces exact full refund",
  );
  check(
    (await context.sendWebhook(await context.signRefundWebhook(rest.refundId)))
      .accepted,
    "reconcile then webhook retains a second trusted observation of the same native refund",
  );
  await worker.maintenance();
  const refundLedger = (
    await client.query(
      "SELECT count(*)::int AS count FROM payment_transactions WHERE payment_attempt_id=$1 AND transaction_type='REFUND'",
      [paid.attempt.id],
    )
  ).rows[0];
  check(
    refundLedger.count === 2,
    "two refunds have exactly two economic ledger transactions across webhook and reconcile",
  );
  context.progress("accepted but lost refund and original-provider recovery");
  const lostOrder = await createPaidAdminOrder(context, payment, {
    noMessage: true,
  });
  current = await detail(manager, lostOrder.orderId);
  const lostLine = current.items[0];
  await context.psp.arm({ operation: "REFUND_PAYMENT", mode: "AFTER" });
  const lost = await mutation(manager, "refund", {
    orderId: lostOrder.orderId,
    expectedOrderVersion: current.order.version,
    currency: current.order.currency,
    amountMinor: lostLine.availableAmountMinor,
    allocations: [
      {
        orderItemId: lostLine.orderItemId,
        amountMinor: lostLine.availableAmountMinor,
      },
    ],
  });
  current = await detail(manager, lostOrder.orderId);
  check(
    current.refunds[0].status === "UNKNOWN" &&
      current.order.availableRefundAmountMinor === 0,
    "lost accepted refund stays UNKNOWN and occupies the entire cap",
  );
  const acceptedCounts = await context.psp.counts();
  await context.psp.restart();
  await context.psp.settleRefund({
    refundId: lost.refundId,
    status: "SUCCEEDED",
  });
  await mutation(manager, "reconcile", {
    orderId: lostOrder.orderId,
    expectedOrderVersion: current.order.version,
    target: { kind: "REFUND", refundId: lost.refundId },
  });
  current = await detail(manager, lostOrder.orderId);
  check(
    current.order.paymentStatus === "REFUNDED" &&
      (await context.psp.counts()).refunds === acceptedCounts.refunds &&
      (await context.psp.counts()).refundCalls === acceptedCounts.refundCalls,
    "restarted independent PSP confirms original refund without another submission",
  );
  context.progress(
    "trusted failed refund releases capacity without replaying its request",
  );
  const failedOrder = await createPaidAdminOrder(context, payment, {
    noMessage: true,
  });
  current = await detail(manager, failedOrder.orderId);
  const failedKey = randomUUID(),
    failedBody = {
      orderId: failedOrder.orderId,
      expectedOrderVersion: current.order.version,
      currency: current.order.currency,
      amountMinor: current.order.availableRefundAmountMinor,
      allocations: current.items.map((line) => ({
        orderItemId: line.orderItemId,
        amountMinor: line.availableAmountMinor,
      })),
    };
  const failed = await mutation(manager, "refund", failedBody, {
    key: failedKey,
  });
  await context.psp.settleRefund({
    refundId: failed.refundId,
    status: "FAILED",
  });
  current = await detail(manager, failedOrder.orderId);
  await mutation(manager, "reconcile", {
    orderId: failedOrder.orderId,
    expectedOrderVersion: current.order.version,
    target: { kind: "REFUND", refundId: failed.refundId },
  });
  current = await detail(manager, failedOrder.orderId);
  check(
    current.refunds[0].status === "FAILED" &&
      current.refunds[0].processedAmountMinor === 0 &&
      current.order.occupiedRefundAmountMinor === 0 &&
      current.order.availableRefundAmountMinor ===
        current.order.capturedAmountMinor &&
      current.order.paymentStatus === "PAID",
    "only authenticated refund failure releases its full original capacity",
  );
  const afterFailed = await context.psp.counts();
  const failedReplay = await mutation(manager, "refund", failedBody, {
    key: failedKey,
  });
  check(
    failedReplay.replayed &&
      failedReplay.refundId === failed.refundId &&
      (await context.psp.counts()).refundCalls === afterFailed.refundCalls,
    "replaying a completed failed refund returns its permanent receipt without another PSP call",
  );
  check(
    (await runtime.readFacts(failedOrder.orderId)).attemptStatus ===
      "SUCCEEDED",
    "failed refund preserves captured payment success",
  );
  check(
    (
      await client.query(
        "SELECT count(*)::int count FROM payment_transactions WHERE payment_attempt_id=$1 AND transaction_type='REFUND'",
        [failedOrder.attempt.id],
      )
    ).rows[0].count === 0,
    "failed refund has no completed economic refund transaction",
  );
  const replacement = await mutation(manager, "refund", {
    ...failedBody,
    expectedOrderVersion: current.order.version,
  });
  check(
    replacement.refundId !== failed.refundId,
    "new confirmed request can use capacity released by a trusted failed refund",
  );
  await context.psp.settleRefund({
    refundId: replacement.refundId,
    status: "SUCCEEDED",
  });
  current = await detail(manager, failedOrder.orderId);
  await mutation(manager, "reconcile", {
    orderId: failedOrder.orderId,
    expectedOrderVersion: current.order.version,
    target: { kind: "REFUND", refundId: replacement.refundId },
  });
  check(
    (await detail(manager, failedOrder.orderId)).order.paymentStatus ===
      "REFUNDED",
    "replacement refund completes once against the original capture",
  );
  context.progress(
    "cancellation uses the original payment and trusted outcome",
  );
  const pending = await payment.fresh(),
    state = await payment.state(pending);
  current = await detail(manager, state.order_id);
  await mutation(manager, "cancel", {
    orderId: state.order_id,
    expectedOrderVersion: current.order.version,
  });
  await waitForOrderPayment(
    "cancellation applies trusted PSP evidence and releases order",
    async () => {
      await runtime.recover();
      const value = await detail(manager, state.order_id);
      return value.order.orderStatus === "CANCELED" ? value : null;
    },
    check,
  );
  check(
    (await payment.state(pending)).attempt_status === "CANCELED",
    "canceling original payment is confirmed by authenticated provider query",
  );
  context.progress("real signed dispute out-of-order projection");
  const disputed = await createPaidAdminOrder(context, payment, {
      noMessage: true,
    }),
    disputeId = randomUUID(),
    disputeAmount = Number(disputed.state.amount);
  await context.psp.settleDispute({
    attemptId: disputed.attempt.id,
    disputeId,
    status: "OPEN",
    amountMinor: disputeAmount,
  });
  const early = await context.signDisputeWebhook(disputeId);
  await context.psp.settleDispute({
    attemptId: disputed.attempt.id,
    disputeId,
    status: "LOST",
    amountMinor: disputeAmount,
  });
  check(
    (await context.sendWebhook(await context.signDisputeWebhook(disputeId)))
      .accepted,
    "late dispute terminal evidence is accepted before OPEN delivery",
  );
  await waitForOrderPayment(
    "terminal-first dispute applies without reversing capture",
    async () => {
      await worker.maintenance();
      const value = await detail(manager, disputed.orderId);
      return value.order.disputeStatus === "LOST" ? value : null;
    },
    check,
  );
  check(
    (await context.sendWebhook(early)).accepted,
    "late OPEN keeps auditable trusted evidence",
  );
  await worker.maintenance();
  current = await detail(manager, disputed.orderId);
  check(
    current.order.disputeStatus === "LOST" &&
      (await runtime.readFacts(disputed.orderId)).attemptStatus === "SUCCEEDED",
    "late dispute OPEN cannot reverse terminal outcome or captured payment",
  );
  const beforeDisputedRefund = await context.psp.counts();
  const disputedRefund = await mutation(
    manager,
    "refund",
    {
      orderId: disputed.orderId,
      expectedOrderVersion: current.order.version,
      amountMinor: 1,
      currency: current.order.currency,
      allocations: [
        { orderItemId: current.items[0].orderItemId, amountMinor: 1 },
      ],
    },
    { status: 409 },
  );
  check(
    disputedRefund.code === "DISPUTE_REQUIRES_REVIEW" &&
      (await context.psp.counts()).refunds === beforeDisputedRefund.refunds &&
      (await context.psp.counts()).refundCalls ===
        beforeDisputedRefund.refundCalls,
    "open or lost dispute requires review before another outgoing refund",
  );
  check(
    (await detail(manager, disputed.orderId)).order
      .occupiedRefundAmountMinor === 0,
    "rejected dispute refund does not occupy original refund capacity",
  );
  const list = await runtime.financeCommand(manager, "list", {
    schemaVersion: 1,
    page: 1,
    pageSize: 2,
    query: "",
    filter: "REFUNDS",
  });
  check(
    list.items.length <= 2 && list.totalItems >= 2,
    "finance view supports server paging and refund filtering",
  );
  await worker.stop();
  return {
    manager,
    paidOrderId: paid.orderId,
    lostOrderId: lostOrder.orderId,
    canceledOrderId: state.order_id,
    disputedOrderId: disputed.orderId,
    refunds: 5,
    actualPspSandbox: false,
  };
}
