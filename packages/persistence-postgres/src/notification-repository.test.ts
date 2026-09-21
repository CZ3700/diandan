import { expect, test, vi } from "vitest";
import { sourceHashSchema } from "@fan-support/contracts";
import type { TransactionScopeControl } from "./transaction-runner.js";

const module = await import("./notification-repository.js").catch(
  () => undefined,
);
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope: TransactionScopeControl = {
  markRollbackOnly: vi.fn(),
  trackOperation: (work) => work(),
};
const outbox = { append: vi.fn() };
function setup() {
  expect(module, "durable notification repository must exist").toBeDefined();
  const query = vi.fn(async () => ({ rows: [] }));
  return {
    query,
    repository: module!.createNotificationRepository(
      { query, release: vi.fn() },
      scope,
      outbox,
    ),
  };
}

test("unrelated or missing source events cannot request fan mail", async () => {
  const { repository, query } = setup();
  expect(
    await repository.source({ schemaVersion: 1, outboxEventId: id(1) }),
  ).toEqual({ schemaVersion: 1, decision: "IGNORED" });
  expect(query).toHaveBeenCalledTimes(1);
  expect(outbox.append).not.toHaveBeenCalled();
});

test("a missing or retired notification cannot be claimed or completed", async () => {
  const { repository } = setup();
  expect(
    await repository.claim({
      schemaVersion: 1,
      notificationId: id(1),
      leaseToken: id(2),
      leaseSeconds: 30,
      maxAttempts: 6,
    }),
  ).toEqual({ schemaVersion: 1, decision: "SKIP" });
  expect(
    await repository.finish({
      schemaVersion: 1,
      notificationId: id(1),
      leaseToken: id(2),
      retryDelaySeconds: 1,
      maxAttempts: 6,
      result: {
        schemaVersion: 1,
        operation: "SEND_NOTIFICATION",
        outcome: "SUCCESS",
        value: {
          status: "ACCEPTED",
          providerReference: "local/example",
          acceptedAt: "2026-09-16T00:00:00.000Z",
        },
      },
    }),
  ).toEqual({ schemaVersion: 1, decision: "SKIP" });
});

test("a lost lease never authorizes contact decryption", async () => {
  const { repository } = setup();
  await expect(
    repository.recipient({
      schemaVersion: 1,
      notificationId: id(1),
      leaseToken: id(2),
    }),
  ).rejects.toMatchObject({ code: "LEASE_LOST" });
});

test("invalid commands fail before any SQL", async () => {
  const { repository, query } = setup();
  await expect(
    repository.listPending({ schemaVersion: 1, limit: 101 }),
  ).rejects.toMatchObject({ code: "INVALID_COMMAND" });
  expect(query).not.toHaveBeenCalled();
});

test("an automatic later stage waits for a pending operator resend", async () => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT d.order_id,o.cart_id"))
      return { rows: [{ order_id: id(3), cart_id: id(4) }] };
    if (sql.includes("FOR UPDATE OF d,r"))
      return {
        rows: [
          {
            id: id(1),
            order_id: id(3),
            status: "REQUESTED",
            attempt_count: 0,
            event_rank: 3,
            next_attempt_at: null,
            dedupe_until: "2099-01-01T00:00:00Z",
          },
        ],
      };
    if (sql.includes("SELECT to_char(clock_timestamp()"))
      return { rows: [{ now: "2026-09-21T01:00:00.000000Z" }] };
    if (
      sql.includes("admin_notification_resends") &&
      sql.includes("PROCESSING")
    )
      return { rows: [{ blocked: true }] };
    return { rows: [] };
  });
  const repo = module!.createNotificationRepository(
    { query, release: vi.fn() },
    scope,
    outbox,
  );
  expect(
    await repo.claim({
      schemaVersion: 1,
      notificationId: id(1),
      leaseToken: id(2),
      leaseSeconds: 30,
      maxAttempts: 6,
    }),
  ).toEqual({ schemaVersion: 1, decision: "SKIP" });
  expect(
    query.mock.calls.some(([sql]) =>
      sql.includes("UPDATE public.notification_deliveries"),
    ),
  ).toBe(false);
});

function stateful(row: Record<string, unknown>) {
  expect(module).toBeDefined();
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT d.order_id,o.cart_id"))
      return { rows: [{ order_id: id(3), cart_id: id(4) }] };
    if (sql.includes("FOR UPDATE OF d,r")) return { rows: [row] };
    if (sql.includes("SELECT to_char(clock_timestamp()"))
      return { rows: [{ now: "2026-09-16T01:00:00.000000Z" }] };
    if (sql.includes("SELECT r.lease_expires_at"))
      return { rows: [{ valid: true }] };
    return { rows: [] };
  });
  return {
    query,
    repository: module!.createNotificationRepository(
      { query, release: vi.fn() },
      scope,
      outbox,
    ),
  };
}

test("an expired in-flight attempt reports FAILED when the budget is exhausted", async () => {
  const { repository, query } = stateful({
    id: id(1),
    order_id: id(3),
    status: "PROCESSING",
    attempt_count: 5,
    lease_started_at: "2026-09-16T00:00:00Z",
    lease_expires_at: "2026-09-16T00:00:01Z",
    dedupe_until: "2026-09-16T02:00:00Z",
  });
  expect(
    await repository.claim({
      schemaVersion: 1,
      notificationId: id(1),
      leaseToken: id(2),
      leaseSeconds: 30,
      maxAttempts: 6,
    }),
  ).toEqual({ schemaVersion: 1, decision: "FAILED" });
  expect(
    query.mock.calls.some(([sql]) =>
      sql.includes("INSERT INTO public.notification_delivery_attempts"),
    ),
  ).toBe(true);
});

test("content drift ends the active attempt and reports an actionable failure", async () => {
  const { repository, query } = stateful({
    id: id(1),
    order_id: id(3),
    status: "PROCESSING",
    attempt_count: 1,
    lease_started_at: "2026-09-16T00:59:59Z",
    content_hash: "a".repeat(64),
  });
  expect(
    await repository.confirmSend({
      schemaVersion: 1,
      notificationId: id(1),
      leaseToken: id(2),
      contentHash: sourceHashSchema.parse("b".repeat(64)),
    }),
  ).toEqual({ schemaVersion: 1, decision: "FAILED" });
  expect(
    query.mock.calls.some(([sql]) =>
      sql.includes("INSERT INTO public.notification_delivery_attempts"),
    ),
  ).toBe(true);
});

test("an unsent request past its deadline records a failed preparation attempt without provider work", async () => {
  const { repository, query } = stateful({
    id: id(1),
    order_id: id(3),
    status: "REQUESTED",
    attempt_count: 0,
    lease_started_at: null,
    lease_expires_at: null,
    dedupe_until: "2026-09-16T00:00:00Z",
  });
  expect(
    await repository.claim({
      schemaVersion: 1,
      notificationId: id(1),
      leaseToken: id(2),
      leaseSeconds: 30,
      maxAttempts: 6,
    }),
  ).toEqual({ schemaVersion: 1, decision: "FAILED" });
  expect(
    query.mock.calls.some(([sql]) => sql.includes("SET status='PROCESSING'")),
  ).toBe(true);
  expect(
    query.mock.calls.some(([sql]) =>
      sql.includes("INSERT INTO public.notification_delivery_attempts"),
    ),
  ).toBe(true);
});
