#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { withEphemeralPostgres } from "../dist/index.js";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../media-s3/scripts/ephemeral-s3-harness.mjs";
import { withPaymentRuntimeFixture } from "../../../apps/api/scripts/payment-runtime-runtime.mjs";
import { createCheckoutProtocolClient } from "../../../apps/api/scripts/checkout-preflight-client.mjs";
import { createPaymentProtocolClient } from "../../../apps/api/scripts/payment-runtime-client.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const output = path.join(
  workspaceRoot,
  "output/checks/l3-commerce-recovery/backend/native",
  process.env["FAN_SUPPORT_ACTION_REFRESH_RUN_ID"] ?? "r2",
);
let assertions = 0,
  setupAssertions = 0,
  stage = "setup";
const check = (condition, label) => {
  assertions++;
  assert.ok(condition, label);
};
const progress = (value) => {
  stage = value;
  console.log(`Action refresh: ${value}`);
};
async function verify(context) {
  setupAssertions = assertions;
  const canaries = [
    `private-${randomUUID()}`,
    `name-${randomUUID().slice(0, 8)}`,
    `refresh-${randomUUID()}@example.invalid`,
  ];
  const payment = createPaymentProtocolClient({ ...context, canaries });
  const checkout = createCheckoutProtocolClient({ ...context, canaries });
  async function start(checkoutBase) {
    const session = await checkout.initialize();
    await checkout.add(session);
    const opts = checkoutBase ? { target: checkoutBase } : {};
    const quote = await checkout.validate(session, opts);
    const cart = await checkout.create(
      session,
      quote.data.preflight,
      canaries[2],
      opts,
    );
    const checkoutId = cart.data.checkout.id;
    const capability = (await payment.capabilities(session, checkoutId)).data
      .capabilities.capabilities[0];
    const created = await payment.create(session, checkoutId, capability);
    return { session, checkoutId, capability, attempt: created.data.attempt };
  }
  async function row(id) {
    return (
      await context.client.query(
        `SELECT a.id,a.order_id,a.status,a.version::int,a.action_expires_at,a.action_expires_at<=clock_timestamp() expired,a.evidence_reason_code,
      o.quote_expires_at,o.payment_status,o.order_status,operation.phase,
      (SELECT count(*)::int FROM payment_attempts sibling WHERE sibling.order_id=a.order_id) attempts,
      (SELECT count(*)::int FROM payment_create_receipts r WHERE r.attempt_id=a.id) receipts,
      (SELECT count(*)::int FROM payment_attempt_events e WHERE e.payment_attempt_id=a.id) events,
      (SELECT count(*)::int FROM payment_attempt_events e WHERE e.payment_attempt_id=a.id AND e.from_status=e.to_status) refreshes,
      (SELECT count(*)::int FROM outbox_events e WHERE e.aggregate_id=a.id AND e.event_type='PAYMENT_STATUS_CHANGED') outbox,
      (SELECT count(*)::int FROM payment_reconcile_receipts r WHERE r.attempt_id=a.id) reconciles,
      (SELECT count(*)::int FROM payment_attempt_events e WHERE e.payment_attempt_id=a.id AND e.from_status=e.to_status AND EXISTS(SELECT 1 FROM audit_logs audit WHERE audit.action='PAYMENT_PROVIDER_RECONCILE' AND audit.request_id=e.request_id AND audit.correlation_id=e.correlation_id AND audit.created_at=e.occurred_at AND audit.subject_id=a.provider_account_id AND audit.outcome='SUCCEEDED')) fresh_audits
      FROM payment_attempts a JOIN orders o ON o.id=a.order_id JOIN payment_runtime_operations operation ON operation.attempt_id=a.id WHERE a.id=$1`,
        [id],
      )
    ).rows[0];
  }
  async function waitUntil(query, params, label) {
    const until = globalThis.performance.now() + 15_000;
    while (!(await context.client.query(query, params)).rows[0]?.ready) {
      check(globalThis.performance.now() < until, label);
      await delay(40);
    }
  }
  const waitExpired = (id) =>
    waitUntil(
      "SELECT a.action_expires_at<=clock_timestamp() AND operation.next_attempt_at<=clock_timestamp() AND (operation.lease_expires_at IS NULL OR operation.lease_expires_at<=clock_timestamp()) ready FROM payment_attempts a JOIN payment_runtime_operations operation ON operation.attempt_id=a.id WHERE a.id=$1",
      [id],
      "Real action and recovery clock expire without editing business dates",
    );
  const waitDue = (id) =>
    waitUntil(
      "SELECT next_attempt_at<=clock_timestamp() AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) ready FROM payment_runtime_operations WHERE attempt_id=$1",
      [id],
      "Durable recovery lease naturally becomes available",
    );
  progress("expired action, concurrent recovery and repeated observation");
  const first = await start();
  const before = await row(first.attempt.id);
  const counts = await context.psp.counts();
  await waitExpired(first.attempt.id);
  const expired = await payment.current(first.session);
  check(
    expired.data.attempt.actionExpired &&
      expired.data.attempt.action === undefined &&
      expired.data.attempt.recovery === "RECONCILE_REQUIRED",
    "Eligible expired original action advertises authoritative recovery without disclosing an expired URL",
  );
  await Promise.all(
    [1, 2].map(() =>
      payment.recover(first.session, first.checkoutId, first.attempt.id, {
        expected: [200, 409, 503],
      }),
    ),
  );
  const fresh = await payment.current(first.session);
  check(
    fresh.data.attempt.id === first.attempt.id &&
      fresh.data.attempt.action?.type === "REDIRECT" &&
      !fresh.data.attempt.actionExpired,
    "Concurrent recovery reauthorizes the original attempt",
  );
  const after = await row(first.attempt.id);
  check(
    after.version === before.version + 1 &&
      after.refreshes === 1 &&
      after.events === after.version &&
      after.outbox === after.events &&
      after.receipts === 1 &&
      after.attempts === 1,
    "One refresh commits one same-state event/outbox and retains the permanent create receipt",
  );
  check(
    after.action_expires_at > before.action_expires_at &&
      after.action_expires_at <= after.quote_expires_at &&
      after.evidence_reason_code === "PAYMENT_ACTION_REFRESHED",
    "Fresh authorization is bounded by original resource deadline and audited",
  );
  check(
    (await context.psp.counts()).createCalls === counts.createCalls,
    "Concurrent refresh never issues CREATE_PAYMENT",
  );
  await waitExpired(first.attempt.id);
  for (const mutation of [
    "succeeded_at=clock_timestamp()",
    "terminated_at=clock_timestamp()",
    "external_reference='different-reference'",
    "evidence_reason_code='UNAUTHORIZED_REFRESH'",
    "action_expires_at=clock_timestamp()-interval '1 second'",
  ]) {
    await context.client.query("BEGIN");
    let rejected;
    try {
      await context.client.query(
        `UPDATE public.payment_attempts SET version=version+1,updated_at=clock_timestamp(),status_evidence_kind='AUTHENTICATED_RECONCILE',${mutation.startsWith("evidence_reason_code=") ? "" : "evidence_reason_code='PAYMENT_ACTION_REFRESHED',"}${mutation.startsWith("action_expires_at=") ? "" : "action_expires_at=clock_timestamp()+interval '1 second',"}${mutation} WHERE id=$1`,
        [first.attempt.id],
      );
    } catch (error) {
      rejected = { code: error.code, message: error.message };
    } finally {
      await context.client.query("ROLLBACK");
    }
    check(
      ["23514", "55000"].includes(rejected?.code) &&
        rejected?.message ===
          (mutation.startsWith("external_reference=")
            ? "provider external reference is immutable once bound"
            : "payment action refresh requires an expired original action and unchanged payment identity"),
      "Real mutation guard rejects non-action authority changes and invalid cutoff",
    );
  }
  await payment.recover(first.session, first.checkoutId, first.attempt.id);
  check(
    (await row(first.attempt.id)).refreshes === 2 &&
      (await row(first.attempt.id)).fresh_audits === 2,
    "A later authorized query renews the same expired session again without receipt conflict",
  );

  progress("get-action failure leaves original state and no charge retry");
  await waitExpired(first.attempt.id);
  await context.psp.arm({ operation: "GET_PAYMENT", mode: "BEFORE" });
  const failed = await payment.recover(
    first.session,
    first.checkoutId,
    first.attempt.id,
  );
  check(
    failed.data.attempt.actionExpired &&
      failed.data.attempt.action === undefined &&
      (await row(first.attempt.id)).refreshes === 2,
    "Uncertain action lookup preserves expired state and history",
  );
  await payment.create(first.session, first.checkoutId, first.capability, {
    expected: 409,
    code: "PAYMENT_IN_PROGRESS",
  });
  check(
    (await context.psp.counts()).createCalls === counts.createCalls,
    "Neither failed GET nor a new browser idempotency key creates a second charge",
  );

  progress("resource expiry and bounded fresh deadline");
  const short = await context.createCheckoutApi(5000);
  try {
    const value = await start(short.base);
    await waitExpired(value.attempt.id);
    // Use a longer deployment action TTL so the write must cap it at the original quote.
    const priorTtl = context.configuration.actionTtlMs;
    context.configuration.actionTtlMs = 60_000;
    const longApi = await context.createPaymentApi({ recovery: false });
    context.configuration.actionTtlMs = priorTtl;
    try {
      await payment.recover(value.session, value.checkoutId, value.attempt.id, {
        target: longApi.base,
      });
    } finally {
      await longApi.stop();
    }
    const capped = await row(value.attempt.id);
    check(
      capped.action_expires_at <= capped.quote_expires_at,
      "Long runtime TTL cannot authorize beyond original quote",
    );
    await waitUntil(
      "SELECT quote_expires_at<=clock_timestamp() ready FROM orders WHERE id=$1",
      [capped.order_id],
      "Original quote expires naturally",
    );
    const unavailable = await payment.current(value.session);
    check(
      unavailable.data.attempt.actionExpired &&
        unavailable.data.attempt.recovery === "NONE" &&
        unavailable.data.attempt.action === undefined,
      "Expired resource does not advertise an authorization refresh",
    );
    const storedBefore = await row(value.attempt.id);
    await payment.recover(value.session, value.checkoutId, value.attempt.id);
    check(
      (await row(value.attempt.id)).version === storedBefore.version,
      "Explicit recover cannot reopen an expired original quote",
    );
  } finally {
    await short.stop();
  }

  progress("terminal observation wins against an in-flight old action");
  const race = await start();
  await waitExpired(race.attempt.id);
  const provider = context.providerRegistration.provider;
  const originalGet = provider.getPayment.bind(provider);
  let release, entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  context.providerRegistration.provider = {
    ...provider,
    async getPayment(command) {
      const result = await originalGet(command);
      entered();
      await gate;
      return result;
    },
  };
  const raceApi = await context.createPaymentApi({ recovery: false });
  context.providerRegistration.provider = provider;
  const pending = payment.recover(
    race.session,
    race.checkoutId,
    race.attempt.id,
    { expected: [200, 409, 503], target: raceApi.base },
  );
  try {
    await Promise.race([
      started,
      delay(10_000, undefined, { ref: false }).then(() => {
        throw new Error("Owned GET hook did not start");
      }),
    ]);
    const {
      rows: [lease],
    } = await context.client.query(
      "SELECT operation.lease_expires_at>clock_timestamp() live,NOT EXISTS(SELECT 1 FROM audit_logs audit WHERE audit.id=operation.audit_log_id) missing_audit FROM payment_runtime_operations operation WHERE attempt_id=$1",
      [race.attempt.id],
    );
    check(
      lease.live && lease.missing_audit,
      "In-flight action holds a live lease but has no persisted query audit yet",
    );
    await context.client.query("BEGIN");
    let auditRejection;
    try {
      await context.client.query(
        "UPDATE payment_attempts SET version=version+1,updated_at=clock_timestamp(),status_evidence_kind='AUTHENTICATED_RECONCILE',evidence_reason_code='PAYMENT_ACTION_REFRESHED',action_expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",
        [race.attempt.id],
      );
    } catch (error) {
      auditRejection = { code: error.code, message: error.message };
    } finally {
      await context.client.query("ROLLBACK");
    }
    check(
      auditRejection?.code === "23514" &&
        auditRejection?.message ===
          "payment action refresh requires the live reconcile lease and valid original checkout resources",
      "A live claim alone cannot authorize an action without its fresh persisted query audit",
    );
    const hosted = await context.psp.hostedAction(race.attempt.id);
    const url = typeof hosted === "string" ? hosted : hosted.url;
    const response = await context.tls.fetcher(url);
    const csrf = /name="csrf" value="([A-Za-z0-9_-]+)"/u.exec(
      await response.text(),
    )?.[1];
    check(
      Boolean(csrf),
      "Actual TEST PSP page supplies its signed action challenge",
    );
    await context.tls.fetcher(url, {
      method: "POST",
      headers: {
        origin: context.psp.origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new globalThis.URLSearchParams({
        csrf,
        outcome: "FAILED",
      }).toString(),
    });
    context.providerRegistration.provider = provider;
    await waitDue(race.attempt.id);
    await payment.recover(race.session, race.checkoutId, race.attempt.id);
    check(
      (await row(race.attempt.id)).status === "FAILED",
      "Trusted terminal query commits before old action response is released",
    );
  } finally {
    context.providerRegistration.provider = provider;
    release();
    await pending;
    await raceApi.stop();
  }
  const terminal = await row(race.attempt.id);
  check(
    terminal.status === "FAILED" &&
      terminal.refreshes === 0 &&
      terminal.attempts === 1,
    "Stale claim cannot revive the terminal attempt or append an authorization event",
  );

  progress("UNKNOWN recovery remains same attempt");
  await context.psp.arm({ operation: "CREATE_PAYMENT", mode: "AFTER" });
  const unknown = await start();
  check(
    unknown.attempt.status === "UNKNOWN",
    "Actual lost create response leaves UNKNOWN",
  );
  const unknownCounts = await context.psp.counts();
  await payment.create(
    unknown.session,
    unknown.checkoutId,
    unknown.capability,
    { expected: 409, code: "PAYMENT_IN_PROGRESS" },
  );
  await waitDue(unknown.attempt.id);
  const resumed = await payment.recover(
    unknown.session,
    unknown.checkoutId,
    unknown.attempt.id,
  );
  check(
    resumed.data.attempt.id === unknown.attempt.id &&
      resumed.data.attempt.status === "REQUIRES_ACTION" &&
      resumed.data.attempt.action?.type === "REDIRECT",
    "Existing UNKNOWN path recovers its lost original action",
  );
  check(
    (await context.psp.counts()).createCalls === unknownCounts.createCalls,
    "UNKNOWN reconcile never issues a second create",
  );
}
await mkdir(output, { recursive: true });
try {
  if (process.argv.includes("--internal")) {
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    await withEphemeralPostgres((database) =>
      withPaymentRuntimeFixture({
        database,
        s3,
        workspaceRoot,
        output,
        check,
        progress,
        paymentActionTtlMs: 1000,
        verify,
      }),
    );
    await writeFile(
      path.join(output, "protocol-result.json"),
      JSON.stringify({
        status: "PASS",
        assertions,
        setupAssertions,
        featureAssertions: assertions - setupAssertions,
        actualPostgres: true,
        actualTlsTestPsp: true,
        actualStripeSandbox: false,
      }) + "\n",
    );
  } else {
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: "--internal",
        timeoutMs: 240_000,
      }),
    );
    await writeFile(
      path.join(output, "final-result.json"),
      JSON.stringify({ status: "PASS", ownedCleanupComplete: true }) + "\n",
    );
  }
} catch (error) {
  console.error(
    `Action refresh failed: ${stage} ${error?.name ?? "Error"} ${error?.name === "AssertionError" ? error.message : (error?.code ?? "RUNTIME")}`,
  );
  await writeFile(
    path.join(
      output,
      process.argv.includes("--internal")
        ? "protocol-result.json"
        : "final-result.json",
    ),
    JSON.stringify({
      status: "FAIL",
      stage,
      assertions,
      setupAssertions,
      kind: error?.name,
    }) + "\n",
  );
  process.exitCode = 1;
}
