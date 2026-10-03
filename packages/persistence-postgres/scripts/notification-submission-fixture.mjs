import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  createOrderNotificationUseCases,
  createAdminOrderResendUseCases,
} from "@fan-support/application";
import { createOrderNotificationTemplates } from "../../i18n/dist/notifications/index.js";
import {
  createPostgresPersistence,
  loadMigrationManifest,
} from "../dist/index.js";
import { readAdminOrderNotification } from "../dist/admin-notification-resend-read.js";
import { hasPendingAdminNotificationResend } from "../dist/notification-data.js";
import {
  createOrderPaymentProtocolClient,
  waitForOrderPayment,
} from "../../../apps/api/scripts/order-payment-client.mjs";

const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const unknown = {
  schemaVersion: 1,
  operation: "SEND_NOTIFICATION",
  outcome: "FAILURE",
  error: {
    schemaVersion: 1,
    code: "TIMEOUT_OUTCOME_UNKNOWN",
    recovery: "RETRY_SAME_COMMAND",
    retryAfterMs: 1000,
  },
};
const rateLimited = {
  schemaVersion: 1,
  operation: "SEND_NOTIFICATION",
  outcome: "FAILURE",
  error: {
    schemaVersion: 1,
    code: "RATE_LIMITED",
    recovery: "RETRY_SAME_COMMAND",
    retryAfterMs: 1000,
  },
};
const accepted = (id) => ({
  schemaVersion: 1,
  operation: "SEND_NOTIFICATION",
  outcome: "SUCCESS",
  value: {
    status: "ACCEPTED",
    providerReference: `test-submission/${id}`,
    acceptedAt: new Date().toISOString(),
  },
});

