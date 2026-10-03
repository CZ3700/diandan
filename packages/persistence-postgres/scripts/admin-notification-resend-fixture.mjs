import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  createOrderNotificationUseCases,
  createAdminOrderResendUseCases,
} from "@fan-support/application";
import { createOrderNotificationTemplates } from "../../i18n/dist/notifications/index.js";
import {
  createOrderPaymentProtocolClient,
  waitForOrderPayment,
} from "../../../apps/api/scripts/order-payment-client.mjs";
import { createOrderAccessProtocolClient } from "../../../apps/api/scripts/order-access-client.mjs";
import { createPersistentNotificationGatewayHarness } from "../../../apps/worker/scripts/notification-gateway-harness.mjs";
import { preflightEnvironment } from "../../../apps/api/scripts/publication-preflight-http-fixtures.mjs";
import { createWorkerReliableEventsComposition } from "../../../apps/worker/dist/reliable-events-composition.js";
import { createReliableEventsWorkerRuntime } from "../../../apps/worker/dist/reliable-events-runtime.js";
import { createTestWorkerNotifications } from "../../../apps/worker/dist/notification-composition.js";
import { createNotificationFulfillmentFixture } from "./notification-fulfillment-fixture.mjs";
import {
  verifyDigitalNotificationResends,
  verifyDigitalResendDelivery,
  verifyResendHistoryGuard,
} from "./admin-notification-resend-digital-fixture.mjs";

