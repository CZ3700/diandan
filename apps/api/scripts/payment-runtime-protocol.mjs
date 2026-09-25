import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createCheckoutProtocolClient } from "./checkout-preflight-client.mjs";
import { createPaymentProtocolClient } from "./payment-runtime-client.mjs";

export async function verifyPaymentRuntimeProtocol(context) {
  const { check, client, psp } = context;
  const canaries = [
    `private-${randomUUID()}`,
    `name-${randomUUID().slice(0, 12)}`,
    `test-${randomUUID()}@example.invalid`,
  ];
  const checkoutClient = createCheckoutProtocolClient({ ...context, canaries });
  const payment = createPaymentProtocolClient({ ...context, canaries });
  async function checkout(locale = "en", checkoutBase) {
    const session = await checkoutClient.initialize(locale);
    const empty = await payment.current(session);
    check(
      empty.data.action === "EMPTY",
      "Fresh authenticated cart has no fabricated checkout or payment",
    );
    await checkoutClient.add(session);
    const validated = await checkoutClient.validate(
      session,
      checkoutBase ? { target: checkoutBase } : {},
    );
    const created = await checkoutClient.create(
      session,
      validated.data.preflight,
      canaries[2],
      checkoutBase ? { target: checkoutBase } : {},
    );
    check(
      created.data.action === "CREATED",
      "Payment uses a normally accepted checkout with encrypted contact and actual reservations",
    );
    const recovered = await payment.current(session);
    check(
      recovered.data.action === "CURRENT" &&
        recovered.data.checkout.id === created.data.checkout.id &&
        recovered.data.attempt === null,
      "Cookie alone recovers the authoritative checkout before payment",
    );
    return { session, checkout: created.data.checkout };
  }
  async function stored(attemptId) {
    const {
      rows: [row],
    } = await client.query(
      `SELECT a.status,a.version,a.requested_locale,a.provider_locale,a.provider_locale_fallback_used,a.amount_minor::text,a.currency,a.provider_call_started,o.payment_status,o.order_status,(SELECT count(*)::int FROM payment_create_receipts r WHERE r.attempt_id=a.id) AS receipts,(SELECT count(*)::int FROM payment_attempt_events e WHERE e.payment_attempt_id=a.id) AS events,(SELECT count(*)::int FROM outbox_events b WHERE b.event_type='PAYMENT_STATUS_CHANGED' AND b.aggregate_id=a.id) AS outbox FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE a.id=$1::uuid`,
      [attemptId],
    );
    check(
      row &&
        row.receipts === 1 &&
        row.events === Number(row.version) &&
        row.outbox === row.events,
      "Actual attempt has one permanent create receipt and exact event/outbox per version",
    );
    check(
      row.payment_status === "PENDING" &&
        row.order_status === "PENDING_PAYMENT",
      "P4-04 does not fabricate paid order aggregates",
    );
    return row;
  }
  const locales = [];
  await payment.current(undefined, { expected: 401, code: "INVALID_ACCESS" });
  for (const locale of SUPPORTED_LOCALES) {
    const value = await checkout(locale);
    const selected = await payment.capabilities(
      value.session,
      value.checkout.id,
      { locale },
    );
    check(
      selected.data.capabilities.country === "US" &&
        selected.data.capabilities.amountMinor ===
          value.checkout.amount.totalAmountMinor,
      "Capability country is explicit and amount is authoritative checkout value",
    );
    const cap = selected.data.capabilities.capabilities[0];
    check(
      cap?.environment === "TEST",
      "Published capability belongs to explicit isolated TEST account",
    );
    const key = randomUUID();
    const created = await payment.create(
      value.session,
      value.checkout.id,
      cap,
      { key },
    );
    const attempt = created.data.attempt;
    check(
      attempt.status === "REQUIRES_ACTION" &&
        attempt.requestedLocale === locale &&
        attempt.providerLocale === "en" &&
        attempt.providerLocaleFallbackUsed === (locale !== "en"),
      "Frozen order locale and explicit provider locale fallback are preserved",
    );
    check(
      attempt.action?.type === "REDIRECT" &&
        new globalThis.URL(attempt.action.url).origin === psp.origin,
      "Actual hosted action has the exact permitted HTTPS PSP origin",
    );
    const before = await psp.counts();
    const replay = await payment.create(value.session, value.checkout.id, cap, {
      key,
    });
    check(
      replay.data.attempt.id === attempt.id &&
        replay.data.action === "REPLAYED",
      "Same payment key replays the same attempt",
    );
    const beforeRead = await stored(attempt.id);
    await payment.read(value.session, value.checkout.id, attempt.id);
    const current = await payment.current(value.session);
    await payment.capabilities(value.session, value.checkout.id, {
      locale: locale === "ja" ? "en" : "ja",
    });
    check(
      current.data.attempt?.id === attempt.id &&
        current.data.checkout.presentationLocale === locale,
      "Locale navigation restores the existing historical checkout and attempt",
    );
    check(
      JSON.stringify(await psp.counts()) === JSON.stringify(before),
      "GET status and capabilities do not create or reconcile a payment",
    );
    check(
      JSON.stringify(await stored(attempt.id)) === JSON.stringify(beforeRead),
      "Read-only navigation leaves actual payment rows unchanged",
    );
    locales.push({
      locale,
      status: attempt.status,
      providerLocale: attempt.providerLocale,
      fallbackUsed: attempt.providerLocaleFallbackUsed,
    });
  }
  context.progress("payment concurrency and unknown recovery");
  const concurrent = await checkout();
  const concurrentCap = (
    await payment.capabilities(concurrent.session, concurrent.checkout.id)
  ).data.capabilities.capabilities[0];
  const concurrentKey = randomUUID();
  const concurrentBefore = await psp.counts();
  const results = await Promise.all(
    [1, 2].map(() =>
      payment.create(
        concurrent.session,
        concurrent.checkout.id,
        concurrentCap,
        { key: concurrentKey, expected: [200, 409, 503] },
      ),
    ),
  );
  check(
    results.every(
      ({ data }) =>
        data.outcome === "SUCCESS" ||
        [
          "PAYMENT_IN_PROGRESS",
          "TRANSACTION_OUTCOME_UNKNOWN",
          "IDEMPOTENCY_IN_PROGRESS",
        ].includes(data.code),
    ),
    "Same-key concurrent create only yields success or explicit recoverable contention",
  );
  const settled = await payment.create(
    concurrent.session,
    concurrent.checkout.id,
    concurrentCap,
    { key: concurrentKey },
  );
  await stored(settled.data.attempt.id);
  const concurrentAfter = await psp.counts();
  check(
    concurrentAfter.createCalls === concurrentBefore.createCalls + 1 &&
      concurrentAfter.payments === concurrentBefore.payments + 1,
    "Same-key concurrent HTTP requests dispatch and create exactly one actual PSP payment",
  );
  check(
    results
      .filter(({ data }) => data.outcome === "SUCCESS")
      .every(({ data }) => data.attempt.id === settled.data.attempt.id),
    "All successful concurrent responses bind the same permanent attempt",
  );
  const concurrentRows = await client.query(
    "SELECT count(DISTINCT a.id)::int attempts,count(DISTINCT r.id)::int receipts FROM checkout_sessions s JOIN orders o ON o.checkout_session_id=s.id JOIN payment_attempts a ON a.order_id=o.id JOIN payment_create_receipts r ON r.attempt_id=a.id WHERE s.id=$1",
    [concurrent.checkout.id],
  );
  check(
    concurrentRows.rows[0].attempts === 1 &&
      concurrentRows.rows[0].receipts === 1,
    "Concurrent checkout owns exactly one actual attempt and receipt",
  );
  const foreign = await checkoutClient.initialize();
  await payment.read(foreign, concurrent.checkout.id, settled.data.attempt.id, {
    expected: 404,
    code: "ATTEMPT_NOT_FOUND",
  });
  await payment.create(
    concurrent.session,
    concurrent.checkout.id,
    concurrentCap,
    {
      body: { ...payment.createBody(concurrentCap), amountMinor: 1 },
      expected: 400,
      code: "INVALID_COMMAND",
    },
  );
  await payment.recover(
    concurrent.session,
    concurrent.checkout.id,
    settled.data.attempt.id,
    {
      headers: { origin: "https://unapproved.example.invalid" },
      expected: 403,
      code: "INVALID_ACCESS",
    },
  );
  const lost = await checkout("ja");
  const lostCap = (
    await payment.capabilities(lost.session, lost.checkout.id, { locale: "ja" })
  ).data.capabilities.capabilities[0];
  await psp.arm({ operation: "CREATE_PAYMENT", mode: "AFTER" });
  const unknown = await payment.create(lost.session, lost.checkout.id, lostCap);
  check(
    unknown.data.attempt.status === "UNKNOWN" &&
      unknown.data.attempt.action === undefined &&
      !unknown.data.attempt.canRetry,
    "Accepted PSP create with disconnected response remains UNKNOWN with no payable action",
  );
  const afterLost = await psp.counts();
  await psp.restart();
  const worker = await context.createPaymentApi();
  let recovered;
  const deadline = globalThis.performance.now() + 20_000;
  try {
    do {
      await delay(250);
      recovered = await payment.read(
        lost.session,
        lost.checkout.id,
        unknown.data.attempt.id,
      );
    } while (
      recovered.data.attempt.status === "UNKNOWN" &&
      globalThis.performance.now() < deadline
    );
    check(
      recovered.data.attempt.status === "REQUIRES_ACTION",
      "Durable recovery timer resolves accepted unknown work without browser reconcile",
    );
  } finally {
    await worker.stop();
  }
  const afterRecovery = await psp.counts();
  check(
    afterRecovery.createCalls === afterLost.createCalls &&
      afterRecovery.payments === afterLost.payments &&
      afterRecovery.reconcileCalls > afterLost.reconcileCalls,
    "UNKNOWN recovery uses only authenticated reconcile across PSP process restart",
  );
  const hosted = await context.tls.fetcher(recovered.data.attempt.action.url);
  const html = await hosted.text();
  const csrf = /name="csrf" value="([A-Za-z0-9_-]+)"/u.exec(html)?.[1];
  check(
    hosted.status === 200 && csrf,
    "Real TEST hosted HTTPS page authorizes its explicit simulation form",
  );
  const returned = await context.tls.fetcher(
    recovered.data.attempt.action.url,
    {
      method: "POST",
      headers: {
        origin: psp.origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new globalThis.URLSearchParams({
        csrf,
        outcome: "SUCCEEDED",
      }).toString(),
    },
  );
  const returnUrl = new globalThis.URL(returned.headers.get("location"));
  check(
    returned.status === 303 &&
      returnUrl.origin === context.origin &&
      returnUrl.pathname === "/ja/checkout/return" &&
      returnUrl.searchParams.get("attempt") === unknown.data.attempt.id,
    "PSP return uses exact configured storefront and frozen order locale",
  );
  const beforeGet = await psp.counts();
  const returnedRead = await payment.read(
    lost.session,
    lost.checkout.id,
    unknown.data.attempt.id,
  );
  check(
    returnedRead.data.attempt.status === "REQUIRES_ACTION" &&
      JSON.stringify(await psp.counts()) === JSON.stringify(beforeGet),
    "Browser return GET does not trust success or reconcile implicitly",
  );
  const dueObservations = [];
  const dueDeadline = globalThis.performance.now() + 20_000;
  let readyForReconcile;
  do {
    const {
      rows: [row],
    } = await client.query(
      "SELECT phase,(next_attempt_at<=clock_timestamp()) AS due,(lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) AS lease_available FROM payment_runtime_operations WHERE attempt_id=$1",
      [unknown.data.attempt.id],
    );
    dueObservations.push(row);
    readyForReconcile =
      row.phase === "RECONCILE" && row.due && row.lease_available;
    if (!readyForReconcile) await delay(100);
  } while (!readyForReconcile && globalThis.performance.now() < dueDeadline);
  await writeFile(
    path.join(context.output, "recovery-observations.json"),
    JSON.stringify({ dueObservations }, null, 2) + "\n",
  );
  check(
    readyForReconcile,
    "Actual durable reconcile work reaches its unchanged due and lease boundary",
  );
  const evidence = await payment.recover(
    lost.session,
    lost.checkout.id,
    unknown.data.attempt.id,
  );
  await writeFile(
    path.join(context.output, "recovery-observations.json"),
    JSON.stringify(
      {
        dueObservations,
        after: {
          status: evidence.data.attempt.status,
          recovery: evidence.data.attempt.recovery,
        },
        psp: await psp.counts(),
      },
      null,
      2,
    ) + "\n",
  );
  check(
    evidence.data.attempt.recovery === "EVIDENCE_PENDING" &&
      evidence.data.attempt.status !== "SUCCEEDED",
    "Authenticated capture evidence remains pending the P4-05 paid aggregate processor",
  );
  await stored(unknown.data.attempt.id);
  check(
    (await psp.observations()).every(
      (entry) => entry.unexpectedCredentials !== true,
    ),
    "TEST hosted PSP never receives storefront cookie or private API authorization",
  );
  check(
    context.logLines.every((line) =>
      canaries.every((value) => !line.includes(value)),
    ),
    "Captured API logs omit runtime-only test private content",
  );
  return {
    schemaVersion: 1,
    locales,
    checkoutRequests: checkoutClient.events,
    paymentRequests: payment.events,
    psp: await psp.counts(),
    actualPostgres: true,
    actualAuthenticatedHttps: true,
    actualPspProcessRestart: true,
    actualPspSandbox: false,
    paidAggregateImplemented: false,
  };
}
