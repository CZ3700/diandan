import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { readAdminOrderNotification } from "../dist/admin-notification-resend-read.js";

/** Exercise real paid digital orders against the same TLS receiver and authorized resend path. */
export async function verifyDigitalResendDelivery(
  fixture,
  value,
  eventType,
  label,
) {
  const {
    context: { client, check },
    command,
    request,
    manual,
    gateway,
    captures,
    access,
    token,
  } = fixture;
  const summary = await readAdminOrderNotification(
    client,
    value.state.order_id,
  );
  check(
    summary.latestNotificationId === value.notificationId &&
      summary.eventType === eventType &&
      summary.status === "SENT" &&
      summary.canResend,
    `${label}: actual sent notification is the current resendable source`,
  );
  const originalToken = token(value.notificationId);
  await gateway.inspect();
  const before = gateway.acceptedCount();
  const result = await request(await command(value));
  check(
    result.outcome === "SUCCESS" && !result.replayed,
    `${label}: authorized operator creates one new resend`,
  );
  check(
    (await manual.deliver(result.resultId)).decision === "SENT",
    `${label}: manual resend reaches the actual TLS receiver`,
  );
  await gateway.inspect();
  check(
    gateway.acceptedCount() === before + 1 &&
      captures.get(result.resultId)?.notification.eventType === eventType,
    `${label}: exactly one message preserves its authoritative event type`,
  );
  const fresh = token(result.resultId);
  check(
    fresh.token !== originalToken.token &&
      fresh.publicOrderId === originalToken.publicOrderId,
    `${label}: resend creates a fresh capability for the same order`,
  );
  const exchanged = await access.exchange(fresh.token);
  await access.read(exchanged.session, fresh.publicOrderId);
  check(
    (await manual.deliver(result.resultId)).decision === "SKIP",
    `${label}: accepted manual resend cannot dispatch twice`,
  );
  await gateway.inspect();
  check(
    gateway.acceptedCount() === before + 1,
    `${label}: retry keeps one accepted message`,
  );
}

export async function verifyDigitalNotificationResends(fixture) {
  const {
    context: { client, check, progress, fixtures },
    paid,
    command,
    request,
    automatic,
    manual,
    advance,
    gateway,
    scalar,
    state,
  } = fixture;
  const digital = { gift: fixtures.gifts[4] };
  const mixedLines = [digital, { gift: fixtures.gifts[0] }];
  progress("digital and mixed orders resend their actual payment notification");
  for (const [label, lines, fulfillmentStatus, expectedLines] of [
    ["VIRTUAL", [digital], "DELIVERED", [["VIRTUAL", "DELIVERED"]]],
    [
      "MIXED",
      mixedLines,
      "PREPARING",
      [
        ["PHYSICAL", "PENDING"],
        ["VIRTUAL", "DELIVERED"],
      ],
    ],
  ]) {
    const value = await paid(automatic, { lines, fulfillmentStatus });
    const actualLines = (
      await client.query(
        "SELECT i.gift_kind,f.status FROM order_items i JOIN fulfillments f ON f.order_item_id=i.id AND f.order_id=i.order_id WHERE i.order_id=$1 ORDER BY i.gift_kind",
        [value.state.order_id],
      )
    ).rows.map((line) => [line.gift_kind, line.status]);
    check(
      JSON.stringify(actualLines) === JSON.stringify(expectedLines),
      `${label}: fixture contains the expected actual digital and studio lines`,
    );
    await verifyDigitalResendDelivery(
      fixture,
      value,
      "PAYMENT_CONFIRMED",
      label,
    );
  }

  progress(
    "mixed preparation authority supersedes payment before queue materialization",
  );
  // A separate order avoids weakening the real cooldown after a completed resend.
  const value = await paid(automatic, {
    lines: mixedLines,
    fulfillmentStatus: "PREPARING",
  });
  const pending = await request(await command(value));
  check(
    pending.outcome === "SUCCESS",
    "mixed payment resend is durably queued",
  );
  await gateway.inspect();
  const accepted = gateway.acceptedCount();
  const source = await advance(value, "PREPARING", "PHYSICAL");
  const beforeMaterialization = await scalar(
    "SELECT public.admin_notification_current_event($1) event,(SELECT count(*)::int FROM notification_deliveries WHERE order_id=$1 AND event_type='PREPARING') preparing,(SELECT count(*)::int FROM admin_notification_resends WHERE order_id=$1) resends",
    [value.state.order_id],
  );
  check(
    beforeMaterialization.event === "PREPARING" &&
      beforeMaterialization.preparing === 0 &&
      beforeMaterialization.resends === 1,
    "real ADMIN preparation supersedes payment before a preparation notification exists",
  );
  const summary = await readAdminOrderNotification(
    client,
    value.state.order_id,
  );
  check(
    summary.status === "NONE" &&
      !summary.canResend &&
      summary.latestNotificationId === null,
    "unmaterialized current preparation cannot fall back to the old payment mail",
  );
  const staleSource = await request(await command(value));
  check(
    staleSource.outcome === "FAILURE" && staleSource.code === "STALE_VERSION",
    "old payment source cannot create a resend after preparation supersedes it",
  );
  const absentSource = await request(await command(value, null));
  check(
    absentSource.outcome === "FAILURE" &&
      absentSource.code === "INVALID_COMMAND",
    "resend contract rejects a missing current notification identifier",
  );
  check(
    (await manual.deliver(pending.resultId)).decision === "SKIP",
    "queued mixed payment resend is canceled before dispatch",
  );
  const canceled = await state(pending.resultId);
  await gateway.inspect();
  check(
    canceled.status === "CANCELED" &&
      canceled.link_token_id === null &&
      gateway.acceptedCount() === accepted &&
      (
        await scalar(
          "SELECT count(*)::int count FROM admin_notification_resends WHERE order_id=$1",
          [value.state.order_id],
        )
      ).count === 1,
    "superseded mixed resend creates no message, new link or extra dispatch record",
  );
  const preparing = await automatic.request(source);
  check(
    (await automatic.deliver(preparing.notificationId)).decision === "SENT",
    "actual mixed preparation notification sends after the old job retires",
  );
  // Caller finishes this scenario after its existing 60-second real-clock recovery test.
  return { ...value, notificationId: preparing.notificationId };
}

