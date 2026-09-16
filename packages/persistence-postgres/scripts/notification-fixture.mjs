import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createOrderNotificationUseCases } from "@fan-support/application";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createOrderNotificationTemplates } from "../../i18n/dist/notifications/index.js";
import {
  createOrderPaymentProtocolClient,
  waitForOrderPayment,
} from "../../../apps/api/scripts/order-payment-client.mjs";
import { createOrderAccessProtocolClient } from "../../../apps/api/scripts/order-access-client.mjs";

const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const accepted = (id) => ({
  schemaVersion: 1,
  operation: "SEND_NOTIFICATION",
  outcome: "SUCCESS",
  value: {
    status: "ACCEPTED",
    providerReference: `notification-test/${id}`,
    acceptedAt: new Date().toISOString(),
  },
});
const failure = (code, retryable = false) => ({
  schemaVersion: 1,
  operation: "SEND_NOTIFICATION",
  outcome: "FAILURE",
  error: {
    schemaVersion: 1,
    code,
    recovery: retryable ? "RETRY_SAME_COMMAND" : "NONE",
    ...(retryable ? { retryAfterMs: 1000 } : {}),
  },
});

/** Injectable TEST transport only. Its memory receipt is explicitly not process-crash durability evidence. */
export function createNotificationFixtureTransport() {
  const receipts = new Map();
  return {
    transportKey: hash("TEST notification in-process transport v1"),
    transport: {
      async sendEmail(command) {
        const key = command.notification.idempotencyKey,
          fingerprint = hash(command),
          prior = receipts.get(key);
        if (prior)
          return prior.hash === fingerprint
            ? globalThis.structuredClone(prior.result)
            : failure("IDEMPOTENCY_CONFLICT");
        if (Date.parse(command.dispatchNotAfter) <= Date.now())
          return failure("CONFIGURATION_ERROR");
        const result = accepted(command.notification.id);
        receipts.set(key, { hash: fingerprint, result });
        return globalThis.structuredClone(result);
      },
    },
    acceptedCount: () => receipts.size,
    scope:
      "TEST in-process stub; not real delivery or durable transport evidence",
  };
}

