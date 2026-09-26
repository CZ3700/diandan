import { randomUUID } from "node:crypto";
import { createLocalAdminFinanceComposition } from "../dist/testing/admin-finance-composition.js";
import { createAdminOrdersRuntime } from "./admin-orders-runtime.mjs";
import { createPaidAdminOrder } from "./admin-orders-fixtures.mjs";
import { observeFinanceBrowserSession } from "./admin-finance-diagnostics.mjs";
import {
  createFinanceBrowserSessionClock,
  createFinanceTokenClock,
} from "./admin-finance-session-clock.mjs";
/** Normal OIDC, existing management center and provider-bound financial application. */
export async function createAdminFinanceFixture(context, payment) {
  let finance, observeSession, sessionClock;
  const runtime = await createAdminOrdersRuntime(context, {
    beforeValidTokenResponse: createFinanceTokenClock({
      client: context.client,
      check: context.check,
    }),
    async seedAdditionalRoles({ client, actors }) {
      await client.query(
        "INSERT INTO role_permissions(role_id,permission_id,granted_by) SELECT $1,id,$2 FROM permissions WHERE permission_key='finance.manage' ON CONFLICT DO NOTHING",
        [actors.manager.roleId, actors.manager.id],
      );
    },
    composeAdditional({ tokenPepper, adminOrigin }) {
      observeSession = observeFinanceBrowserSession({
        client: context.client,
        tokenPepper,
        own: context.own,
      });
      sessionClock = createFinanceBrowserSessionClock({
        client: context.client,
        tokenPepper,
        check: context.check,
      });
      finance = createLocalAdminFinanceComposition({
        environment: "LOCAL_OIDC",
        database: context.database,
        tokenPepper,
        allowedOrigin: adminOrigin,
        providers: [context.providerRegistration],
        leaseMs: 2000,
        retryAfterMs: 1000,
        batchSize: 10,
      });
      // Protocol and browser own each recovery tick; the lifecycle is verified independently.
      return {
        ...finance,
        adminFinanceRuntime: {
          start: async () => undefined,
          stop: () => finance.adminFinanceRuntime.stop(),
        },
      };
    },
  });
  payment.canaries.forEach(runtime.registerSecret);
  const detail = (session, orderId) =>
    runtime.financeCommand(session, "detail", { schemaVersion: 1, orderId });
  const mutation = (session, path, body, options = {}) =>
    runtime.financeCommand(
      session,
      path,
      {
        schemaVersion: 1,
        reasonCode: "LOCAL_ACCEPTANCE",
        confirmed: true,
        ...body,
      },
      { key: randomUUID(), ...options },
    );
  const recover = async () => {
    await finance.adminFinanceRoute.useCases.recoverNext();
    return finance.adminFinanceRoute.useCases.runPending(100);
  };
  const readFacts = async (orderId) => {
    const row = (
      await context.client.query(
        "SELECT (SELECT count(*)::int FROM refunds WHERE order_id=o.id) refund_count,(SELECT count(*)::int FROM refunds WHERE order_id=o.id AND status NOT IN('SUCCEEDED','FAILED')) pending,(SELECT count(*)::int FROM refunds WHERE order_id=o.id AND status='SUCCEEDED') successful,a.status attempt_status FROM orders o LEFT JOIN payment_attempts a ON a.id=o.current_payment_attempt_id WHERE o.id=$1",
        [orderId],
      )
    ).rows[0];
    return {
      refundCount: row.refund_count,
      pending: row.pending,
      successful: row.successful,
      attemptStatus: row.attempt_status,
    };
  };
  async function createBrowserFixtures(manager, disputeOrderId) {
    const paid = await createPaidAdminOrder(context, payment, {
        noMessage: true,
        lines: [{}, { artist: context.fixtures.artists[1] }],
      }),
      unknown = await createPaidAdminOrder(context, payment, {
        noMessage: true,
      }),
      cancel = await payment.fresh();
    const noAttemptSession = await payment.checkout.initialize("en");
    await payment.checkout.add(noAttemptSession, {});
    const noAttemptPreflight = (
      await payment.checkout.validate(noAttemptSession)
    ).data.preflight;
    const noAttemptCheckout = (
      await payment.checkout.create(
        noAttemptSession,
        noAttemptPreflight,
        payment.canaries[2],
      )
    ).data.checkout;
    const noAttempt = (
      await context.client.query(
        "SELECT id,public_order_id FROM orders WHERE checkout_session_id=$1",
        [noAttemptCheckout.id],
      )
    ).rows[0];
    context.check(
      (await detail(manager, noAttempt.id)).canCancel,
      "normally created order without a provider attempt can be canceled locally",
    );
    const pending = await detail(manager, unknown.orderId),
      line = pending.items[0];
    await context.psp.arm({ operation: "REFUND_PAYMENT", mode: "AFTER" });
    const receipt = await mutation(manager, "refund", {
      orderId: unknown.orderId,
      expectedOrderVersion: pending.order.version,
      amountMinor: line.availableAmountMinor,
      currency: pending.order.currency,
      allocations: [
        {
          orderItemId: line.orderItemId,
          amountMinor: line.availableAmountMinor,
        },
      ],
    });
    const cancelState = await payment.state(cancel),
      final = await detail(manager, unknown.orderId);
    const dispute = (
      await context.client.query(
        "SELECT public_order_id FROM orders WHERE id=$1",
        [disputeOrderId],
      )
    ).rows[0];
    context.check(
      final.refunds.some(
        (r) => r.refundId === receipt.refundId && r.status === "UNKNOWN",
      ),
      "browser UNKNOWN is an actual accepted-but-lost provider refund",
    );
    return {
      mediaOrigins: [context.gateway.origin],
      paidOrderId: paid.orderId,
      paidPublicOrderId: paid.checkout.publicOrderId,
      unknownOrderId: unknown.orderId,
      unknownPublicOrderId: unknown.checkout.publicOrderId,
      cancelOrderId: cancelState.order_id,
      cancelPublicOrderId: cancel.checkout.publicOrderId,
      noAttemptOrderId: noAttempt.id,
      noAttemptPublicOrderId: noAttempt.public_order_id,
      currency: pending.order.currency,
      disputeOrderId,
      disputePublicOrderId: dispute.public_order_id,
    };
  }
  return {
    ...runtime,
    authenticate: async (page, role, locale) => {
      observeSession(page);
      const releaseClock = await sessionClock.install(page);
      try {
        await runtime.authenticate(page, role, locale);
      } finally {
        await releaseClock();
      }
    },
    detail,
    mutation,
    recover,
    readFacts,
    createBrowserFixtures,
    prepareReconcile: (refundId) =>
      context.psp.settleRefund({ refundId, status: "SUCCEEDED" }),
  };
}