/** Probe the historical guard at the current schema; this is not a migration-runner rollback. */
export async function verifyResendHistoryGuard({ context: { client, check } }) {
  const digest = (value) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  async function snapshot() {
    const result = {
      functionDefinition: digest(
        (
          await client.query(
            "SELECT pg_get_functiondef('public.admin_notification_current_event(uuid)'::regprocedure) definition",
          )
        ).rows,
      ),
    };
    for (const table of [
      "schema_migrations",
      "admin_notification_resends",
      "admin_notification_resend_outbox",
      "admin_notification_resend_attempts",
      "admin_notification_resend_contact_access",
      "audit_logs",
      "order_access_audits",
      "order_access_tokens",
      "order_access_sessions",
      "notification_deliveries",
      "notification_runtime_state",
      "notification_submissions",
      "notification_delivery_attempts",
    ]) {
      const { rows } = await client.query(
        `SELECT to_jsonb(record) value FROM public.${table} record ORDER BY to_jsonb(record)::text COLLATE "C"`,
      );
      result[table] = { count: rows.length, sha256: digest(rows) };
    }
    return result;
  }
  const before = await snapshot();
  check(
    before.admin_notification_resends.count > 0,
    "historical down guard probe has actual authorized resend history",
  );
  const down = await readFile(
    new URL(
      "../../../database/migrations/0065_notification-current-event.down.sql",
      import.meta.url,
    ),
    "utf8",
  );
  let rejected = false;
  await client.query("BEGIN");
  try {
    await client.query(down);
  } catch (error) {
    rejected =
      error.code === "55000" &&
      error.message ===
        "notification resend history cannot be downgraded to aggregate-based stages";
  } finally {
    await client.query("ROLLBACK");
  }
  check(
    rejected,
    "exact historical 0065 guard refuses to discard actual resend history",
  );
  const after = await snapshot();
  check(
    JSON.stringify(after) === JSON.stringify(before),
    "historical guard probe preserves complete migration records, function and notification/access/audit history",
  );
  return {
    strategy: "CURRENT_SCHEMA_DIRECT_SQL",
    guard: "0065",
    status: "PASS",
    before,
    after,
  };
}