/** Composes the actual Application and PG repositories over normally paid TEST PSP orders. */
export async function verifyOrderNotifications({ context, transportFactory }) {
  const { client, persistence, check, progress } = context;
  const payment = createOrderPaymentProtocolClient(context),
    cases = [],
    notices = [],
    captures = new Map(),
    calls = new Map();
  const access = createOrderAccessProtocolClient({
    ...context,
    canaries: payment.canaries,
  });
  const scalar = async (sql, values = []) =>
    (await client.query(sql, values)).rows[0];
  const transportHarness = transportFactory
    ? await transportFactory({ context })
    : createNotificationFixtureTransport();
  const templates = createOrderNotificationTemplates({ mode: "TEST_DRAFT" });
  const tx = persistence.notificationTransactionManager;
  let throwAfterAccept = false,
    failBeforeFinish = false,
    loseCommitResult = false,
    shortLease = false;
  const configuration = {
    schemaVersion: 1,
    siteName: "TEST Support",
    publicStorefrontOrigin: context.origin,
    transportKey: transportHarness.transportKey,
    linkPepperVersion: "test-mac",
    linkTtlSeconds: 3600,
    idempotencyRetentionSeconds: 3600,
    leaseSeconds: 30,
    retryDelaySeconds: 1,
    maxAttempts: 6,
  };
  const transport = {
    async sendEmail(command) {
      const id = command.notification.id,
        prior = captures.get(id);
      if (prior)
        check(
          hash(prior) === hash(command),
          "retry preserves the entire original transport command byte identity",
        );
      captures.set(id, globalThis.structuredClone(command));
      calls.set(id, (calls.get(id) ?? 0) + 1);
      const result = await transportHarness.transport.sendEmail(command);
      if (throwAfterAccept) {
        throwAfterAccept = false;
        throw new Error("OWNED_ACCEPTED_RESPONSE_LOST");
      }
      return result;
    },
  };
  const transactions = {
    async runInNotificationTransaction(work) {
      let finished = false;
      const result = await tx.runInNotificationTransaction((repo) =>
        work({
          ...repo,
          claim: (command) =>
            repo.claim(shortLease ? { ...command, leaseSeconds: 1 } : command),
          finish: async (command) => {
            if (failBeforeFinish) {
              failBeforeFinish = false;
              throw new Error("OWNED_BEFORE_FINISH_COMMIT");
            }
            const value = await repo.finish(command);
            finished = true;
            return value;
          },
        }),
      );
      if (finished && loseCommitResult) {
        loseCommitResult = false;
        throw new Error("OWNED_COMMIT_RESULT_LOST");
      }
      return result;
    },
  };
  const application = (overrides = {}, selectedTemplates = templates) =>
    createOrderNotificationUseCases({
      transactions,
      keyManagement: context.kms.adapter,
      templates: selectedTemplates,
      transportForKey: (key) =>
        key === transportHarness.transportKey ? transport : undefined,
      configuration: { ...configuration, ...overrides },
      onNotice: (code) => notices.push(code),
    });
  const app = application();
  const delivery = (id) =>
    scalar(
      `SELECT d.status,d.attempt_count,d.last_error_code,d.requested_locale,d.resolved_locale,r.link_token_id,r.content_hash,r.base_variables,r.dedupe_until,(SELECT count(*)::int FROM notification_delivery_attempts a WHERE a.notification_delivery_id=d.id AND a.outcome='UNKNOWN') unknowns FROM notification_deliveries d JOIN notification_runtime_state r ON r.notification_delivery_id=d.id WHERE d.id=$1::uuid`,
      [id],
    );
  const waitRetry = (id) =>
    waitForOrderPayment(
      "notification retry uses actual PG time",
      async () =>
        (
          await scalar(
            `SELECT d.status='RETRY_SCHEDULED' AND d.next_attempt_at<=clock_timestamp() due FROM notification_deliveries d WHERE id=$1::uuid`,
            [id],
          )
        ).due,
      check,
    );
  async function paid(locale = "en", noMessage = false) {
    const originalAdd = payment.checkout.add;
    if (noMessage)
      payment.checkout.add = async (session, line) => {
        const added = await originalAdd(session, line);
        const item = session.cart.items.find(
          (entry) => entry.id === added.cartItemId,
        );
        await payment.checkout.request(
          "CLEAR_TEST_MESSAGE",
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
              presentationLocale: locale,
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
    let value;
    try {
      value = await payment.fresh({ locale });
    } finally {
      payment.checkout.add = originalAdd;
    }
    await payment.settle(value);
    const signed = await context.signWebhook(value.attempt.id);
    check(
      (await context.sendWebhook(signed)).accepted,
      "real signed TEST PSP capture is received before any notification",
    );
    const event = await scalar(
      "SELECT id FROM provider_events WHERE provider_account_id=$1::uuid AND environment='TEST' AND provider_event_id=$2",
      [context.endpoint.providerAccountId, JSON.parse(signed.rawBody).event_id],
    );
    await payment.apply(event.id);
    const state = await payment.assertPaid(value);
    const source = await scalar(
      "SELECT id FROM outbox_events WHERE aggregate_id=$1::uuid AND event_type='ORDER_PAYMENT_CONFIRMED'",
      [state.order_id],
    );
    return { ...value, state, sourceId: source.id };
  }

  // Exercises installed SQL authority over real paid orders. This fixture is not
  // evidence of a future admin fulfillment UI or a physical delivery operation.
  async function advance(value, status) {
    const requestId = randomUUID(),
      correlationId = randomUUID(),
      sourceId = randomUUID();
    await client.query("BEGIN");
    try {
      const order = await scalar(
        "SELECT * FROM orders WHERE id=$1::uuid FOR UPDATE",
        [value.state.order_id],
      );
      const fulfillment = await scalar(
        "SELECT * FROM fulfillments WHERE order_id=$1::uuid FOR UPDATE",
        [order.id],
      );
      await client.query(
        `UPDATE fulfillments SET status=$2,version=version+1,
        prepared_at=CASE WHEN $2::text='PREPARING' THEN COALESCE(prepared_at,transaction_timestamp()) ELSE prepared_at END,
        delivered_at=CASE WHEN $2::text='DELIVERED' THEN transaction_timestamp() ELSE delivered_at END,
        hold_reason_code=CASE WHEN $2::text='ON_HOLD' THEN 'TEST_HOLD' ELSE NULL END,
        updated_at=transaction_timestamp() WHERE id=$1::uuid`,
        [fulfillment.id, status],
      );
      await client.query(
        `UPDATE orders SET fulfillment_status=$2,version=version+1,updated_at=transaction_timestamp() WHERE id=$1::uuid`,
        [order.id, status],
      );
      await client.query(
        `INSERT INTO order_events(id,order_id,sequence,event_type,from_order_status,to_order_status,
        from_payment_status,to_payment_status,from_dispute_status,to_dispute_status,from_fulfillment_status,to_fulfillment_status,
        from_payment_attempt_id,to_payment_attempt_id,authority_kind,reason_code,request_id,correlation_id,occurred_at)
        VALUES($1::uuid,$2::uuid,$3,'FULFILLMENT_AGGREGATE_CHANGED',$4,$4,$5,$5,$6,$6,$7,$8,$9::uuid,$9::uuid,
        'FULFILLMENT','TEST_FULFILLMENT_TRANSITION',$10::uuid,$11::uuid,transaction_timestamp())`,
        [
          randomUUID(),
          order.id,
          Number(order.version) + 1,
          order.order_status,
          order.payment_status,
          order.dispute_status,
          order.fulfillment_status,
          status,
          order.current_payment_attempt_id,
          requestId,
          correlationId,
        ],
      );
      await client.query(
        `INSERT INTO fulfillment_events(id,fulfillment_id,order_id,sequence,from_status,to_status,authority_kind,
        reason_code,request_id,correlation_id,occurred_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,'WORKER',
        CASE WHEN $6::text='ON_HOLD' THEN 'TEST_HOLD' ELSE 'TEST_FULFILLMENT_TRANSITION' END,$7::uuid,$8::uuid,transaction_timestamp())`,
        [
          randomUUID(),
          fulfillment.id,
          order.id,
          Number(fulfillment.version) + 1,
          fulfillment.status,
          status,
          requestId,
          correlationId,
        ],
      );
      await client.query(
        `INSERT INTO outbox_events(id,event_type,aggregate_type,aggregate_id,aggregate_version,primary_subject_id,
        secondary_subject_id,locale,market,currency,idempotency_key,correlation_id,request_id,occurred_at,available_at,payload_status)
        VALUES($1::uuid,'FULFILLMENT_STATUS_CHANGED','FULFILLMENT',$2::uuid,$3,$2::uuid,$4::uuid,$5,$6,$7,$8,
        $9::uuid,$10::uuid,transaction_timestamp(),transaction_timestamp(),$11)`,
        [
          sourceId,
          fulfillment.id,
          Number(fulfillment.version) + 1,
          order.id,
          order.presentation_locale,
          order.market,
          order.currency,
          `notification-fixture:${sourceId}`,
          correlationId,
          requestId,
          status,
        ],
      );
      await client.query("COMMIT");
      return sourceId;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  function link(id) {
    const content = captures.get(id)?.content;
    const match =
      /https:\/\/[^\s"<>]+#token=([A-Za-z0-9_-]{43})&(?:amp;)?order=([a-f0-9-]{36})/u.exec(
        content?.text ?? "",
      );
    check(
      Boolean(match),
      "notification contains only the HTTPS exchange fragment capability",
    );
    check(
      new globalThis.URL(match[0]).pathname ===
        `/${captures.get(id).notification.locale.resolvedLocale}/order-access`,
      "mail points at the actual locale order-access entry route",
    );
    payment.canaries.push(match[1]);
    return { token: match[1], publicOrderId: match[2] };
  }

  progress(
    "notification source ignores public IDs and unrelated outbox events",
  );
  check(
    (await app.request(randomUUID())).decision === "IGNORED",
    "unknown source cannot create notification",
  );
  progress(
    "historical fulfillment events keep their original order and wait for earlier mail",
  );
  const historical = await paid("en", true);
  const preparingSource = await advance(historical, "PREPARING");
  await advance(historical, "ON_HOLD");
  const preparingRequest = await app.request(preparingSource);
  check(
    preparingRequest.decision === "CREATED",
    "a real historical preparation event materializes while its current order is on hold",
  );
  check(
    (await app.deliver(preparingRequest.notificationId)).decision === "SKIP",
    "higher rank waits even when its real lower payment event has not materialized",
  );
  const historicalPayment = await app.request(historical.sourceId);
  const recovery = await tx.runInNotificationTransaction((repo) =>
    repo.listPending({ schemaVersion: 1, limit: 1 }),
  );
  check(
    recovery.notificationIds.length === 1 &&
      recovery.notificationIds[0] === historicalPayment.notificationId,
    "a limit-one recovery page selects the later-created lower stage instead of starving behind its blocked higher stage",
  );
  check(
    (await app.deliver(historicalPayment.notificationId)).decision === "SENT",
    "the canonical payment notification sends first",
  );
  const historyBoot = await access.bootstrap(historical);
  check(
    (await app.deliver(preparingRequest.notificationId)).decision === "SENT",
    "historical preparation sends only after the lower event is terminal",
  );
  const repeatedPreparing = await advance(historical, "PREPARING");
  check(
    (await app.request(repeatedPreparing)).notificationId ===
      preparingRequest.notificationId,
    "reentering preparation does not create a second per-order stage notification",
  );
  const deliveredRequest = await app.request(
    await advance(historical, "DELIVERED"),
  );
  check(
    (await app.deliver(deliveredRequest.notificationId)).decision === "SENT",
    "the real historical delivered event follows preparation",
  );
  await access.read(historyBoot.session, historyBoot.data.grant.publicOrderId);
  for (const earlier of [historicalPayment, preparingRequest]) {
    const state = await delivery(earlier.notificationId);
    check(
      (
        await scalar(
          "SELECT status FROM order_access_tokens WHERE id=$1::uuid",
          [state.link_token_id],
        )
      ).status === "REVOKED",
      "later stage retires earlier public links while retaining established sessions",
    );
    check(
      (await app.deliver(earlier.notificationId)).decision === "SKIP",
      "an older completed event cannot reverse the newest link",
    );
  }
  cases.push({
    kind: "THREE_HISTORICAL_STAGES",
    scope:
      "Guarded WORKER SQL fixture over normally paid, message-free checkout; no trigger bypass or physical delivery claim",
  });

  const deadlineValue = await paid(),
    deadlineApp = application({
      idempotencyRetentionSeconds: 60,
      retryDelaySeconds: 120,
    });
  const deadlineRequest = await deadlineApp.request(deadlineValue.sourceId);
  const untouchedValue = await paid(),
    untouchedRequest = await deadlineApp.request(untouchedValue.sourceId);
  throwAfterAccept = true;
  check(
    (await deadlineApp.deliver(deadlineRequest.notificationId)).decision ===
      "RETRY_SCHEDULED",
    "a real unknown result starts the fixed provider deduplication deadline",
  );
  progress(
    "seven immutable locale snapshots send through the real notification application",
  );
  const values = [];
  for (const locale of SUPPORTED_LOCALES) {
    const value = await paid(locale),
      requested = await app.request(value.sourceId);
    check(
      requested.decision === "CREATED",
      "canonical payment event materializes one notification",
    );
    const replay = await app.request(value.sourceId);
    check(
      replay.decision === "REPLAY" &&
        replay.notificationId === requested.notificationId,
      "duplicate event preserves notification and idempotency identity",
    );
    const id = requested.notificationId;
    check(
      (await app.deliver(id)).decision === "SENT",
      "actual application freezes, audits and completes the locale notification",
    );
    const row = await delivery(id),
      content = captures.get(id);
    check(
      row.requested_locale === locale && row.resolved_locale === locale,
      "requested and resolved locale freeze to original order",
    );
    check(
      row.base_variables.totalMinor === Number(value.state.amount) &&
        row.base_variables.currency === value.state.currency,
      "mail uses the exact canonical integer order amount and currency",
    );
    check(
      !content.content.text.includes(payment.canaries[0]) &&
        !content.content.html.includes(payment.canaries[1]),
      "private support text and full nickname never enter transactional mail",
    );
    check(
      (await app.deliver(id)).decision === "SKIP" && calls.get(id) === 1,
      "SENT retries never call transport again",
    );
    values.push({ value, id });
    cases.push({ kind: "LOCALE", locale, decision: row.status });
  }

  progress(
    "mail issuance and checkout bootstrap preserve each other's valid authorization",
  );
  const first = values[0],
    firstLink = link(first.id);
  const boot = await access.bootstrap(first.value);
  check(
    boot.data.outcome === "SUCCESS",
    "checkout bootstrap remains available after mail issuance",
  );
  const beforeClick = await delivery(first.id);
  check(
    (
      await scalar("SELECT status FROM order_access_tokens WHERE id=$1::uuid", [
        beforeClick.link_token_id,
      ])
    ).status === "ACTIVE",
    "bootstrap preserves the existing unconsumed mail link",
  );
  const exchange = await access.exchange(firstLink.token);
  check(
    exchange.data.outcome === "SUCCESS",
    "the preserved mail link exchanges once",
  );
  const second = await paid(),
    secondBoot = await access.bootstrap(second);
  const secondRequest = await app.request(second.sourceId);
  await app.deliver(secondRequest.notificationId);
  await access.read(secondBoot.session, secondBoot.data.grant.publicOrderId);
  cases.push({ kind: "BOOTSTRAP_BOTH_ORDERS" });

  progress(
    "database constraints reject changed snapshots and unfinished internal bootstrap grants",
  );
  await assert.rejects(
    client.query(
      "UPDATE notification_runtime_state SET link_nonce=decode($2,'hex') WHERE notification_delivery_id=$1::uuid",
      [first.id, "f".repeat(64)],
    ),
    { code: "55000" },
  );
  check(true, "persisted retry nonce cannot change after materialization");
  await assert.rejects(
    client.query(
      "UPDATE notification_runtime_state SET base_variables=jsonb_set(base_variables,'{totalMinor}','1'::jsonb) WHERE notification_delivery_id=$1::uuid",
      [first.id],
    ),
    { code: "55000" },
  );
  check(
    true,
    "persisted historical amount cannot be replaced by a render caller",
  );
  const internal = await context.credentials.issueLink();
  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO order_access_tokens(id,order_id,token_digest,token_pepper_version,status,expires_at,purpose) VALUES($1::uuid,$2::uuid,decode($3,'hex'),$4,'ACTIVE',clock_timestamp()+interval '1 hour','CHECKOUT_BOOTSTRAP')",
      [
        randomUUID(),
        first.value.state.order_id,
        internal.access.tokenDigest,
        internal.access.pepperVersion,
      ],
    );
    await assert.rejects(client.query("COMMIT"), { code: "23514" });
    check(
      true,
      "an internal bootstrap cannot commit without exchange, matching session and exact audit",
    );
  } finally {
    await client.query("ROLLBACK");
  }
  cases.push({ kind: "DATABASE_IMMUTABILITY_AND_BOOTSTRAP_AUTHORITY" });

  progress(
    "accepted response loss repeats the same command and a consumed link is never reissued",
  );
  const lost = await paid(),
    lostRequest = await app.request(lost.sourceId),
    lostId = lostRequest.notificationId;
  throwAfterAccept = true;
  check(
    (await app.deliver(lostId)).decision === "RETRY_SCHEDULED",
    "accepted-but-lost transport response becomes a durable unknown retry",
  );
  const lostBefore = await delivery(lostId),
    lostLink = link(lostId);
  await access.exchange(lostLink.token);
  await waitRetry(lostId);
  check(
    (await app.deliver(lostId)).decision === "SENT",
    "same-content retry can recover provider acceptance after link exchange",
  );
  const lostAfter = await delivery(lostId);
  check(
    lostAfter.link_token_id === lostBefore.link_token_id &&
      lostAfter.content_hash === lostBefore.content_hash &&
      lostAfter.unknowns === 1 &&
      calls.get(lostId) === 2,
    "unknown recovery retains one original token, one content hash and one unknown evidence row",
  );
  cases.push({ kind: "ACCEPTED_RESPONSE_LOST_AND_EXCHANGED" });

  progress("commit-result loss recovers without sending again");
  const committed = await paid(),
    commitRequest = await app.request(committed.sourceId);
  loseCommitResult = true;
  await assert.rejects(app.deliver(commitRequest.notificationId));
  check(
    (await delivery(commitRequest.notificationId)).status === "SENT",
    "real COMMIT preceded the injected client result loss",
  );
  check(
    (await app.deliver(commitRequest.notificationId)).decision === "SKIP" &&
      calls.get(commitRequest.notificationId) === 1,
    "commit uncertainty resolves from durable SENT without another send",
  );
  cases.push({
    kind: "COMMIT_RESULT_LOST",
    scope: "Injected exception after a real successful COMMIT",
  });

  progress(
    "process failure before completion uses actual lease expiry and a fenced retry",
  );
  const crashed = await paid(),
    crashRequest = await app.request(crashed.sourceId),
    crashId = crashRequest.notificationId;
  shortLease = true;
  failBeforeFinish = true;
  await assert.rejects(app.deliver(crashId));
  shortLease = false;
  const crashBefore = await delivery(crashId);
  check(
    crashBefore.status === "PROCESSING",
    "provider acceptance before completion leaves a durable leased in-flight attempt",
  );
  await waitForOrderPayment(
    "one-second TEST lease actually expires",
    async () =>
      (
        await scalar(
          "SELECT lease_expires_at<=clock_timestamp() due FROM notification_runtime_state WHERE notification_delivery_id=$1::uuid",
          [crashId],
        )
      ).due,
    check,
  );
  check(
    (await app.deliver(crashId)).decision === "SENT",
    "expired lease appends unknown evidence and reuses the same command",
  );
  check(
    (await delivery(crashId)).link_token_id === crashBefore.link_token_id,
    "crash recovery never rotates its original link",
  );
  cases.push({
    kind: "CRASH_BEFORE_COMPLETION",
    scope: "Real elapsed one-second port lease; no SQL clock edits",
  });

  progress("concurrent claimants share one delivery authority");
  const concurrent = await paid(),
    concurrentRequest = await app.request(concurrent.sourceId),
    concurrentId = concurrentRequest.notificationId;
  const outcomes = await Promise.all([
    app.deliver(concurrentId),
    app.deliver(concurrentId),
  ]);
  check(
    outcomes.filter((value) => value.decision === "SENT").length === 1 &&
      calls.get(concurrentId) === 1,
    "two real workers authorize exactly one transport call",
  );
  cases.push({ kind: "CONCURRENT_DELIVERY" });

  progress("locale incident fallback is frozen and separately observable");
  const incident = await paid("th"),
    fallback = application(
      {},
      createOrderNotificationTemplates({
        mode: "TEST_DRAFT",
        incidentFallbackLocales: ["th"],
      }),
    );
  const incidentRequest = await fallback.request(incident.sourceId);
  check(
    incidentRequest.fallbackUsed &&
      notices.includes("NOTIFICATION_LOCALE_FALLBACK"),
    "whole-message English fallback emits a named incident notice",
  );
  await fallback.deliver(incidentRequest.notificationId);
  const incidentRow = await delivery(incidentRequest.notificationId);
  check(
    incidentRow.requested_locale === "th" &&
      incidentRow.resolved_locale === "en",
    "fallback preserves the original order locale separately",
  );
  cases.push({ kind: "FALLBACK", requestedLocale: "th", resolvedLocale: "en" });

  progress(
    "revoked and expired links, changed rendering and exhausted budgets stop with visible failures",
  );
  for (const scenario of [
    "REVOKED",
    "EXPIRED",
    "CONTENT_DRIFT",
    "ATTEMPT_LIMIT",
  ]) {
    const scenarioApp = application(
      scenario === "EXPIRED"
        ? { linkTtlSeconds: 1 }
        : scenario === "ATTEMPT_LIMIT"
          ? { maxAttempts: 2 }
          : {},
    );
    const value = await paid(),
      requested = await scenarioApp.request(value.sourceId),
      id = requested.notificationId;
    throwAfterAccept = true;
    check(
      (await scenarioApp.deliver(id)).decision === "RETRY_SCHEDULED",
      "each stop case begins with a durable unknown accepted result",
    );
    const initial = await delivery(id);
    if (scenario === "REVOKED") {
      const session = await access.bootstrap(value);
      await access.revoke(session.session, session.data.grant.publicOrderId);
    }
    await waitRetry(id);
    const retryApp =
      scenario === "CONTENT_DRIFT"
        ? application(
            {},
            {
              select: templates.select,
              render(command) {
                const content = templates.render(command);
                return {
                  ...content,
                  text: `${content.text}\nChanged TEST rendering`,
                };
              },
            },
          )
        : scenarioApp;
    if (scenario === "ATTEMPT_LIMIT") throwAfterAccept = true;
    check(
      (await retryApp.deliver(id)).decision === "FAILED",
      "invalid retry ends as a visible failure",
    );
    const ended = await delivery(id);
    check(
      ended.status === "FAILED" &&
        ended.link_token_id === initial.link_token_id &&
        ended.content_hash === initial.content_hash,
      "failure preserves its original link and frozen content identity",
    );
    check(
      calls.get(id) === (scenario === "ATTEMPT_LIMIT" ? 2 : 1),
      "invalid links or content never make another provider call",
    );
    cases.push({ kind: scenario, errorCode: ended.last_error_code });
  }

  const retained = await paid(),
    retainedRequest = await app.request(retained.sourceId);
  await client.query(
    "UPDATE customer_contacts SET retention_status='PURGE_PENDING',purge_requested_at=clock_timestamp() WHERE id=(SELECT customer_contact_id FROM orders WHERE id=$1::uuid)",
    [retained.state.order_id],
  );
  check(
    (await app.deliver(retainedRequest.notificationId)).decision === "FAILED" &&
      !calls.has(retainedRequest.notificationId),
    "a contact awaiting erasure is not decrypted or sent",
  );
  check(
    (await delivery(retainedRequest.notificationId)).last_error_code ===
      "RECIPIENT_REJECTED",
    "contact retention failure remains an operator-visible reason",
  );
  cases.push({ kind: "CONTACT_RETENTION" });

  progress(
    "the original provider deduplication deadline prevents an unknown resend after expiry",
  );
  await waitForOrderPayment(
    "actual sixty-second transport deadline elapses",
    async () =>
      (
        await scalar(
          "SELECT dedupe_until<=clock_timestamp() due FROM notification_runtime_state WHERE notification_delivery_id=$1::uuid",
          [deadlineRequest.notificationId],
        )
      ).due,
    check,
    { timeoutMs: 70000 },
  );
  const overdueRecovery = await tx.runInNotificationTransaction((repo) =>
    repo.listPending({ schemaVersion: 1, limit: 100 }),
  );
  check(
    overdueRecovery.notificationIds.includes(deadlineRequest.notificationId),
    "an expired deduplication deadline is recovered before the later scheduled retry time",
  );
  check(
    (await deadlineApp.deliver(deadlineRequest.notificationId)).decision ===
      "FAILED",
    "the expired retry becomes an observable failure",
  );
  const deadlineRow = await delivery(deadlineRequest.notificationId);
  check(
    deadlineRow.status === "FAILED" &&
      deadlineRow.last_error_code === "IDEMPOTENCY_WINDOW_EXPIRED" &&
      calls.get(deadlineRequest.notificationId) === 1,
    "past the fixed deduplication window, UNKNOWN becomes an operator incident without another provider call",
  );
  cases.push({
    kind: "UNKNOWN_DEDUPLICATION_WINDOW",
    scope: "Real sixty-second PostgreSQL/provider deadline; no time mutation",
  });

  await waitForOrderPayment(
    "an untouched sixty-second deadline actually elapses",
    async () =>
      (
        await scalar(
          "SELECT dedupe_until<=clock_timestamp() due FROM notification_runtime_state WHERE notification_delivery_id=$1::uuid",
          [untouchedRequest.notificationId],
        )
      ).due,
    check,
    { timeoutMs: 70000 },
  );
  check(
    (await deadlineApp.deliver(untouchedRequest.notificationId)).decision ===
      "FAILED",
    "an untouched request past its deadline becomes visibly failed",
  );
  const untouchedRow = await delivery(untouchedRequest.notificationId);
  check(
    untouchedRow.attempt_count === 1 &&
      untouchedRow.last_error_code === "IDEMPOTENCY_WINDOW_EXPIRED" &&
      !calls.has(untouchedRequest.notificationId),
    "deadline failure records one preparation attempt without any provider side effect",
  );
  cases.push({ kind: "UNSENT_DEADLINE" });

  check(
    payment.canaries
      .filter((value) => typeof value === "string")
      .every((value) =>
        context.logLines.every((line) => !JSON.stringify(line).includes(value)),
      ),
    "no raw mail capability or private contact appears in application logs",
  );
  check(
    (
      await scalar(
        "SELECT count(*)::int count FROM notification_contact_access_receipts",
      )
    ).count >= calls.size,
    "contact decrypt access has durable typed audit receipts",
  );
  const transportEvidence =
    await transportHarness.verifyPersistenceAndDeadline?.();
  return {
    schemaVersion: 1,
    cases,
    actualPostgres: true,
    actualMerchantPsp: false,
    clockMutations: false,
    transportScope:
      transportHarness.scope ??
      "caller-supplied transport; caller owns delivery evidence",
    acceptedCount: transportHarness.acceptedCount?.() ?? null,
    providerCalls: [...calls.values()].reduce((a, b) => a + b, 0),
    observedNotices: [...new Set(notices)],
    ...(transportEvidence ? { transportEvidence } : {}),
  };
}
