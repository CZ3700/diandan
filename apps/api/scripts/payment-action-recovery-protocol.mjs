import { randomUUID } from "node:crypto";
import {
  createOrderPaymentProtocolClient,
  waitForOrderPayment,
} from "./order-payment-client.mjs";

/** Actual checkout/API/PG and owned TLS PSP; expiry uses the unchanged database clock. */
export async function verifyPaymentActionRecovery(context) {
  const { client, check, progress, psp } = context;
  const actionTtlMs =
    context.paymentActionTtlMs ?? context.configuration.actionTtlMs;
  const orders = createOrderPaymentProtocolClient(context);
  const payment = orders.payment;
  const scalar = async (sql, values) =>
    (await client.query(sql, values)).rows[0];
  const read = async (value) =>
    (await payment.read(value.session, value.checkout.id, value.attempt.id))
      .data.attempt;
  const recover = async (value, options) =>
    payment.recover(
      value.session,
      value.checkout.id,
      value.attempt.id,
      options,
    );
  const frozen = async (value) =>
    scalar(
      `SELECT a.order_id,a.provider_account_id,a.environment,a.external_reference,a.amount_minor::text,a.currency,
       a.requested_locale,a.provider_locale,a.provider_locale_fallback_used,o.presentation_locale,
       (SELECT count(*)::int FROM payment_attempts same WHERE same.order_id=o.id) attempts,
       (SELECT count(*)::int FROM payment_create_receipts r WHERE r.attempt_id=a.id) receipts
       FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE a.id=$1`,
      [value.attempt.id],
    );
  const waitExpired = (value) =>
    waitForOrderPayment(
      "action authorization actually expires under PostgreSQL clock",
      async () =>
        (
          await scalar(
            "SELECT action_expires_at<=clock_timestamp() expired FROM payment_attempts WHERE id=$1",
            [value.attempt.id],
          )
        )?.expired,
      check,
      { timeoutMs: actionTtlMs + 10_000 },
    );
  const waitDue = (value) =>
    waitForOrderPayment(
      "existing recovery operation reaches its normal due time and lease",
      async () =>
        (
          await scalar(
            "SELECT phase='RECONCILE' AND next_attempt_at<=clock_timestamp() AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) due FROM payment_runtime_operations WHERE attempt_id=$1",
            [value.attempt.id],
          )
        )?.due,
      check,
    );
  async function noSecondPayment(value, prior, counts) {
    const current = await frozen(value),
      actual = await psp.counts();
    check(
      JSON.stringify(current) === JSON.stringify(prior),
      "recovery preserves one order, one attempt, one create receipt and frozen money/account/locale",
    );
    check(
      current.attempts === 1 && current.receipts === 1,
      "recovery never creates a replacement attempt or receipt",
    );
    check(
      actual.payments === counts.payments &&
        actual.createCalls === counts.createCalls,
      "recovery never submits another PSP creation",
    );
  }

  progress(
    "valid and expired hosted authorization stay on the original attempt",
  );
  const open = await orders.fresh({ locale: "ja" });
  const original = await frozen(open),
    initialCounts = await psp.counts();
  const originalUrl = open.attempt.action.url;
  check(
    (await read(open)).action?.url === originalUrl,
    "fresh status returns the original authorized hosted action",
  );
  check(
    JSON.stringify(await psp.counts()) === JSON.stringify(initialCounts),
    "read-only status makes no PSP request",
  );
  await waitExpired(open);
  const expired = await read(open);
  check(
    expired.actionExpired && expired.action === undefined && !expired.canRetry,
    "expired authorization hides the URL without permitting a second payment",
  );
  await waitDue(open);
  const recovered = (await recover(open)).data.attempt;
  check(
    recovered.id === open.attempt.id &&
      recovered.status === "REQUIRES_ACTION" &&
      !recovered.actionExpired &&
      recovered.action?.url === originalUrl,
    "authenticated recovery restores the same hosted session action on the same attempt",
  );
  check(
    Date.parse(recovered.actionExpiresAt) >
      Date.parse(open.attempt.actionExpiresAt),
    "new action authorization has a freshly verified bounded expiry",
  );
  await noSecondPayment(open, original, initialCounts);

  progress(
    "concurrent second recovery is fenced and preserves the same PSP payment",
  );
  await waitExpired(open);
  await waitDue(open);
  const concurrentBefore = await psp.counts();
  const concurrent = await Promise.all(
    Array.from({ length: 6 }, () =>
      recover(open, { key: randomUUID(), expected: [200, 409, 503] }),
    ),
  );
  check(
    concurrent.every(
      ({ data }) =>
        data.outcome === "SUCCESS" ||
        [
          "PAYMENT_IN_PROGRESS",
          "TRANSACTION_OUTCOME_UNKNOWN",
          "IDEMPOTENCY_IN_PROGRESS",
          "VERSION_CONFLICT",
        ].includes(data.code),
    ),
    "concurrent recover returns only success or explicit contention",
  );
  const afterConcurrent = await read(open);
  check(
    afterConcurrent.action?.url === originalUrl &&
      !afterConcurrent.actionExpired,
    "concurrent recover leaves one usable original-session action",
  );
  check(
    (await psp.counts()).reconcileCalls === concurrentBefore.reconcileCalls + 1,
    "six simultaneous recovery requests perform one fenced authenticated query",
  );
  await noSecondPayment(open, original, initialCounts);

  progress("foreign cart and forged CSRF cannot renew an action");
  const foreign = await orders.checkout.initialize("en");
  const beforeDenied = await psp.counts();
  await payment.recover(foreign, open.checkout.id, open.attempt.id, {
    expected: 404,
    code: "ATTEMPT_NOT_FOUND",
  });
  await recover(open, {
    headers: { "x-csrf-token": randomUUID() },
    expected: 403,
    code: "INVALID_ACCESS",
  });
  check(
    JSON.stringify(await psp.counts()) === JSON.stringify(beforeDenied),
    "unauthorized recovery never reaches the PSP",
  );

  progress("failed observations never revive an expired authorization");
  const failed = await orders.fresh({ locale: "zh-CN" });
  const failedFrozen = await frozen(failed),
    failedCounts = await psp.counts();
  await waitExpired(failed);
  await waitDue(failed);
  await psp.arm({ operation: "RECONCILE_PAYMENT", mode: "BEFORE" });
  const unavailable = (await recover(failed)).data.attempt;
  check(
    unavailable.action === undefined && !unavailable.canRetry,
    "unavailable reconcile preserves no-action and no-second-payment state",
  );
  await waitDue(failed);
  await psp.arm({ operation: "GET_PAYMENT", mode: "MALFORMED" });
  const malformed = (await recover(failed)).data.attempt;
  check(
    malformed.action === undefined && !malformed.canRetry,
    "malformed hosted action cannot revive an expired URL",
  );
  await waitDue(failed);
  const repaired = (await recover(failed)).data.attempt;
  check(
    repaired.action?.url === failed.attempt.action.url &&
      !repaired.actionExpired,
    "later healthy query safely restores the same session",
  );
  await noSecondPayment(failed, failedFrozen, failedCounts);

  const terminals = [];
  for (const status of ["EXPIRED", "SUCCEEDED"]) {
    progress(`provider ${status} cannot revive an expired hosted action`);
    const value = await orders.fresh();
    const before = await frozen(value),
      counts = await psp.counts();
    await orders.settle(value, status);
    await waitExpired(value);
    await waitDue(value);
    const terminal = (await recover(value)).data.attempt;
    check(
      terminal.action === undefined,
      "trusted terminal observation never returns the old hosted action",
    );
    check(
      status === "EXPIRED"
        ? terminal.status === "EXPIRED"
        : terminal.recovery === "EVIDENCE_PENDING",
      "terminal recovery reports expiry or pending trusted payment application",
    );
    const evidence = await scalar(
      `SELECT e.id FROM provider_events e JOIN provider_event_associations a ON a.provider_event_id=e.id
       WHERE a.payment_attempt_id=$1 AND a.association_status='MATCHED' AND e.evidence_kind='AUTHENTICATED_RECONCILE' AND e.normalized_status=$2 ORDER BY e.normalized_at DESC,e.id DESC LIMIT 1`,
      [value.attempt.id, status],
    );
    check(
      Boolean(evidence),
      "terminal result has actual authenticated evidence before application",
    );
    const applied = await orders.apply(evidence.id);
    check(
      applied.decision === "APPLIED",
      "existing order payment application consumes the authenticated terminal evidence",
    );
    if (status === "SUCCEEDED") await orders.assertPaid(value);
    const replay = await orders.apply(evidence.id);
    check(
      replay.decision === "ALREADY_APPLIED",
      "terminal evidence replay cannot repeat fulfillment or capture effects",
    );
    await noSecondPayment(value, before, counts);
    terminals.push(status);
  }

  return {
    schemaVersion: 1,
    status: "PASS",
    actionTtlMs,
    freshReadsAreLocal: true,
    actualExpiry: true,
    repeatedRecovery: true,
    concurrentRecoveries: 6,
    deniedWithoutProviderCalls: true,
    malformedAndUnavailableFailClosed: true,
    terminals,
    sameAttemptAndPspSession: true,
    scope:
      "Actual owned API/PostgreSQL/TLS TEST PSP; no external merchant call or real funds",
  };
}