/** Owned PG orders and synthetic transport outcomes. No external mail is sent. */
export async function verifyNotificationSubmissions(context, workspaceRoot) {
  const { client, persistence, check } = context;
  const scalar = async (sql, parameters = []) =>
    (await client.query(sql, parameters)).rows[0];
  const submissions = persistence.notificationSubmissionTransactionManager;
  check(
    Boolean(submissions),
    "production persistence exposes native submission transactions",
  );
  const claim = (command) =>
    submissions.runInNotificationSubmissionTransaction((repo) =>
      repo.claim(command),
    );
  const finish = (command) =>
    submissions.runInNotificationSubmissionTransaction((repo) =>
      repo.finish(command),
    );
  const payment = createOrderPaymentProtocolClient(context);
  const transportKey = hash("owned native mail submission fixture");
  const captured = new Map();
  const providerCalls = new Map();
  let mode = "UNKNOWN";
  const commands = new Map();
  const shared = {
    keyManagement: context.kms.adapter,
    templates: createOrderNotificationTemplates({ mode: "TEST_DRAFT" }),
    configuration: {
      schemaVersion: 1,
      siteName: "TEST Support",
      publicStorefrontOrigin: context.origin,
      transportKey,
      linkPepperVersion: "test-mac",
      linkTtlSeconds: 3600,
      idempotencyRetentionSeconds: 60,
      leaseSeconds: 30,
      retryDelaySeconds: 1,
      maxAttempts: 1,
    },
    transportForKey: (key) =>
      key === transportKey
        ? {
            async sendEmail(email) {
              const command = {
                schemaVersion: 1,
                transportKey,
                idempotencyKey: email.notification.idempotencyKey,
                notificationId: email.notification.id,
                requestHash: hash(email),
                dispatchNotAfter: email.dispatchNotAfter,
                claimToken: randomUUID(),
              };
              if (!commands.has(command.notificationId))
                commands.set(command.notificationId, command);
              captured.set(command.notificationId, email);
              if (mode === "EXPIRED_FIRST") return unknown;
              if (mode === "CONCURRENT") {
                const candidates = Array.from({ length: 12 }, () => ({
                  ...command,
                  claimToken: randomUUID(),
                }));
                const results = await Promise.all(candidates.map(claim));
                check(
                  results.filter((result) => result.decision === "SEND")
                    .length === 1 &&
                    results.filter((result) => result.decision === "UNKNOWN")
                      .length === 11,
                  "twelve independent transactions authorize exactly one native submission",
                );
                const winner =
                  candidates[
                    results.findIndex((result) => result.decision === "SEND")
                  ];
                commands.set(command.notificationId, winner);
                const receipt = accepted(command.notificationId);
                check(
                  (await finish({ ...winner, result: receipt })).decision ===
                    "STORED",
                  "single winning token records normalized acceptance",
                );
                return receipt;
              }
              const admission = await claim(command);
              if (admission.decision === "UNKNOWN" && mode === "UNKNOWN_REPLAY")
                return unknown;
              providerCalls.set(
                command.notificationId,
                (providerCalls.get(command.notificationId) ?? 0) + 1,
              );
              check(
                admission.decision === "SEND",
                "first native admission commits before provider operation",
              );
              check(
                (
                  await scalar(
                    "SELECT status FROM notification_submissions WHERE notification_id=$1",
                    [command.notificationId],
                  )
                ).status === "UNKNOWN",
                "another PG connection observes committed unresolved admission before completion",
              );
              if (mode === "UNKNOWN" || mode === "UNKNOWN_REPLAY")
                return unknown;
              if (mode === "FAILURE_WITH_UNKNOWN_JOURNAL") return rateLimited;
              const result =
                mode === "RATE"
                  ? rateLimited
                  : accepted(command.notificationId);
              check(
                (await finish({ ...command, result })).decision === "STORED",
                "definite result is durably recorded before application finish",
              );
              return mode === "ACK_LOST" ? unknown : result;
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
  async function paid() {
    const value = await payment.fresh({ locale: "en" });
    await payment.settle(value);
    const signed = await context.signWebhook(value.attempt.id);
    check(
      (await context.sendWebhook(signed)).accepted,
      "journal fixture uses verified TEST payment evidence",
    );
    const event = await scalar(
      "SELECT id FROM provider_events WHERE provider_account_id=$1 AND provider_event_id=$2",
      [context.endpoint.providerAccountId, JSON.parse(signed.rawBody).event_id],
    );
    await payment.apply(event.id);
    const state = await payment.assertPaid(value);
    const source = await scalar(
      "SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type='ORDER_PAYMENT_CONFIRMED'",
      [state.order_id],
    );
    const requested = await automatic.request(source.id);
    return {
      orderId: state.order_id,
      notificationId: requested.notificationId,
    };
  }

  // Start real cutoff cases first. No clocks, delivery deadlines or canonical snapshots are rewritten.
  const unresolved = await paid();
  check(
    (await automatic.deliver(unresolved.notificationId)).decision === "FAILED",
    "uncertain provider outcome leaves terminal delivery plus unresolved journal",
  );
  const unresolvedCommand = commands.get(unresolved.notificationId);
  check(
    (await claim({ ...unresolvedCommand, claimToken: randomUUID() }))
      .decision === "UNKNOWN",
    "new executor cannot repeat unresolved submission",
  );
  const lateRateTerminal = await paid();
  await automatic.deliver(lateRateTerminal.notificationId);
  const expiredFirst = await paid();
  mode = "EXPIRED_FIRST";
  await automatic.deliver(expiredFirst.notificationId);

  mode = "CONCURRENT";
  const concurrent = await paid();
  check(
    (await automatic.deliver(concurrent.notificationId)).decision === "SENT",
    "concurrent claim winner retains normal notification completion",
  );
  const winner = commands.get(concurrent.notificationId);
  const replay = await claim({ ...winner, claimToken: randomUUID() });
  check(
    replay.decision === "REPLAY" && replay.result.outcome === "SUCCESS",
    "different executor replays accepted receipt without another SEND",
  );
  check(
    (await finish({ ...winner, result: replay.result })).decision === "REPLAY",
    "same finish is idempotent",
  );
  check(
    (
      await finish({
        ...winner,
        claimToken: randomUUID(),
        result: replay.result,
      })
    ).decision === "CONFLICT",
    "foreign executor cannot overwrite original completion",
  );
  check(
    (
      await finish({
        ...winner,
        result: {
          ...replay.result,
          value: { ...replay.result.value, providerReference: "different" },
        },
      })
    ).decision === "CONFLICT",
    "completion cannot change provider acceptance evidence",
  );
  for (const drift of [
    { requestHash: "f".repeat(64) },
    { transportKey: "e".repeat(64) },
    { idempotencyKey: `notification:${randomUUID()}` },
    { dispatchNotAfter: "2099-01-01T00:00:00.000Z" },
  ])
    check(
      (await claim({ ...winner, ...drift })).decision === "CONFLICT",
      "profile, key, request and cutoff drift cannot replace a frozen dispatch",
    );

  // A fresh pool models another worker process consuming the same permanent journal.
  const fresh = createPostgresPersistence(context.database);
  try {
    check(
      (
        await fresh.notificationSubmissionTransactionManager.runInNotificationSubmissionTransaction(
          (repo) =>
            repo.claim({ ...unresolvedCommand, claimToken: randomUUID() }),
        )
      ).decision === "UNKNOWN",
      "fresh worker connection retains crash uncertainty",
    );
    check(
      (
        await fresh.notificationSubmissionTransactionManager.runInNotificationSubmissionTransaction(
          (repo) => repo.claim({ ...winner, claimToken: randomUUID() }),
        )
      ).decision === "REPLAY",
      "fresh worker connection retains completed receipt",
    );
  } finally {
    await fresh.close();
  }

  mode = "ACCEPTED";
  const acceptedBeforeCrash = await paid();
  const crash = createOrderNotificationUseCases({
    ...shared,
    transactions: {
      runInNotificationTransaction: (work) =>
        persistence.notificationTransactionManager.runInNotificationTransaction(
          (repo) =>
            work({
              ...repo,
              finish: async () => {
                throw new Error("OWNED_FINISH_CRASH");
              },
            }),
        ),
    },
  });
  let crashed = false;
  try {
    await crash.deliver(acceptedBeforeCrash.notificationId);
  } catch {
    crashed = true;
  }
  check(
    crashed &&
      (await claim(commands.get(acceptedBeforeCrash.notificationId)))
        .decision === "REPLAY",
    "accepted journal survives application finish failure without authorizing a second POST",
  );
  check(
    (await automatic.deliver(acceptedBeforeCrash.notificationId)).decision ===
      "SKIP" &&
      (
        await scalar("SELECT status FROM notification_deliveries WHERE id=$1", [
          acceptedBeforeCrash.notificationId,
        ])
      ).status === "PROCESSING",
    "live original lease cannot be stolen for receipt recovery",
  );
  mode = "RATE";
  const rateBeforeCrash = await paid();
  try {
    await crash.deliver(rateBeforeCrash.notificationId);
  } catch {
    /* owned crash */
  }
  mode = "ACK_LOST";
  const ackLost = await paid();
  check(
    (await automatic.deliver(ackLost.notificationId)).decision === "SENT",
    "committed journal acceptance overrides lost COMMIT acknowledgement before recording UNKNOWN",
  );
  const automaticRetry = createOrderNotificationUseCases({
    ...shared,
    configuration: { ...shared.configuration, maxAttempts: 6 },
    transactions: persistence.notificationTransactionManager,
  });
  mode = "UNKNOWN_REPLAY";
  const retryBeforeLate = await paid();
  check(
    (await automaticRetry.deliver(retryBeforeLate.notificationId)).decision ===
      "RETRY_SCHEDULED",
    "owned missing receipt first produces retry projection",
  );
  await finish({
    ...commands.get(retryBeforeLate.notificationId),
    result: accepted(retryBeforeLate.notificationId),
  });
  const terminalSix = await paid();
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0)
      await waitForOrderPayment(
        "automatic retry becomes due",
        async () =>
          (
            await scalar(
              "SELECT next_attempt_at<=clock_timestamp() due FROM notification_deliveries WHERE id=$1",
              [terminalSix.notificationId],
            )
          ).due,
        check,
        { timeoutMs: 5000 },
      );
    await automaticRetry.deliver(terminalSix.notificationId);
  }
  check(
    (
      await scalar(
        "SELECT attempt_count FROM notification_deliveries WHERE id=$1",
        [terminalSix.notificationId],
      )
    ).attempt_count === 6,
    "six real UNKNOWN completions exhaust the configured retry budget",
  );
  let forgedRejected = false;
  try {
    await client.query(
      "UPDATE notification_deliveries SET status='SENT',sent_at=clock_timestamp(),last_error_code=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
      [terminalSix.notificationId],
    );
  } catch (error) {
    forgedRejected = error.code === "23514";
  }
  check(
    forgedRejected,
    "terminal SENT cannot be forged without its own accepted receipt",
  );
  mode = "FAILURE_WITH_UNKNOWN_JOURNAL";
  const explicitFailure = await paid();
  await automatic.deliver(explicitFailure.notificationId);
  await finish({
    ...commands.get(explicitFailure.notificationId),
    result: accepted(explicitFailure.notificationId),
  });
  await automatic.deliver(explicitFailure.notificationId);
  check(
    (
      await scalar("SELECT status FROM notification_deliveries WHERE id=$1", [
        explicitFailure.notificationId,
      ])
    ).status === "FAILED",
    "late receipt cannot rewrite an explicit failed attempt as an unknown correction",
  );
  mode = "UNKNOWN";
  const unknownBeforeAttempt = await paid();
  try {
    await crash.deliver(unknownBeforeAttempt.notificationId);
  } catch {
    /* explicit owned crash */
  }
  const summary = await readAdminOrderNotification(
    client,
    unknownBeforeAttempt.orderId,
  );
  check(
    (
      await scalar(
        "SELECT count(*)::int count FROM notification_delivery_attempts WHERE notification_delivery_id=$1",
        [unknownBeforeAttempt.notificationId],
      )
    ).count === 0 &&
      summary.status === "UNKNOWN" &&
      !summary.canResend,
    "journal prevents manual retry even when crash precedes the first delivery attempt record",
  );

  const access = await seedOperator(client);
  async function resend(value, latest = value.notificationId) {
    const order = await scalar("SELECT version FROM orders WHERE id=$1", [
      value.orderId,
    ]);
    const command = {
      schemaVersion: 1,
      action: "RESEND_NOTIFICATION",
      orderId: value.orderId,
      expectedOrderVersion: Number(order.version),
      expectedLatestNotificationId: latest,
      idempotencyKey: randomUUID(),
      reasonCode: "FAN_REQUESTED_UPDATE",
    };
    return persistence.adminOrdersTransactionManager.runInAdminOrdersTransaction(
      ({ adminOrderResends }) =>
        adminOrderResends.request({
          schemaVersion: 1,
          access: {
            ...access,
            requestId: randomUUID(),
            correlationId: randomUUID(),
          },
          command,
          requestHash: hash(command),
        }),
    );
  }
  check(
    (await resend(unknownBeforeAttempt)).code === "NOTIFICATION_IN_PROGRESS",
    "authorized manual command cannot bypass pre-attempt uncertainty",
  );
  mode = "ACCEPTED";
  const manualAcceptedOrder = await paid();
  await automatic.deliver(manualAcceptedOrder.notificationId);
  const manualAccepted = await resend(manualAcceptedOrder);
  check(
    manualAccepted.outcome === "SUCCESS",
    "fresh confirmed order creates accepted-resend recovery case",
  );
  const manualCrash = createAdminOrderResendUseCases({
    ...shared,
    transactions: {
      runInNotificationTransaction: (work) =>
        persistence.adminOrderResendNotificationTransactionManager.runInNotificationTransaction(
          (repo) =>
            work({
              ...repo,
              finish: async () => {
                throw new Error("OWNED_MANUAL_FINISH_CRASH");
              },
            }),
        ),
    },
  });
  try {
    await manualCrash.deliver(manualAccepted.resultId);
  } catch {
    /* explicit owned crash */
  }
  check(
    (
      await scalar(
        "SELECT status FROM admin_notification_resends WHERE id=$1",
        [manualAccepted.resultId],
      )
    ).status === "PROCESSING",
    "manual acceptance fixture crashed before delivery completion",
  );
  mode = "ACK_LOST";
  const manualAckOrder = await paid();
  await automatic.deliver(manualAckOrder.notificationId);
  const manualAck = await resend(manualAckOrder);
  check(
    (await manual.deliver(manualAck.resultId)).decision === "SENT",
    "manual completion also prioritizes committed acceptance over lost acknowledgement",
  );
  mode = "ACCEPTED";
  const manualSixOrder = await paid();
  await automatic.deliver(manualSixOrder.notificationId);
  const manualSix = await resend(manualSixOrder);
  const manualRetry = createAdminOrderResendUseCases({
    ...shared,
    configuration: { ...shared.configuration, maxAttempts: 6 },
    transactions: persistence.adminOrderResendNotificationTransactionManager,
  });
  mode = "UNKNOWN_REPLAY";
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0)
      await waitForOrderPayment(
        "manual retry becomes due",
        async () =>
          (
            await scalar(
              "SELECT next_attempt_at<=clock_timestamp() due FROM admin_notification_resends WHERE id=$1",
              [manualSix.resultId],
            )
          ).due,
        check,
        { timeoutMs: 5000 },
      );
    await manualRetry.deliver(manualSix.resultId);
  }
  check(
    (
      await scalar(
        "SELECT status,attempt_count FROM admin_notification_resends WHERE id=$1",
        [manualSix.resultId],
      )
    ).attempt_count === 6,
    "manual UNKNOWN reaches six without another native SEND",
  );
  mode = "ACCEPTED";
  const canceledOrder = await paid();
  await automatic.deliver(canceledOrder.notificationId);
  const canceledResend = await resend(canceledOrder);
  mode = "UNKNOWN";
  await manualRetry.deliver(canceledResend.resultId);
  mode = "UNKNOWN";
  const queued = await resend(concurrent);
  check(
    queued.outcome === "SUCCESS",
    "confirmed automatic submission still permits normal authorized manual resend",
  );
  check(
    (await manual.deliver(queued.resultId)).decision === "FAILED",
    "manual native admission records its own unresolved side effect",
  );
  const manualCommand = commands.get(queued.resultId);
  check(
    (
      await scalar(
        "SELECT automatic_notification_id,admin_resend_id FROM notification_submissions WHERE notification_id=$1",
        [queued.resultId],
      )
    ).admin_resend_id === queued.resultId,
    "manual journal is linked to the exact resend source",
  );
  check(
    (await resend(concurrent, queued.resultId)).code ===
      "NOTIFICATION_IN_PROGRESS",
    "a second operator key cannot bypass unresolved manual submission",
  );

  for (const result of [
    {
      schemaVersion: 1,
      operation: "SEND_NOTIFICATION",
      outcome: "FAILURE",
      error: { schemaVersion: 1, code: "RATE_LIMITED" },
    },
    {
      schemaVersion: 1,
      operation: "SEND_NOTIFICATION",
      outcome: "FAILURE",
      error: { schemaVersion: 1, code: null, recovery: "NONE" },
    },
    {
      schemaVersion: 1,
      operation: "SEND_NOTIFICATION",
      outcome: "FAILURE",
      error: { schemaVersion: 1, code: "RATE_LIMITED", recovery: "NONE" },
    },
    {
      ...accepted(randomUUID()),
      value: {
        status: "ACCEPTED",
        providerReference: "owned",
        acceptedAt: "now",
      },
    },
    {
      ...accepted(randomUUID()),
      value: {
        status: "ACCEPTED",
        providerReference: "owned",
        acceptedAt: "2026-01-01",
      },
    },
    ...["2026-01-01T24:00:00Z", "2026-01-01T01:02:60Z"].map((acceptedAt) => ({
      ...accepted(randomUUID()),
      value: { status: "ACCEPTED", providerReference: "owned", acceptedAt },
    })),
    unknown,
    { ...accepted(randomUUID()), recipient: "private@example.test" },
  ])
    check(
      (
        await scalar(
          "SELECT public.valid_notification_submission_result($1::jsonb) valid",
          [JSON.stringify(result)],
        )
      ).valid === false,
      "database rejects malformed, unknown or private result payloads",
    );
  const databaseRejects = async (sql, values) => {
    try {
      await client.query(sql, values);
      return false;
    } catch (error) {
      return ["23514", "55000"].includes(error.code);
    }
  };
  check(
    await databaseRejects(
      "UPDATE notification_submissions SET status='COMPLETE',result=$2::jsonb,completed_at=NULL WHERE notification_id=$1",
      [
        unresolved.notificationId,
        JSON.stringify(accepted(unresolved.notificationId)),
      ],
    ),
    "completed journal requires an actual completion timestamp",
  );
  check(
    await databaseRejects(
      "DELETE FROM notification_submissions WHERE notification_id=$1",
      [unresolved.notificationId],
    ),
    "journal cannot be deleted to regain sending authority",
  );
  check(
    await databaseRejects("TRUNCATE notification_submissions", []),
    "journal cannot be truncated to erase permanent admission",
  );
  // The runner only rolls back the applied head, so once later migrations exist
  // 0050's own down SQL is probed for its admission-history guard.
  const head = (
    await scalar("SELECT max(version) version FROM schema_migrations")
  ).version;
  const downSql = (await loadMigrationManifest({ workspaceRoot })).find(
    (row) => row.version === "0050",
  ).down.sql;
  let refusal;
  await client.query("BEGIN");
  try {
    await client.query(downSql);
  } catch (error) {
    refusal = { code: error.code, message: error.message };
  } finally {
    await client.query("ROLLBACK");
  }
  check(
    refusal?.code === "55000" &&
      refusal.message.startsWith(
        "cannot discard native mail admission history",
      ) &&
      (await scalar("SELECT max(version) version FROM schema_migrations"))
        .version === head &&
      (
        await scalar(
          "SELECT count(*)::integer AS count FROM notification_submissions",
        )
      ).count > 0,
    "populated migration rollback refuses to discard submission evidence atomically",
  );

  await waitForOrderPayment(
    "actual native admission cutoffs expire",
    async () =>
      (
        await scalar(
          "SELECT bool_and(dispatch_not_after<=clock_timestamp()) expired FROM notification_submissions WHERE notification_id=ANY($1::uuid[])",
          [[unresolved.notificationId, queued.resultId]],
        )
      ).expired,
    check,
    { timeoutMs: 70000 },
  );
  check(
    (await claim({ ...unresolvedCommand, claimToken: randomUUID() }))
      .decision === "UNKNOWN",
    "unresolved automatic admission remains unknown after its original cutoff",
  );
  check(
    (await claim({ ...manualCommand, claimToken: randomUUID() })).decision ===
      "UNKNOWN",
    "unresolved manual admission remains unknown after its original cutoff",
  );
  check(
    await hasPendingAdminNotificationResend(client, concurrent.orderId),
    "native manual uncertainty blocks later automatic stages past gateway-style cutoff",
  );
  check(
    (await readAdminOrderNotification(client, concurrent.orderId)).canResend ===
      false,
    "expired native cutoff never re-enables manual resend",
  );
  check(
    (await claim(commands.get(expiredFirst.notificationId))).decision ===
      "EXPIRED",
    "never-admitted expired command cannot make its first provider call",
  );
  check(
    (await claim({ ...winner, claimToken: randomUUID() })).decision ===
      "REPLAY",
    "retained acceptance replays after cutoff without new submission",
  );
  const recovered = await Promise.all(
    Array.from({ length: 6 }, () =>
      automatic.deliver(acceptedBeforeCrash.notificationId),
    ),
  );
  check(
    recovered.every((result) => result.decision === "SKIP") &&
      (
        await scalar(
          "SELECT status,attempt_count FROM notification_deliveries WHERE id=$1",
          [acceptedBeforeCrash.notificationId],
        )
      ).status === "SENT",
    "expired automatic lease recovers durable acceptance without another provider operation",
  );
  check(
    (
      await scalar(
        "SELECT count(*)::int count FROM notification_delivery_attempts WHERE notification_delivery_id=$1 AND outcome='SUCCEEDED'",
        [acceptedBeforeCrash.notificationId],
      )
    ).count === 1,
    "concurrent accepted recovery records one successful attempt",
  );
  check(
    (await manual.deliver(manualAccepted.resultId)).decision === "SKIP" &&
      (
        await scalar(
          "SELECT status FROM admin_notification_resends WHERE id=$1",
          [manualAccepted.resultId],
        )
      ).status === "SENT",
    "expired manual lease recovers acceptance after original cutoff",
  );
  check(
    (await automatic.deliver(rateBeforeCrash.notificationId)).decision ===
      "SKIP" &&
      (
        await scalar(
          "SELECT d.status,a.outcome FROM notification_deliveries d JOIN notification_delivery_attempts a ON a.notification_delivery_id=d.id WHERE d.id=$1",
          [rateBeforeCrash.notificationId],
        )
      ).outcome === "FAILED",
    "known rate failure recovers as failed instead of inventing permanent uncertainty or acceptance",
  );
  check(
    await databaseRejects(
      "UPDATE notification_deliveries SET status='SENT',sent_at=clock_timestamp(),last_error_code=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
      [rateBeforeCrash.notificationId],
    ),
    "known rate failure cannot use accepted-only terminal correction",
  );
  check(
    (await automaticRetry.deliver(retryBeforeLate.notificationId)).decision ===
      "SKIP" &&
      (
        await scalar("SELECT status FROM notification_deliveries WHERE id=$1", [
          retryBeforeLate.notificationId,
        ])
      ).status === "SENT",
    "late receipt recovers RETRY_SCHEDULED past the original cutoff without POST",
  );
  for (const [value, isManual] of [
    [terminalSix, false],
    [
      { notificationId: manualSix.resultId, orderId: manualSixOrder.orderId },
      true,
    ],
  ]) {
    const command = commands.get(value.notificationId);
    await finish({ ...command, result: accepted(value.notificationId) });
    const manager = isManual
      ? persistence.adminOrderResendNotificationTransactionManager
      : persistence.notificationTransactionManager;
    const pending = await manager.runInNotificationTransaction((repo) =>
      repo.listPending({ schemaVersion: 1, limit: 100 }),
    );
    check(
      pending.notificationIds.includes(value.notificationId),
      "worker discovers late terminal accepted receipt for correction",
    );
    const countBefore = providerCalls.get(value.notificationId);
    const useCase = isManual ? manualRetry : automaticRetry;
    await Promise.all(
      Array.from({ length: 6 }, () => useCase.deliver(value.notificationId)),
    );
    const table = isManual
      ? "admin_notification_resends"
      : "notification_deliveries";
    const state = await scalar(
      `SELECT status,attempt_count,version FROM ${table} WHERE id=$1`,
      [value.notificationId],
    );
    check(
      state.status === "SENT" &&
        state.attempt_count === 6 &&
        providerCalls.get(value.notificationId) === countBefore &&
        countBefore === 1,
      "terminal UNKNOWN correction keeps six append-only attempts and makes no new provider call",
    );
    await useCase.deliver(value.notificationId);
    check(
      (
        await scalar(`SELECT version FROM ${table} WHERE id=$1`, [
          value.notificationId,
        ])
      ).version === state.version,
      "repeated receipt correction is version-idempotent",
    );
    const summary = await readAdminOrderNotification(client, value.orderId);
    check(
      summary.status === "SENT" && summary.canResend,
      "restored receipt removes UNKNOWN blockage while preserving historical attempts",
    );
  }
  await manualRetry.deliver(canceledResend.resultId);
  check(
    (
      await scalar(
        "SELECT status FROM admin_notification_resends WHERE id=$1",
        [canceledResend.resultId],
      )
    ).status === "CANCELED",
    "expired manual UNKNOWN retry follows its existing cancellation state",
  );
  await finish({
    ...commands.get(canceledResend.resultId),
    result: accepted(canceledResend.resultId),
  });
  const canceledPending =
    await persistence.adminOrderResendNotificationTransactionManager.runInNotificationTransaction(
      (repo) => repo.listPending({ schemaVersion: 1, limit: 100 }),
    );
  check(
    canceledPending.notificationIds.includes(canceledResend.resultId),
    "manual maintenance discovers exact accepted receipt after cancellation",
  );
  await manualRetry.deliver(canceledResend.resultId);
  check(
    (
      await scalar(
        "SELECT status,attempt_count FROM admin_notification_resends WHERE id=$1",
        [canceledResend.resultId],
      )
    ).status === "SENT" && providerCalls.get(canceledResend.resultId) === 1,
    "manual canceled UNKNOWN projection corrects from receipt without resubmitting",
  );
  await finish({
    ...commands.get(lateRateTerminal.notificationId),
    result: rateLimited,
  });
  await automatic.deliver(lateRateTerminal.notificationId);
  const knownLateRateSummary = await readAdminOrderNotification(
    client,
    lateRateTerminal.orderId,
  );
  check(
    knownLateRateSummary.status === "FAILED" && knownLateRateSummary.canResend,
    "late definite rate receipt removes permanent uncertainty after recovery",
  );
  check(
    (await resend(lateRateTerminal)).outcome === "SUCCESS",
    "authorized operator may create new dispatch after definitively unaccepted rate outcome",
  );
  await finish({ ...manualCommand, result: rateLimited });
  const knownLateManual = await readAdminOrderNotification(
    client,
    concurrent.orderId,
  );
  check(
    knownLateManual.status === "FAILED" && knownLateManual.canResend,
    "late manual definite failure clears historical UNKNOWN blocking without rewriting attempts",
  );
  check(
    (await resend(concurrent, queued.resultId)).outcome === "SUCCESS",
    "manual definite failure permits authorized new-key resend after original cutoff",
  );
  const late = accepted(unresolved.notificationId);
  check(
    (await finish({ ...unresolvedCommand, result: late })).decision ===
      "STORED",
    "original submitter may record its definitive late response after cutoff",
  );
  check(
    (await claim({ ...unresolvedCommand, claimToken: randomUUID() }))
      .decision === "REPLAY",
    "late completion is replayable and still never SEND",
  );
  const records = (
    await client.query(
      "SELECT to_jsonb(s) value FROM notification_submissions s",
    )
  ).rows.map((row) => row.value);
  const serialized = JSON.stringify(records);
  check(
    [...captured.values()].every(
      (email) =>
        !serialized.includes(email.recipient) &&
        !serialized.includes(email.content.subject) &&
        !serialized.includes(email.content.text) &&
        !serialized.includes(
          /#token=([^&]+)/u.exec(email.content.text)?.[1] ?? "unmatchable",
        ),
    ),
    "journal persists no recipient, subject, body or access token",
  );
  check(
    records.every((row) =>
      Object.keys(row).every((key) =>
        [
          "schema_version",
          "transport_key",
          "idempotency_key",
          "notification_id",
          "automatic_notification_id",
          "admin_resend_id",
          "request_hash",
          "dispatch_not_after",
          "claim_token",
          "status",
          "result",
          "created_at",
          "completed_at",
        ].includes(key),
      ),
    ),
    "native journal stores only allowed identities, hashes, normalized results and timestamps",
  );
  return {
    status: "PASS",
    actualPostgres: true,
    actualMail: false,
    concurrentClaims: 12,
    permanentUncertainty: true,
    freshPoolRecovery: true,
    canonicalAutomaticAndManualSources: true,
    receiptRecoveryWithoutResubmission: true,
    terminalUnknownCorrectionPreservesAttempts: true,
  };
}

