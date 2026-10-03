import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createPostgresPersistence } from "../dist/index.js";
import {
  seedAdminOrdersRoles,
  createPaidAdminOrder,
} from "../../../apps/api/scripts/admin-orders-fixtures.mjs";
import { createOrderPaymentProtocolClient } from "../../../apps/api/scripts/order-payment-client.mjs";
const digest = () => randomBytes(32).toString("hex");
export async function verifyAdminFinance({ context }) {
  const { client, check, progress } = context,
    persistence = createPostgresPersistence(context.database, {
      catalogPublicMediaBaseUrl: context.gateway.origin,
    });
  const second = createPostgresPersistence(context.database, {
    catalogPublicMediaBaseUrl: context.gateway.origin,
  });
  const tx = (work, p = persistence) =>
    p.adminFinanceTransactionManager.runInAdminFinanceTransaction(work);
  const { actors } = await seedAdminOrdersRoles(client, {
    issuer: "https://finance-identity.example.test",
    subjectPepper: digest(),
  });
  await client.query(
    `INSERT INTO role_permissions(role_id,permission_id,granted_by) SELECT $1,id,$2 FROM permissions WHERE permission_key='finance.manage'`,
    [actors.manager.roleId, actors.manager.id],
  );
  const sessions = {};
  for (const name of ["manager", "order"]) {
    const sessionTokenDigest = digest(),
      csrfTokenDigest = digest();
    await client.query(
      `INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,expires_at) VALUES($1,$2,decode($3,'hex'),decode($4,'hex'),true,clock_timestamp()+interval '1 hour')`,
      [randomUUID(), actors[name].id, sessionTokenDigest, csrfTokenDigest],
    );
    sessions[name] = {
      schemaVersion: 1,
      sessionTokenDigest,
      csrfTokenDigest,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    };
  }
  const request = (command, who = "manager") => ({
    schemaVersion: 1,
    access: {
      ...sessions[who],
      requestId: randomUUID(),
      correlationId: randomUUID(),
    },
    command: { schemaVersion: 1, ...command },
    requestHash:
      "idempotencyKey" in command
        ? createHash("sha256").update(JSON.stringify(command)).digest("hex")
        : null,
  });
  const run = (command, who = "manager", p = persistence) => {
    progress(`finance ${command.action}`);
    return tx((r) => r.execute(request(command, who)), p);
  };
  const detail = (id) => run({ action: "DETAIL", orderId: id });
  const success = (r, label) => check(r.outcome === "SUCCESS", label);
  const fail = (r, code, label) =>
    check(r.outcome === "FAILURE" && r.code === code, label);
  const claim = (id, p = persistence, leaseDurationMs = 30000) =>
    tx(
      (r) =>
        r.claim({
          schemaVersion: 1,
          requestId: randomUUID(),
          correlationId: randomUUID(),
          leaseTokenDigest: digest(),
          leaseDurationMs,
          operationId: id,
        }),
      p,
    );
  const due = async (id) =>
    client.query(
      `UPDATE admin_finance_operations SET next_attempt_at=clock_timestamp() WHERE id=$1 AND phase<>'COMPLETE'`,
      [id],
    );
  async function reconcile(
    op,
    status,
    { eventId = randomUUID(), transactionRef = randomUUID() } = {},
  ) {
    await due(op.operationId);
    const c = await claim(op.operationId);
    check(
      c.command.operation === "RECONCILE_REFUND",
      "uncertain or accepted refund only reconciles",
    );
    const event = {
      schemaVersion: 1,
      eventType: "REFUND_STATUS",
      providerAccountId: c.command.providerAccountId,
      environment: c.command.environment,
      providerEventId: eventId,
      status,
      evidence: { kind: "AUTHENTICATED_RECONCILE", auditLogId: c.auditLogId },
      association: {
        status: "MATCHED",
        paymentAttemptId: c.command.paymentAttemptId,
        externalReference: c.command.externalReference,
      },
      refundReference: c.command.refundReference,
      amountMinor: c.command.amountMinor,
      currency: c.command.currency,
      occurredAt: new Date().toISOString(),
      ...(status === "SUCCEEDED"
        ? { transaction: { type: "REFUND", providerReference: transactionRef } }
        : {}),
    };
    const settled = await tx((r) =>
      r.settle({
        schemaVersion: 1,
        claim: c,
        retryAfterMs: 1000,
        result: {
          kind: "PROVIDER_RESULT",
          response: {
            schemaVersion: 1,
            operation: "RECONCILE_REFUND",
            outcome: "SUCCESS",
            value: { refundId: c.refundId, idempotencyKey: c.refundId, event },
          },
        },
      }),
    );
    check(
      settled.providerEventId,
      "trusted reconcile retained provider evidence",
    );
    const applied = await tx((r) =>
      r.apply({
        schemaVersion: 1,
        providerEventId: settled.providerEventId,
        requestId: randomUUID(),
        correlationId: randomUUID(),
        taskName: "finance-storage-test",
      }),
    );
    check(
      applied.decision === "APPLIED",
      "trusted refund evidence applies once",
    );
    return { event, settled };
  }
  async function evidence(
    attemptId,
    { type, status, reference, amountMinor, transaction },
  ) {
    const a = (
        await client.query("SELECT * FROM payment_attempts WHERE id=$1", [
          attemptId,
        ])
      ).rows[0],
      id = randomUUID(),
      audit = randomUUID();
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO audit_logs(id,actor_type,task_name,action,subject_type,subject_id,request_id,correlation_id,outcome) VALUES($1,'SYSTEM','finance-storage-test','PAYMENT_PROVIDER_RECONCILE','PAYMENT_PROVIDER_ACCOUNT',$2,$3,$4,'SUCCEEDED')`,
        [audit, a.provider_account_id, randomUUID(), randomUUID()],
      );
      const canonical = transaction
        ? (
            await client.query(
              `SELECT id FROM provider_events WHERE provider_account_id=$1 AND environment=$2 AND provider_transaction_type=$3 AND provider_transaction_reference=$4 AND canonical_transaction_event_id IS NULL`,
              [
                a.provider_account_id,
                a.environment,
                transaction.type,
                transaction.reference,
              ],
            )
          ).rows[0]?.id
        : null;
      await client.query(
        `INSERT INTO provider_events(id,provider_account_id,environment,provider_event_id,evidence_kind,reconcile_audit_log_id,event_type,normalized_status,external_payment_reference,provider_refund_reference,provider_dispute_reference,provider_transaction_type,provider_transaction_reference,amount_minor,currency,occurred_at,canonical_transaction_event_id) VALUES($1,$2,$3,$4,'AUTHENTICATED_RECONCILE',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,transaction_timestamp(),$15)`,
        [
          id,
          a.provider_account_id,
          a.environment,
          randomUUID(),
          audit,
          type,
          status,
          a.external_reference,
          type === "REFUND_STATUS" ? reference : null,
          type === "DISPUTE_STATUS" ? reference : null,
          transaction?.type ?? null,
          transaction?.reference ?? null,
          amountMinor ?? Number(a.amount_minor),
          a.currency,
          canonical ?? null,
        ],
      );
      await client.query(
        `INSERT INTO provider_event_associations(id,provider_event_id,association_status,payment_attempt_id,reason_code) VALUES($1,$2,'MATCHED',$3,'LOCAL_ACCEPTANCE')`,
        [randomUUID(), id, attemptId],
      );
      if (transaction && !canonical)
        await client.query(
          `INSERT INTO payment_transactions(id,payment_attempt_id,transaction_type,provider_transaction_reference,amount_minor,currency,evidence_kind,provider_event_id,reconcile_audit_log_id,occurred_at) SELECT $1,$2,provider_transaction_type,provider_transaction_reference,amount_minor,currency,evidence_kind,id,reconcile_audit_log_id,occurred_at FROM provider_events WHERE id=$3`,
          [randomUUID(), attemptId, id],
        );
      await client.query("COMMIT");
      return id;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  const apply = (id) =>
    tx((r) =>
      r.apply({
        schemaVersion: 1,
        providerEventId: id,
        requestId: randomUUID(),
        correlationId: randomUUID(),
        taskName: "finance-storage-test",
      }),
    );
  async function rejectsSql(sql, values, label) {
    await client.query("BEGIN");
    let rejected = false;
    try {
      await client.query(sql, values);
      await client.query("COMMIT");
    } catch (error) {
      rejected = ["23514", "55000"].includes(error.code);
      await client.query("ROLLBACK");
    }
    check(rejected, label);
  }
  try {
    progress("finance paid fixture");
    const payment = createOrderPaymentProtocolClient(context);
    const paid = await createPaidAdminOrder(context, payment, {
      noMessage: true,
    });
    let d = await detail(paid.orderId);
    success(d, "manager reads canonical finance");
    check(
      d.kind === "DETAIL" &&
        d.order.capturedAmountMinor === d.order.totalAmountMinor &&
        d.order.availableRefundAmountMinor === d.order.totalAmountMinor,
      "captured total comes from canonical payment",
    );
    const orderView = await run(
      { action: "DETAIL", orderId: paid.orderId },
      "order",
    );
    check(
      orderView.outcome === "SUCCESS" && orderView.canManage === false,
      "order operator can read but has no finance manage",
    );
    const firstItem = d.items[0],
      amount = Math.max(1, Math.floor(firstItem.availableAmountMinor / 3));
    const refundCommand = (amountMinor = amount) => ({
      action: "REFUND",
      orderId: paid.orderId,
      expectedOrderVersion: d.order.version,
      idempotencyKey: randomUUID(),
      reasonCode: "LOCAL_ACCEPTANCE",
      confirmed: true,
      currency: d.order.currency,
      amountMinor,
      allocations: [{ orderItemId: firstItem.orderItemId, amountMinor }],
    });
    fail(
      await run(refundCommand(), "order"),
      "FORBIDDEN",
      "order operator cannot issue refund",
    );
    fail(
      await run({
        ...refundCommand(),
        currency: d.order.currency === "USD" ? "THB" : "USD",
      }),
      "CURRENCY_MISMATCH",
      "original captured currency immutable",
    );
    fail(
      await run(refundCommand(d.order.totalAmountMinor + 1)),
      "REFUND_CAPACITY_EXCEEDED",
      "refund cannot exceed original capture",
    );
    const command = refundCommand();
    const op = await run(command);
    success(op, "refund request retained");
    let current = await detail(paid.orderId);
    check(
      current.refunds[0].status === "REQUESTED" &&
        current.order.occupiedRefundAmountMinor === amount,
      "requested refund occupies capacity before dispatch",
    );
    const replay = await run(command);
    check(
      replay.replayed &&
        replay.refundId === op.refundId &&
        replay.operationId === op.operationId,
      "same command replays original refund",
    );
    fail(
      await run({ ...command, reasonCode: "CHANGED_REQUEST" }),
      "IDEMPOTENCY_CONFLICT",
      "key reuse with changed command rejected",
    );
    const claims = await Promise.all([
      claim(op.operationId),
      claim(op.operationId, second),
    ]);
    check(
      claims.filter(Boolean).length === 1,
      "concurrent instances dispatch refund once",
    );
    const first = claims.find(Boolean);
    check(
      first.command.operation === "REFUND_PAYMENT" &&
        first.command.refundId === op.refundId &&
        first.command.idempotencyKey === op.refundId,
      "original refund and idempotency key frozen",
    );
    await tx((r) =>
      r.settle({
        schemaVersion: 1,
        claim: first,
        retryAfterMs: 1000,
        result: {
          kind: "UNCERTAIN",
          reasonCode: "PROVIDER_NETWORK_UNCERTAINTY",
        },
      }),
    );
    current = await detail(paid.orderId);
    check(
      current.refunds[0].status === "UNKNOWN" &&
        current.order.occupiedRefundAmountMinor === amount,
      "network ambiguity retains capacity",
    );
    const stale = await tx((r) =>
      r.settle({
        schemaVersion: 1,
        claim: first,
        retryAfterMs: 1000,
        result: {
          kind: "UNCERTAIN",
          reasonCode: "PROVIDER_NETWORK_UNCERTAINTY",
        },
      }),
    );
    check(
      stale.decision === "STALE",
      "settle replay cannot regain released fence",
    );
    progress("finance reconcile authorization and expiry after lock waits");
    const manual = await run({
      action: "RECONCILE",
      orderId: paid.orderId,
      expectedOrderVersion: current.order.version,
      idempotencyKey: randomUUID(),
      reasonCode: "LOCAL_ACCEPTANCE",
      confirmed: true,
      target: { kind: "REFUND", refundId: op.refundId },
    });
    check(
      manual.operationId === op.operationId,
      "manual reconcile reuses immutable refund operation",
    );
    for (const lockTable of ["admin_finance_operations", "orders"]) {
      await due(op.operationId);
      const leased = await claim(op.operationId, persistence, 1000);
      check(
        leased.command.operation === "RECONCILE_REFUND",
        "expired recovery lease never redispatches mutation",
      );
      const authorized = (
        await client.query(
          `SELECT count(*) n FROM audit_logs WHERE action='FINANCE_RECONCILE_DISPATCH_AUTHORIZED' AND subject_id=$1 AND request_id=$2`,
          [op.operationId, leased.requestId],
        )
      ).rows[0];
      check(
        Number(authorized.n) === 1,
        "reconcile dispatch has a durable separate authorization before PSP result",
      );
      await client.query("BEGIN");
      await client.query(`SELECT id FROM ${lockTable} WHERE id=$1 FOR UPDATE`, [
        lockTable === "orders" ? paid.orderId : op.operationId,
      ]);
      const blocked = tx(
        (r) =>
          r.settle({
            schemaVersion: 1,
            claim: leased,
            retryAfterMs: 1000,
            result: {
              kind: "UNCERTAIN",
              reasonCode: "PROVIDER_NETWORK_UNCERTAINTY",
            },
          }),
        second,
      );
      await client.query("SELECT pg_sleep(1.2)");
      await client.query("COMMIT");
      check(
        (await blocked).decision === "STALE",
        "settle rejects lease that expired while waiting for " + lockTable,
      );
      check(
        Number(
          (
            await client.query(
              "SELECT count(*) n FROM audit_logs WHERE id=$1",
              [leased.auditLogId],
            )
          ).rows[0].n,
        ) === 0,
        "stale lease cannot manufacture a successful or failed query result audit",
      );
      check(
        (await detail(paid.orderId)).refunds[0].status === "UNKNOWN",
        "expired lease preserves uncertain refund and amount hold",
      );
    }
    const before = (
      await client.query(
        `SELECT count(*) n FROM payment_transactions WHERE payment_attempt_id=$1 AND transaction_type='REFUND'`,
        [paid.attempt.id],
      )
    ).rows[0].n;
    const applied = await reconcile(op, "SUCCEEDED");
    current = await detail(paid.orderId);
    check(
      current.order.paymentStatus === "PARTIALLY_REFUNDED" &&
        current.order.refundedAmountMinor === amount,
      "partial refund updates order payment projection",
    );
    check(
      current.attempts.find((a) => a.attemptId === paid.attempt.id).status ===
        "SUCCEEDED",
      "refund never reverses successful payment attempt",
    );
    const duplicate = await tx((r) =>
      r.apply({
        schemaVersion: 1,
        providerEventId: applied.settled.providerEventId,
        requestId: randomUUID(),
        correlationId: randomUUID(),
        taskName: "finance-storage-test",
      }),
    );
    check(
      duplicate.decision === "ALREADY_APPLIED",
      "event replay observes permanent finance receipt",
    );
    check(
      Number(
        (
          await client.query(
            `SELECT count(*) n FROM payment_transactions WHERE payment_attempt_id=$1 AND transaction_type='REFUND'`,
            [paid.attempt.id],
          )
        ).rows[0].n,
      ) ===
        Number(before) + 1,
      "one refund creates exactly one economic ledger row",
    );
    // Two independent requests race for the same last item capacity. Only one is reserved.
    d = current;
    const remainder = current.items[0].availableAmountMinor;
    const outcomes = await Promise.all([
      run(refundCommand(remainder)),
      run(refundCommand(remainder), "manager", second),
    ]);
    check(
      outcomes.filter((r) => r.outcome === "SUCCESS").length === 1 &&
        outcomes.some((r) => r.code === "REFUND_CAPACITY_EXCEEDED"),
      "capture lock serializes competing total allocations",
    );
    const next = outcomes.find((r) => r.outcome === "SUCCESS");
    const dispatch = await claim(next.operationId);
    await tx((r) =>
      r.settle({
        schemaVersion: 1,
        claim: dispatch,
        retryAfterMs: 1000,
        result: {
          kind: "UNCERTAIN",
          reasonCode: "PROVIDER_NETWORK_UNCERTAINTY",
        },
      }),
    );
    await reconcile(next, "FAILED");
    current = await detail(paid.orderId);
    check(
      current.order.occupiedRefundAmountMinor === amount,
      "trusted failed refund releases only its own reserved amount",
    );
    d = current;
    const full = await run(
      refundCommand(current.items[0].availableAmountMinor),
    );
    const fullClaim = await claim(full.operationId);
    await tx((r) =>
      r.settle({
        schemaVersion: 1,
        claim: fullClaim,
        retryAfterMs: 1000,
        result: {
          kind: "UNCERTAIN",
          reasonCode: "PROVIDER_NETWORK_UNCERTAINTY",
        },
      }),
    );
    await reconcile(full, "SUCCEEDED");
    current = await detail(paid.orderId);
    check(
      current.order.paymentStatus === "REFUNDED" &&
        current.order.availableRefundAmountMinor === 0,
      "subsequent exact remainder completes full refund",
    );
    progress("finance cancellation without payment dispatch");
    const unattemptedSession = await payment.checkout.initialize("en");
    await payment.checkout.add(unattemptedSession, {});
    const ready = (await payment.checkout.validate(unattemptedSession)).data
      .preflight;
    const prepared = (
      await payment.checkout.create(
        unattemptedSession,
        ready,
        payment.canaries[2],
      )
    ).data.checkout;
    const unattempted = (
      await client.query("SELECT id FROM orders WHERE checkout_session_id=$1", [
        prepared.id,
      ])
    ).rows[0];
    const unattemptedDetail = await detail(unattempted.id);
    check(
      unattemptedDetail.canCancel && unattemptedDetail.attempts.length === 0,
      "unattempted checkout exposes safe cancellation",
    );
    success(
      await run({
        action: "CANCEL",
        orderId: unattempted.id,
        expectedOrderVersion: unattemptedDetail.order.version,
        idempotencyKey: randomUUID(),
        reasonCode: "LOCAL_ACCEPTANCE",
        confirmed: true,
      }),
      "unattempted checkout cancellation succeeds",
    );
    const canceled = (
      await client.query(
        `SELECT o.order_status,c.status cart_status,s.status session_status,NOT EXISTS(SELECT 1 FROM inventory_reservations r WHERE r.locked_order_id=o.id AND r.status='ACTIVE') released,NOT EXISTS(SELECT 1 FROM order_items i JOIN support_intents x ON x.id=i.support_intent_id WHERE i.order_id=o.id AND x.status<>'CANCELED') intents_closed FROM orders o JOIN carts c ON c.id=o.cart_id JOIN checkout_sessions s ON s.id=o.checkout_session_id WHERE o.id=$1`,
        [unattempted.id],
      )
    ).rows[0];
    check(
      canceled.order_status === "CANCELED" &&
        canceled.cart_status === "EXPIRED" &&
        canceled.session_status === "EXPIRED" &&
        canceled.released &&
        canceled.intents_closed,
      "local cancellation atomically closes checkout cart private intents and tracked holds",
    );
    progress("finance provider cancellation");
    const pending = await payment.fresh(),
      pendingDetail = (
        await client.query(
          "SELECT * FROM orders WHERE checkout_session_id=$1",
          [pending.checkout.id],
        )
      ).rows[0];
    const cancelOp = await run({
      action: "CANCEL",
      orderId: pendingDetail.id,
      expectedOrderVersion: Number(pendingDetail.version),
      idempotencyKey: randomUUID(),
      reasonCode: "LOCAL_ACCEPTANCE",
      confirmed: true,
    });
    success(cancelOp, "provider cancellation intent persists");
    const cancelClaim = await claim(cancelOp.operationId);
    check(
      cancelClaim.command.operation === "CANCEL_PAYMENT",
      "original payment account receives cancellation command",
    );
    await tx((r) =>
      r.settle({
        schemaVersion: 1,
        claim: cancelClaim,
        retryAfterMs: 1000,
        result: {
          kind: "UNCERTAIN",
          reasonCode: "PROVIDER_NETWORK_UNCERTAINTY",
        },
      }),
    );
    const stillPending = await detail(pendingDetail.id);
    check(
      stillPending.order.orderStatus === "PENDING_PAYMENT",
      "uncertain cancel preserves order and inventory lock",
    );
    const cancelEvent = await evidence(pending.attempt.id, {
      type: "PAYMENT_STATUS",
      status: "CANCELED",
      transaction: { type: "VOID", reference: randomUUID() },
    });
    const canceledResult = await apply(cancelEvent);
    check(
      canceledResult.decision === "APPLIED",
      "authenticated cancellation evidence applies",
    );
    check(
      (await detail(pendingDetail.id)).order.orderStatus === "CANCELED",
      "provider cancellation completes order lifecycle",
    );
    progress("finance dispute ledger and aggregate");
    const disputePaid = await createPaidAdminOrder(context, payment, {
      noMessage: true,
    });
    await detail(disputePaid.orderId);
    const chargeback = randomUUID(),
      disputeReference = randomUUID();
    const disputeOpen = await evidence(disputePaid.attempt.id, {
      type: "DISPUTE_STATUS",
      status: "OPEN",
      reference: disputeReference,
      transaction: { type: "CHARGEBACK", reference: chargeback },
    });
    check(
      (await apply(disputeOpen)).decision === "APPLIED",
      "trusted dispute opens from provider evidence",
    );
    let disputed = await detail(disputePaid.orderId);
    check(
      disputed.order.disputeStatus === "OPEN" &&
        disputed.attempts[0].status === "SUCCEEDED",
      "dispute projection is independent from capture status",
    );
    const attemptRefund = {
      action: "REFUND",
      orderId: disputePaid.orderId,
      expectedOrderVersion: disputed.order.version,
      idempotencyKey: randomUUID(),
      reasonCode: "LOCAL_ACCEPTANCE",
      confirmed: true,
      currency: disputed.order.currency,
      amountMinor: 1,
      allocations: [
        { orderItemId: disputed.items[0].orderItemId, amountMinor: 1 },
      ],
    };
    fail(
      await run(attemptRefund),
      "DISPUTE_REQUIRES_REVIEW",
      "open dispute prevents separate refund before occupying funds",
    );
    const disputeLost = await evidence(disputePaid.attempt.id, {
      type: "DISPUTE_STATUS",
      status: "LOST",
      reference: disputeReference,
      transaction: { type: "CHARGEBACK", reference: chargeback },
    });
    check(
      (await apply(disputeLost)).decision === "APPLIED",
      "later LOST shares economic chargeback with OPEN",
    );
    check(
      Number(
        (
          await client.query(
            `SELECT count(*) n FROM payment_transactions WHERE payment_attempt_id=$1 AND transaction_type='CHARGEBACK'`,
            [disputePaid.attempt.id],
          )
        ).rows[0].n,
      ) === 1,
      "OPEN and LOST record one chargeback economic transaction",
    );
    const earlyWon = await evidence(disputePaid.attempt.id, {
      type: "DISPUTE_STATUS",
      status: "WON",
      reference: randomUUID(),
      amountMinor: 1,
    });
    check(
      (await apply(earlyWon)).decision === "APPLIED",
      "early terminal dispute needs no synthetic OPEN evidence",
    );
    disputed = await detail(disputePaid.orderId);
    check(
      disputed.order.disputeStatus === "LOST" &&
        disputed.disputes.some((x) => x.status === "WON"),
      "LOST dominates another WON in the complete dispute projection",
    );
    await rejectsSql(
      `WITH changed AS(UPDATE orders SET dispute_status='WON',version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *) INSERT INTO order_events(id,order_id,sequence,event_type,from_order_status,to_order_status,from_payment_status,to_payment_status,from_dispute_status,to_dispute_status,from_fulfillment_status,to_fulfillment_status,from_payment_attempt_id,to_payment_attempt_id,authority_kind,provider_event_id,reason_code,request_id,correlation_id) SELECT gen_random_uuid(),id,version,'DISPUTE_STATUS_CHANGED',order_status,order_status,payment_status,payment_status,'LOST','WON',fulfillment_status,fulfillment_status,current_payment_attempt_id,current_payment_attempt_id,'PROVIDER_EVIDENCE',$2,'LOCAL_ACCEPTANCE',gen_random_uuid(),gen_random_uuid() FROM changed`,
      [disputePaid.orderId, earlyWon],
      "SQL bypass cannot replace actual LOST aggregate with WON even with an authentic WON event and contiguous order history",
    );
    const lateOpen = await evidence(disputePaid.attempt.id, {
      type: "DISPUTE_STATUS",
      status: "OPEN",
      reference: disputeReference,
      transaction: { type: "CHARGEBACK", reference: chargeback },
    });
    check(
      (await apply(lateOpen)).decision === "IGNORED",
      "delayed OPEN never reopens terminal LOST",
    );
    const contradict = await evidence(disputePaid.attempt.id, {
      type: "DISPUTE_STATUS",
      status: "WON",
      reference: disputeReference,
    });
    check(
      (await apply(contradict)).decision === "REVIEW",
      "mutually exclusive terminal dispute evidence requires review",
    );
    check(
      (await detail(disputePaid.orderId)).issues.length > 0,
      "financial contradictions appear in authorized reconciliation view",
    );
    check(
      Number(
        (
          await client.query(
            `SELECT count(*) n FROM audit_logs WHERE subject_id=$1 AND action='FINANCE_EVIDENCE_REVIEW_REQUIRED'`,
            [disputePaid.orderId],
          )
        ).rows[0].n,
      ) > 0,
      "financial review decision retains explicit audit evidence",
    );
    progress("finance wrong refund correlation");
    const otherPaid = await createPaidAdminOrder(context, payment, {
      noMessage: true,
    });
    const wrong = await evidence(otherPaid.attempt.id, {
      type: "REFUND_STATUS",
      status: "PROCESSING",
      reference: op.refundId,
      amountMinor: amount,
    });
    check(
      (await apply(wrong)).decision === "REVIEW",
      "same account equal currency refund reference cannot target another captured order",
    );
    check(
      (await detail(otherPaid.orderId)).order.occupiedRefundAmountMinor === 0,
      "mismatched evidence cannot reserve or refund another order",
    );
    progress(
      "finance fulfillment pauses and resumes from actual financial state",
    );
    const orderRun = (command) =>
      persistence.adminOrdersTransactionManager.runInAdminOrdersTransaction(
        ({ adminOrders }) => adminOrders.execute(request(command)),
      );
    const orderDetail = (id) => orderRun({ action: "DETAIL", orderId: id });
    const fulfillmentCommand = (view, action) => ({
      action,
      orderId: view.orderId,
      expectedOrderVersion: view.version,
      fulfillmentId: view.items[0].fulfillmentId,
      expectedFulfillmentVersion: view.items[0].fulfillmentVersion,
      reasonCode: "LOCAL_ACCEPTANCE",
      idempotencyKey: randomUUID(),
      ...(["HOLD", "RESUME"].includes(action) ? { confirmed: true } : {}),
    });
    let fulfillment = await orderDetail(otherPaid.orderId);
    success(
      await orderRun(fulfillmentCommand(fulfillment, "HOLD")),
      "Manager holds pending fulfillment before financial review",
    );
    const holdView = await detail(otherPaid.orderId);
    const heldRefund = await run({
      action: "REFUND",
      orderId: otherPaid.orderId,
      expectedOrderVersion: holdView.order.version,
      idempotencyKey: randomUUID(),
      reasonCode: "LOCAL_ACCEPTANCE",
      confirmed: true,
      currency: holdView.order.currency,
      amountMinor: 1,
      allocations: [
        { orderItemId: holdView.items[0].orderItemId, amountMinor: 1 },
      ],
    });
    success(heldRefund, "held fulfillment allows finance refund request");
    fulfillment = await orderDetail(otherPaid.orderId);
    check(
      (await orderRun(fulfillmentCommand(fulfillment, "RESUME"))).outcome ===
        "FAILURE",
      "active refund prevents Manager resume",
    );
    for (const target of ["PENDING", "PREPARING", "DELIVERED"])
      await rejectsSql(
        `UPDATE fulfillments SET status=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1`,
        [fulfillment.items[0].fulfillmentId, target],
        "SQL bypass cannot advance fulfillment to " +
          target +
          " during active refund",
      );
    const unavailableClaim = await claim(heldRefund.operationId);
    await tx((r) =>
      r.settle({
        schemaVersion: 1,
        claim: unavailableClaim,
        retryAfterMs: 1000,
        result: { kind: "UNCERTAIN", reasonCode: "PROVIDER_UNAVAILABLE" },
      }),
    );
    await due(heldRefund.operationId);
    const retryUnsent = await claim(heldRefund.operationId);
    check(
      retryUnsent.command.operation === "REFUND_PAYMENT" &&
        retryUnsent.command.idempotencyKey ===
          unavailableClaim.command.idempotencyKey,
      "explicit provider-not-called result permits only the original mutation key",
    );
    await tx((r) =>
      r.settle({
        schemaVersion: 1,
        claim: retryUnsent,
        retryAfterMs: 1000,
        result: {
          kind: "UNCERTAIN",
          reasonCode: "PROVIDER_NETWORK_UNCERTAINTY",
        },
      }),
    );
    await reconcile(heldRefund, "FAILED");
    fulfillment = await orderDetail(otherPaid.orderId);
    success(
      await orderRun(fulfillmentCommand(fulfillment, "RESUME")),
      "trusted FAILED refund releases financial fulfillment pause",
    );
    fulfillment = await orderDetail(otherPaid.orderId);
    success(
      await orderRun(fulfillmentCommand(fulfillment, "PREPARE")),
      "normal preparation remains available after failed refund",
    );
    const wonRef = randomUUID();
    check(
      (
        await apply(
          await evidence(otherPaid.attempt.id, {
            type: "DISPUTE_STATUS",
            status: "OPEN",
            reference: wonRef,
          }),
        )
      ).decision === "APPLIED",
      "fulfillment order enters real dispute",
    );
    fulfillment = await orderDetail(otherPaid.orderId);
    check(
      (await orderRun(fulfillmentCommand(fulfillment, "DELIVER"))).outcome ===
        "FAILURE",
      "OPEN dispute prevents delivery",
    );
    await rejectsSql(
      `UPDATE fulfillments SET status='DELIVERED',version=version+1,updated_at=clock_timestamp() WHERE id=$1`,
      [fulfillment.items[0].fulfillmentId],
      "SQL cannot bypass open dispute delivery hold",
    );
    check(
      (
        await apply(
          await evidence(otherPaid.attempt.id, {
            type: "DISPUTE_STATUS",
            status: "WON",
            reference: wonRef,
          }),
        )
      ).decision === "APPLIED",
      "trusted WON resolves dispute",
    );
    fulfillment = await orderDetail(otherPaid.orderId);
    check(
      (
        await client.query("SELECT status FROM fulfillments WHERE id=$1", [
          fulfillment.items[0].fulfillmentId,
        ])
      ).rows[0].status === "PREPARING",
      "winning dispute never automatically advances fulfillment",
    );
    success(
      await orderRun(fulfillmentCommand(fulfillment, "DELIVER")),
      "authorized delivery resumes after WON when no active refund remains",
    );
    progress("finance partial refund keeps the other paid lines moving");
    const twoLines = await createPaidAdminOrder(context, payment, {
      noMessage: true,
      lines: [{}, { artist: context.fixtures.artists[1] }],
    });
    const settleLineRefund = async (orderItemId, amountMinor) => {
      const view = await detail(twoLines.orderId);
      const requested = await run({
        action: "REFUND",
        orderId: twoLines.orderId,
        expectedOrderVersion: view.order.version,
        idempotencyKey: randomUUID(),
        reasonCode: "LOCAL_ACCEPTANCE",
        confirmed: true,
        currency: view.order.currency,
        amountMinor,
        allocations: [{ orderItemId, amountMinor }],
      });
      success(requested, "line refund request retained");
      const dispatched = await claim(requested.operationId);
      await tx((r) =>
        r.settle({
          schemaVersion: 1,
          claim: dispatched,
          retryAfterMs: 1000,
          result: {
            kind: "UNCERTAIN",
            reasonCode: "PROVIDER_NETWORK_UNCERTAINTY",
          },
        }),
      );
      await reconcile(requested, "SUCCEEDED");
    };
    const lineCommand = (view, item, action) => ({
      action,
      orderId: view.orderId,
      expectedOrderVersion: view.version,
      fulfillmentId: item.fulfillmentId,
      expectedFulfillmentVersion: item.fulfillmentVersion,
      reasonCode: "LOCAL_ACCEPTANCE",
      idempotencyKey: randomUUID(),
    });
    const split = await detail(twoLines.orderId);
    const [lineA, lineB] = split.items;
    check(
      split.items.length === 2 && lineA.availableAmountMinor >= 2,
      "two refundable lines for the partial refund scenario",
    );
    const half = Math.floor(lineA.availableAmountMinor / 2);
    await settleLineRefund(lineA.orderItemId, half);
    let lines = await orderDetail(twoLines.orderId);
    check(
      (await detail(twoLines.orderId)).order.paymentStatus ===
        "PARTIALLY_REFUNDED" &&
        lines.items.every((item) => item.allowedActions.includes("PREPARE")),
      "a partial line refund leaves every line of the order preparable",
    );
    await settleLineRefund(
      lineA.orderItemId,
      (await detail(twoLines.orderId)).items.find(
        (item) => item.orderItemId === lineA.orderItemId,
      ).availableAmountMinor,
    );
    lines = await orderDetail(twoLines.orderId);
    const refundedA = lines.items.find(
        (item) => item.itemId === lineA.orderItemId,
      ),
      remainingB = lines.items.find(
        (item) => item.itemId === lineB.orderItemId,
      );
    check(
      refundedA.allowedActions.length === 0 &&
        remainingB.allowedActions.includes("PREPARE"),
      "a line refunded in full stops while the other paid line stays preparable",
    );
    fail(
      await orderRun(lineCommand(lines, refundedA, "PREPARE")),
      "TRANSITION_NOT_ALLOWED",
      "a line refunded in full cannot be prepared through the repository",
    );
    success(
      await orderRun(lineCommand(lines, remainingB, "PREPARE")),
      "the remaining paid line is prepared after the other line's full refund",
    );
    lines = await orderDetail(twoLines.orderId);
    success(
      await orderRun(
        lineCommand(
          lines,
          lines.items.find((item) => item.itemId === lineB.orderItemId),
          "DELIVER",
        ),
      ),
      "the remaining paid line is delivered after the other line's full refund",
    );
    check(
      (await detail(twoLines.orderId)).order.paymentStatus ===
        "PARTIALLY_REFUNDED",
      "fulfillment never rewrites the partial refund projection",
    );
    progress("finance immutable receipts and authority");
    for (const action of ["CANCEL", "RECONCILE"])
      await rejectsSql(
        `WITH source AS(SELECT r.*,a.action audit_action FROM admin_finance_receipts r JOIN audit_logs a ON a.id=r.audit_log_id WHERE r.action=$1 LIMIT 1), changed_audit AS(INSERT INTO audit_logs SELECT (jsonb_populate_record(NULL::audit_logs,to_jsonb(a)||jsonb_build_object('id',$2::uuid,'action','UNRELATED_ACTION','created_at',transaction_timestamp()))).* FROM source s JOIN audit_logs a ON a.id=s.audit_log_id RETURNING id) INSERT INTO admin_finance_receipts SELECT (jsonb_populate_record(NULL::admin_finance_receipts,to_jsonb(s)||jsonb_build_object('id',gen_random_uuid(),'audit_log_id',a.id,'idempotency_key',gen_random_uuid()::text,'created_at',transaction_timestamp(),'expected_order_version',o.version-CASE WHEN s.action='CANCEL' AND x.phase='COMPLETE' AND o.order_status='CANCELED' THEN 1 ELSE 0 END))).* FROM source s JOIN changed_audit a ON true JOIN orders o ON o.id=s.order_id JOIN admin_finance_operations x ON x.id=s.operation_id`,
        [action, randomUUID()],
        action + " receipt cannot use unrelated successful admin audit",
      );

    await rejectsSql(
      `DELETE FROM admin_finance_receipts WHERE operation_id=$1`,
      [op.operationId],
      "financial command receipts cannot be deleted",
    );
    await rejectsSql(
      `UPDATE refunds SET requested_amount_minor=requested_amount_minor+1 WHERE id=$1`,
      [op.refundId],
      "successful refund capture binding and amount remain immutable",
    );

    await persistence.close();
    await second.close();
    return { status: "PASS" };
  } finally {
    await persistence.close();
    await second.close();
  }
}
