import { expect, test, vi } from "vitest";
import { adminOrdersStoreRequestSchema } from "@fan-support/contracts";
import type { TransactionScopeControl } from "./transaction-runner.js";

const module = await import("./admin-notification-resend-repository.js").catch(
  () => undefined,
);
const worker = await import("./admin-notification-resend-worker.js").catch(
  () => undefined,
);
const read = await import("./admin-notification-resend-read.js").catch(
  () => undefined,
);
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope: TransactionScopeControl = {
  markRollbackOnly: vi.fn(),
  trackOperation: (work) => work(),
};
const client = () => ({
  query: vi.fn(async () => ({ rows: [] })),
  release: vi.fn(),
});

test("malformed admin resend fails without reading any database rows", async () => {
  expect(module, "authorized resend repository must exist").toBeDefined();
  const db = client();
  const result = await module!
    .createAdminOrderResendRepository(db, scope)
    .request({} as never);
  expect(result).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "INVALID_COMMAND",
  });
  expect(db.query).not.toHaveBeenCalled();
});
test("resend permission alone cannot bypass the orders.read baseline", async () => {
  const query = vi.fn(async (sql: string) => {
    if (
      sql.startsWith("SELECT id,admin_identity_id FROM public.admin_sessions")
    )
      return { rows: [{ id: id(3), admin_identity_id: id(2) }] };
    if (sql.startsWith("SELECT id FROM public.admin_identities"))
      return { rows: [{ id: id(2) }] };
    if (sql.includes("s.session_token_digest=$1"))
      return {
        rows: [
          {
            actor_id: id(2),
            session_id: id(3),
            csrf_token_digest: Buffer.from("a".repeat(64), "hex"),
            expires_at: "2099-01-01T00:00:00Z",
          },
        ],
      };
    if (sql.includes("p.permission_key FROM"))
      return { rows: [{ permission_key: "orders.notification.resend" }] };
    if (sql.includes("SELECT to_char(clock_timestamp()"))
      return { rows: [{ now: "2026-09-21T00:00:00Z" }] };
    if (sql.includes(" live FROM")) return { rows: [{ live: true }] };
    return { rows: [] };
  });
  const repo = module!.createAdminOrderResendRepository(
    { query, release: vi.fn() },
    scope,
  );
  expect(
    await repo.request(
      adminOrdersStoreRequestSchema.parse({
        schemaVersion: 1,
        requestHash: "b".repeat(64),
        access: {
          schemaVersion: 1,
          sessionTokenDigest: "a".repeat(64),
          csrfTokenDigest: "a".repeat(64),
          requestId: id(4),
          correlationId: id(5),
        },
        command: {
          schemaVersion: 1,
          action: "RESEND_NOTIFICATION",
          orderId: id(6),
          expectedOrderVersion: 2,
          expectedLatestNotificationId: id(7),
          idempotencyKey: "resend-permission-baseline",
          reasonCode: "FAN_REQUESTED_UPDATE",
        },
      }),
    ),
  ).toMatchObject({ outcome: "FAILURE", code: "FORBIDDEN" });
  expect(
    query.mock.calls.some(([sql]) => /INSERT|UPDATE public/u.test(sql)),
  ).toBe(false);
});
test("missing order notification has no resend action or private fields", async () => {
  expect(read, "safe notification summary must exist").toBeDefined();
  expect(await read!.readAdminOrderNotification(client(), id(1))).toEqual({
    latestNotificationId: null,
    eventType: null,
    status: "NONE",
    canResend: false,
  });
});
test("worker cannot create a resend from a generic source event", async () => {
  expect(worker, "resend worker repository must exist").toBeDefined();
  const db = client();
  const repo = worker!.createAdminOrderResendNotificationRepository(db, scope);
  expect(await repo.source({ schemaVersion: 1, outboxEventId: id(1) })).toEqual(
    { schemaVersion: 1, decision: "IGNORED" },
  );
  expect(db.query).not.toHaveBeenCalled();
});
test("missing resend cannot acquire lease or authorize recipient access", async () => {
  expect(worker).toBeDefined();
  const repo = worker!.createAdminOrderResendNotificationRepository(
    client(),
    scope,
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
  await expect(
    repo.recipient({
      schemaVersion: 1,
      notificationId: id(1),
      leaseToken: id(2),
    }),
  ).rejects.toMatchObject({ code: "LEASE_LOST" });
});
test("oversized recovery batch is rejected before SQL", async () => {
  expect(worker).toBeDefined();
  const db = client();
  const repo = worker!.createAdminOrderResendNotificationRepository(db, scope);
  await expect(
    repo.listPending({ schemaVersion: 1, limit: 101 }),
  ).rejects.toMatchObject({ code: "INVALID_COMMAND" });
  expect(db.query).not.toHaveBeenCalled();
});

test.each([
  {
    status: "SENT",
    unknown: false,
    busy: false,
    throttled: false,
    contact_active: true,
    unresolved: false,
    canResend: true,
  },
  {
    status: "FAILED",
    unknown: true,
    busy: false,
    throttled: false,
    contact_active: true,
    unresolved: true,
    canResend: false,
  },
  {
    status: "SENT",
    unknown: false,
    busy: true,
    throttled: false,
    contact_active: true,
    unresolved: false,
    canResend: false,
  },
  {
    status: "SENT",
    unknown: false,
    busy: false,
    throttled: true,
    contact_active: true,
    unresolved: false,
    canResend: false,
  },
  {
    status: "SENT",
    unknown: false,
    busy: false,
    throttled: false,
    contact_active: false,
    unresolved: false,
    canResend: false,
  },
  {
    status: "SENT",
    unknown: false,
    busy: false,
    throttled: false,
    contact_active: true,
    unresolved: true,
    canResend: false,
  },
])("resend summary preserves current delivery gate %#", async (row) => {
  const query = vi.fn(async () => ({
    rows: [{ ...row, latest_id: id(1), event_type: "PAYMENT_CONFIRMED" }],
  }));
  const result = await read!.readAdminOrderNotification(
    { query, release: vi.fn() },
    id(2),
  );
  expect(result.canResend).toBe(row.canResend);
  expect(result.status).toBe(row.unknown ? "UNKNOWN" : row.status);
  expect(Object.keys(result).sort()).toEqual([
    "canResend",
    "eventType",
    "latestNotificationId",
    "status",
  ]);
});