const sha = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function verifyAdminNotificationResends(context) {
  const { client, persistence, check, progress } = context;
  const scalar = async (sql, params = []) =>
    (await client.query(sql, params)).rows[0];
  const payment = createOrderPaymentProtocolClient(context);
  const advance = await createNotificationFulfillmentFixture(context);
  const access = createOrderAccessProtocolClient({
    ...context,
    canaries: payment.canaries,
  });
  const gateway = await createPersistentNotificationGatewayHarness({ context });
  const templates = createOrderNotificationTemplates({ mode: "TEST_DRAFT" });
  const captures = new Map();
  const config = {
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
  };
  const shared = {
    configuration: config,
    keyManagement: context.kms.adapter,
    templates,
    transportForKey: (key) =>
      key === gateway.transportKey
        ? {
            sendEmail: async (command) => {
              const prior = captures.get(command.notification.id);
              if (prior)
                check(
                  sha(prior) === sha(command),
                  "resend retry preserves complete receiver command identity",
                );
              captures.set(
                command.notification.id,
                globalThis.structuredClone(command),
              );
              return gateway.transport.sendEmail(command);
            },
          }
        : undefined,
  };
  const automatic = createOrderNotificationUseCases({
    ...shared,
    transactions: persistence.notificationTransactionManager,
  });
  const manual = createAdminOrderResendUseCases({
    ...shared,
    transactions: persistence.adminOrderResendNotificationTransactionManager,
  });
  const request = (input) =>
    persistence.adminOrdersTransactionManager.runInAdminOrdersTransaction(
      ({ adminOrderResends }) => adminOrderResends.request(input),
    );
  const adminId = randomUUID(),
    roleId = randomUUID(),
    sessionId = randomUUID(),
    sessionDigest = randomBytes(32).toString("hex"),
    csrfDigest = randomBytes(32).toString("hex");
  progress("seed explicitly authorized TEST notification operator");
  await client.query(
    "INSERT INTO admin_identities(id,issuer,external_subject_hash,status) VALUES($1,'https://identity.example.test',decode($2,'hex'),'ACTIVE')",
    [adminId, randomBytes(32).toString("hex")],
  );
  await client.query(
    "INSERT INTO roles(id,role_key,description) VALUES($1,$2,'TEST notification operator')",
    [roleId, `notification-test:${randomUUID()}`],
  );
  await client.query(
    "INSERT INTO permissions(id,permission_key,description) VALUES($1,'orders.notification.resend','TEST resend capability') ON CONFLICT(permission_key) DO NOTHING",
    [randomUUID()],
  );
  const permission = (
    await scalar(
      "SELECT id FROM permissions WHERE permission_key='orders.notification.resend'",
    )
  ).id;
  await client.query(
    "INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2)",
    [roleId, permission],
  );
  await client.query(
    "INSERT INTO permissions(id,permission_key,description) VALUES($1,'orders.read','TEST order access baseline') ON CONFLICT(permission_key) DO NOTHING",
    [randomUUID()],
  );
  await client.query(
    "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE permission_key='orders.read'",
    [roleId],
  );
  await client.query(
    "INSERT INTO admin_identity_roles(admin_identity_id,role_id) VALUES($1,$2)",
    [adminId, roleId],
  );
  await client.query(
    "INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,expires_at) VALUES($1,$2,decode($3,'hex'),decode($4,'hex'),true,clock_timestamp()+interval '1 hour')",
    [sessionId, adminId, sessionDigest, csrfDigest],
  );
  async function paid(notifications = automatic, options = {}) {
    const original = payment.checkout.add;
    payment.checkout.add = async (session, line) => {
      const added = await original(session, line),
        item = session.cart.items.find(
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
            presentationLocale: session.cart.presentationLocale ?? "en",
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
      value = await payment.fresh({ locale: "en", lines: options.lines });
    } finally {
      payment.checkout.add = original;
    }
    await payment.settle(value);
    const signed = await context.signWebhook(value.attempt.id);
    check(
      (await context.sendWebhook(signed)).accepted,
      "resend order uses actual signed TEST PSP capture",
    );
    const event = await scalar(
      "SELECT id FROM provider_events WHERE provider_account_id=$1 AND provider_event_id=$2",
      [context.endpoint.providerAccountId, JSON.parse(signed.rawBody).event_id],
    );
    await payment.apply(event.id);
    const state = options.fulfillmentStatus
      ? await payment.state(value)
      : await payment.assertPaid(value);
    if (options.fulfillmentStatus)
      check(
        state.payment_status === "PAID" &&
          state.order_status === "OPEN" &&
          state.attempt_status === "SUCCEEDED" &&
          state.cart_status === "CONVERTED" &&
          state.converted_intents === state.items &&
          state.fulfillments === state.items &&
          state.fulfillment_status === options.fulfillmentStatus &&
          state.captures === 1 &&
          state.confirmations === 1,
        "digital resend fixture retains actual canonical capture and line fulfillment",
      );
    const source = await scalar(
      "SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type='ORDER_PAYMENT_CONFIRMED'",
      [state.order_id],
    );
    const requested = await notifications.request(source.id);
    check(
      (await notifications.deliver(requested.notificationId)).decision ===
        "SENT",
      "original automatic message is accepted before operator resend",
    );
    return { ...value, state, notificationId: requested.notificationId };
  }
  async function command(value, latestId = value.notificationId) {
    const version = (
      await scalar("SELECT version FROM orders WHERE id=$1", [
        value.state.order_id,
      ])
    ).version;
    const command = {
      schemaVersion: 1,
      action: "RESEND_NOTIFICATION",
      orderId: value.state.order_id,
      expectedOrderVersion: Number(version),
      expectedLatestNotificationId: latestId,
      idempotencyKey: randomUUID(),
      reasonCode: "FAN_REQUESTED_UPDATE",
    };
    return {
      schemaVersion: 1,
      access: {
        schemaVersion: 1,
        sessionTokenDigest: sessionDigest,
        csrfTokenDigest: csrfDigest,
        requestId: randomUUID(),
        correlationId: randomUUID(),
      },
      command,
      requestHash: sha(command),
    };
  }
  const state = (id) =>
    scalar(
      "SELECT status,attempt_count,link_token_id,content_hash FROM admin_notification_resends WHERE id=$1",
      [id],
    );
  const token = (id) => {
    const text = captures.get(id)?.content.text,
      match = /#token=([A-Za-z0-9_-]{43})&order=([a-f0-9-]{36})/u.exec(
        text ?? "",
      );
    check(
      Boolean(match),
      "mail carries one exchange capability only in fragment",
    );
    payment.canaries.push(match[1]);
    return { token: match[1], publicOrderId: match[2] };
  };
  const digitalContext = {
    context,
    paid,
    command,
    request,
    automatic,
    manual,
    advance,
    gateway,
    captures,
    access,
    token,
    scalar,
    state,
  };
  const preparedMixed = await verifyDigitalNotificationResends(digitalContext);
  progress("operator resend durable receipt, fresh link and receiver recovery");
  const value = await paid(),
    first = await command(value),
    originalToken = token(value.notificationId);
  const originalSession = await access.exchange(originalToken.token);
  const [created, replayed] = await Promise.all([
    request(first),
    request(first),
  ]);
  check(
    created.outcome === "SUCCESS" &&
      replayed.outcome === "SUCCESS" &&
      created.resultId === replayed.resultId &&
      created.replayed !== replayed.replayed,
    "concurrent same-key operator resend creates exactly one durable job",
  );
  const resendId = created.resultId;
  check(
    (await request({ ...first, requestHash: "a".repeat(64) })).code ===
      "IDEMPOTENCY_CONFLICT",
    "same key different request cannot create another dispatch",
  );
  const snapshotBefore = await scalar(
    "SELECT row_to_json(d) data FROM notification_deliveries d WHERE id=$1",
    [value.notificationId],
  );
  const acceptedBefore = gateway.acceptedCount();
  await gateway.dropNextResponse();
  check(
    (await manual.deliver(resendId)).decision === "RETRY_SCHEDULED",
    "accepted resend with lost receiver response remains recoverable UNKNOWN",
  );
  check(
    (await state(resendId)).status === "RETRY_SCHEDULED",
    "UNKNOWN never resets original SENT delivery",
  );
  await gateway.restart();
  await waitForOrderPayment(
    "resend retry due under actual PG clock",
    async () =>
      (
        await scalar(
          "SELECT next_attempt_at<=clock_timestamp() due FROM admin_notification_resends WHERE id=$1",
          [resendId],
        )
      ).due,
    check,
  );
  check(
    (await manual.deliver(resendId)).decision === "SENT",
    "same dispatch recovers durable acceptance after receiver restart",
  );
  await gateway.inspect();
  check(
    gateway.acceptedCount() === acceptedBefore + 1,
    "response loss and receiver restart cause only one extra accepted mail",
  );
  check(
    (await manual.deliver(resendId)).decision === "SKIP",
    "completed resend never dispatches twice",
  );
  check(
    JSON.stringify(snapshotBefore) ===
      JSON.stringify(
        await scalar(
          "SELECT row_to_json(d) data FROM notification_deliveries d WHERE id=$1",
          [value.notificationId],
        ),
      ),
    "original automatic SENT row remains byte-equivalent",
  );
  const fresh = token(resendId);
  check(
    fresh.token !== originalToken.token,
    "manual resend creates a new one-time capability",
  );
  await access.read(originalSession.session, originalToken.publicOrderId);
  const exchanged = await access.exchange(fresh.token);
  await access.read(exchanged.session, fresh.publicOrderId);
  await access.read(originalSession.session, originalToken.publicOrderId, {
    expected: 401,
    code: "ACCESS_DENIED",
  });
  await access.exchange(originalToken.token, {
    expected: 401,
    code: "ACCESS_DENIED",
  });
  const repeat = await command(value, resendId);
  check(
    (await request(repeat)).code === "NOTIFICATION_NOT_READY",
    "new keys cannot bypass the resend cooldown",
  );
  let immutable = false;
  try {
    await client.query(
      "UPDATE admin_notification_resends SET status='REQUESTED',version=version+1 WHERE id=$1",
      [resendId],
    );
  } catch (error) {
    immutable = error.code === "55000" || error.code === "23514";
  }
  check(immutable, "completed resend cannot be reset by direct SQL");

  progress("superseded pending resend cannot replace a newer stage link");
  const later = await paid(),
    pending = await request(await command(later));
  check(
    pending.outcome === "SUCCESS",
    "another genuine paid order can request one resend",
  );
  const preparingSource = await advance(later, "PREPARING");
  const preparing = await automatic.request(preparingSource);
  check(
    (await automatic.deliver(preparing.notificationId)).decision === "SKIP",
    "automatic preparation waits for the older manual durable job",
  );
  check(
    (await manual.deliver(pending.resultId)).decision === "SKIP",
    "old queued manual status is canceled before sending",
  );
  check(
    (await state(pending.resultId)).status === "CANCELED",
    "superseded resend remains explicit immutable history",
  );
  check(
    (await automatic.deliver(preparing.notificationId)).decision === "SENT",
    "new preparation can continue after superseded resend retires",
  );
  check(
    (await state(pending.resultId)).link_token_id === null,
    "superseded pending resend never rotates the new order link",
  );

  progress("unknown terminal resend cannot be bypassed with another key");
  const shortDeadline = createOrderNotificationUseCases({
    ...shared,
    configuration: { ...config, idempotencyRetentionSeconds: 60 },
    transactions: persistence.notificationTransactionManager,
  });
  const uncertain = await paid(shortDeadline),
    unknown = await request(await command(uncertain));
  const once = createAdminOrderResendUseCases({
    ...shared,
    configuration: { ...config, maxAttempts: 1 },
    transactions: persistence.adminOrderResendNotificationTransactionManager,
  });
  await gateway.dropNextResponse();
  check(
    (await once.deliver(unknown.resultId)).decision === "FAILED",
    "bounded retry policy preserves terminal uncertain attempt",
  );
  const blocked = await request(await command(uncertain, unknown.resultId));
  check(
    blocked.code === "NOTIFICATION_IN_PROGRESS",
    "new manual dispatch is blocked while an accepted response remains unknown",
  );
  check(
    (
      await scalar(
        "SELECT count(*)::int count FROM admin_notification_resends WHERE order_id=$1",
        [uncertain.state.order_id],
      )
    ).count === 1,
    "unknown outcome retains one logical resend",
  );
  const uncertainPreparing = await automatic.request(
    await advance(uncertain, "PREPARING"),
  );
  check(
    (await automatic.deliver(uncertainPreparing.notificationId)).decision ===
      "SKIP",
    "new automatic status waits while an older unknown resend can still be accepted",
  );

  progress(
    "same operator key on different orders has one winner and an explicit conflict",
  );
  const competing = [await paid(), await paid()];
  const crossCommands = await Promise.all(
    competing.map((value) => command(value)),
  );
  crossCommands[1].command.idempotencyKey =
    crossCommands[0].command.idempotencyKey;
  crossCommands[1].requestHash = sha(crossCommands[1].command);
  const raced = await Promise.allSettled(crossCommands.map(request));
  check(
    raced.every((result) => result.status === "fulfilled") &&
      raced.filter((result) => result.value?.outcome === "SUCCESS").length ===
        1 &&
      raced.filter((result) => result.value?.code === "IDEMPOTENCY_CONFLICT")
        .length === 1,
    "cross-order same-key race returns one logical resend and one stable conflict",
  );

  progress("queue insertion failure atomically rolls back resend and audit");
  const rollback = await paid(),
    before = await scalar(
      "SELECT (SELECT count(*) FROM admin_notification_resends) resends,(SELECT count(*) FROM audit_logs WHERE action='RESEND_ORDER_NOTIFICATION') audits",
    );
  await client.query(
    "CREATE FUNCTION public.owned_resend_outbox_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned failure' USING ERRCODE='23514'; END $$",
  );
  await client.query(
    "CREATE TRIGGER owned_resend_outbox_failure BEFORE INSERT ON admin_notification_resend_outbox FOR EACH ROW EXECUTE FUNCTION owned_resend_outbox_failure()",
  );
  let rejected = false;
  try {
    await request(await command(rollback));
  } catch {
    rejected = true;
  }
  await client.query(
    "DROP TRIGGER owned_resend_outbox_failure ON admin_notification_resend_outbox",
  );
  await client.query("DROP FUNCTION owned_resend_outbox_failure()");
  check(rejected, "outbox failure escapes the transaction as a failure");
  check(
    JSON.stringify(before) ===
      JSON.stringify(
        await scalar(
          "SELECT (SELECT count(*) FROM admin_notification_resends) resends,(SELECT count(*) FROM audit_logs WHERE action='RESEND_ORDER_NOTIFICATION') audits",
        ),
      ),
    "outbox failure leaves no resend or success audit behind",
  );
  progress("fresh actual Worker consumes the persisted ID-only resend outbox");
  const workerPending = await request(await command(rollback));
  check(
    workerPending.outcome === "SUCCESS",
    "rollback order can later queue a valid resend",
  );
  let runtime;
  const composition = createWorkerReliableEventsComposition(
    preflightEnvironment(context.database),
    {
      factories: {
        createRuntime(configuration) {
          runtime = createReliableEventsWorkerRuntime({
            ...configuration,
            schedule: () => ({ cancel() {} }),
          });
          return runtime;
        },
        prepareNotifications() {
          return (dependencies) =>
            createTestWorkerNotifications({
              environment: "TEST",
              configuration: {
                schemaVersion: 1,
                siteName: config.siteName,
                publicStorefrontOrigin: config.publicStorefrontOrigin,
                linkPepperVersion: config.linkPepperVersion,
                linkTtlSeconds: config.linkTtlSeconds,
                leaseSeconds: config.leaseSeconds,
                retryDelaySeconds: config.retryDelaySeconds,
                maxAttempts: config.maxAttempts,
                activeProfile: "local-receiver",
                acceptedPepperVersions: [config.linkPepperVersion],
                incidentFallbackLocales: [],
                profiles: [
                  {
                    name: "local-receiver",
                    credentialEnvironmentVariable: "TEST_RECEIVER_CREDENTIAL",
                    profile: {
                      schemaVersion: 1,
                      protocol: "fan-support-mail-v1",
                      environment: "TEST",
                      apiOrigin: "https://mail.example.test",
                      fromEmail: "orders@example.test",
                      fromName: "TEST Studio",
                      replyToEmail: "support@example.test",
                      timeoutMs: 2000,
                      idempotencyRetentionSeconds:
                        config.idempotencyRetentionSeconds,
                    },
                  },
                ],
              },
              credentials: {
                TEST_RECEIVER_CREDENTIAL: "local-fixture-transport-injected",
              },
              transactions: dependencies.notificationTransactionManager,
              resendTransactions:
                dependencies.adminOrderResendNotificationTransactionManager,
              keyManagement: context.kms.adapter,
              transportFactory: () => ({
                transportKey: gateway.transportKey,
                transport: shared.transportForKey(gateway.transportKey),
              }),
            });
        },
      },
    },
  );
  context.own("admin resend TEST Worker", () => composition.stop());
  try {
    await composition.start();
    await runtime.runMaintenanceOnce();
    check(
      (await state(workerPending.resultId)).status === "SENT",
      "actual Worker maintenance recovers and sends the durable manual job",
    );
    check(
      captures.has(workerPending.resultId),
      "actual Worker uses the local TLS receiver for the manual job",
    );
    const [queueEntry] = (
      await client.query(
        "SELECT * FROM admin_notification_resend_outbox WHERE resend_id=$1",
        [workerPending.resultId],
      )
    ).rows;
    check(
      JSON.stringify(Object.keys(queueEntry).sort()) ===
        JSON.stringify(["created_at", "resend_id", "schema_version"]),
      "manual durable outbox stores only its version, time and identifier",
    );
  } finally {
    await composition.stop();
  }
  progress(
    "actual fixed deadline releases a later state without replaying an unknown dispatch",
  );
  await waitForOrderPayment(
    "older manual acceptance deadline elapses under the real PostgreSQL clock",
    async () =>
      (
        await scalar(
          "SELECT dedupe_until<=clock_timestamp() due FROM admin_notification_resends WHERE id=$1",
          [unknown.resultId],
        )
      ).due,
    check,
    { timeoutMs: 70000 },
  );
  const recovery =
    await persistence.notificationTransactionManager.runInNotificationTransaction(
      (repo) => repo.listPending({ schemaVersion: 1, limit: 100 }),
    );
  check(
    recovery.notificationIds.includes(uncertainPreparing.notificationId),
    "later automatic state becomes eligible after the unknown acceptance cutoff",
  );
  check(
    (await automatic.deliver(uncertainPreparing.notificationId)).decision ===
      "SENT",
    "newer state can safely continue after the fixed cutoff",
  );
  check(
    (await manual.deliver(unknown.resultId)).decision === "SKIP",
    "deadline recovery never creates another attempt for terminal unknown history",
  );
  // The existing real-clock deadline also expires the earlier mixed-order cooldown.
  await verifyDigitalResendDelivery(
    digitalContext,
    preparedMixed,
    "PREPARING",
    "MIXED_PREPARING",
  );
  const historyGuard = await verifyResendHistoryGuard(digitalContext);
  check(
    payment.canaries.every(
      (value) => !context.logLines.some((line) => line.includes(value)),
    ),
    "canary credentials and private values stay outside API logs",
  );
  await gateway.close();
  return {
    schemaVersion: 1,
    status: "PASS",
    actualPostgres: true,
    actualTlsReceiver: true,
    actualSignedPayment: true,
    receiverRestart: true,
    freshTokenExchange: true,
    originalSessionRetainedUntilNewTokenExchange: true,
    actualWorkerComposition: true,
    actualPgBoss: true,
    actualUnknownCutoffSeconds: 60,
    transactionRollback: true,
    digitalPaymentResends: ["VIRTUAL", "MIXED"],
    mixedPreparingSourceSupersedesBeforeMaterialization: true,
    mixedPreparingResend: true,
    historyGuard,
    scope:
      "Synthetic local data and local TEST receiver; no production email or physical delivery",
  };
}