async function seedOperator(client) {
  const actor = randomUUID(),
    role = randomUUID(),
    session = randomUUID();
  const sessionTokenDigest = randomBytes(32).toString("hex"),
    csrfTokenDigest = randomBytes(32).toString("hex");
  await client.query(
    "INSERT INTO admin_identities(id,issuer,external_subject_hash,status) VALUES($1,'https://identity.example.test',decode($2,'hex'),'ACTIVE')",
    [actor, randomBytes(32).toString("hex")],
  );
  await client.query(
    "INSERT INTO roles(id,role_key,description) VALUES($1,$2,'Owned notification verification')",
    [role, `mail-test:${role}`],
  );
  for (const permission of ["orders.read", "orders.notification.resend"]) {
    await client.query(
      "INSERT INTO permissions(id,permission_key,description) VALUES($1,$2,'Owned notification verification') ON CONFLICT(permission_key) DO NOTHING",
      [randomUUID(), permission],
    );
    await client.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE permission_key=$2",
      [role, permission],
    );
  }
  await client.query(
    "INSERT INTO admin_identity_roles(admin_identity_id,role_id) VALUES($1,$2)",
    [actor, role],
  );
  await client.query(
    "INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,expires_at) VALUES($1,$2,decode($3,'hex'),decode($4,'hex'),true,clock_timestamp()+interval '1 hour')",
    [session, actor, sessionTokenDigest, csrfTokenDigest],
  );
  return { schemaVersion: 1, sessionTokenDigest, csrfTokenDigest };
}
