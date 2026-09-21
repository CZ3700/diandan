import { randomUUID } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import {
  adminOrdersAccessSchema,
  adminOrdersPrincipalSchema,
  type AdminOrdersStoreRequest,
} from "@fan-support/contracts";
import { createAdminOrdersRepository } from "./admin-orders-repository.js";
import { authorizeAdminOrders } from "./admin-orders-authorization.js";
import {
  fulfillmentActions,
  deriveAdminOrderFulfillment,
} from "./admin-orders-rules.js";
import { readAdminOrderReceipt } from "./admin-orders-data.js";
import type { TransactionScopeControl } from "./transaction-runner.js";
const access = adminOrdersAccessSchema.parse({
  schemaVersion: 1,
  sessionTokenDigest: "a".repeat(64),
  csrfTokenDigest: "b".repeat(64),
  requestId: randomUUID(),
  correlationId: randomUUID(),
});
const client = (values: unknown[][] = []) => ({
  query: vi.fn(async () => ({ rows: values.shift() ?? [] })),
  release: () => undefined,
});
const scope: TransactionScopeControl = {
  trackOperation: (work) => work(),
  markRollbackOnly: vi.fn(),
};
const order = {
  order_status: "OPEN",
  payment_status: "PAID",
  dispute_status: "NONE",
};
const line = {
  status: "PENDING",
  moderation_status: "PENDING",
  privacy_state: "ACTIVE",
  has_message: false,
  has_display_name: true,
};
describe("admin orders persistence boundary", () => {
  test("invalid commands never query or write", async () => {
    const db = client(),
      repo = createAdminOrdersRepository(db, scope, {
        publicMediaBaseUrl: "https://media.example.invalid/",
      });
    for (const method of [
      "execute",
      "preparePrivate",
      "confirmPrivate",
    ] as const)
      expect(await repo[method]({ schemaVersion: 99 } as never)).toMatchObject({
        code: "INVALID_COMMAND",
      });
    expect(db.query).not.toHaveBeenCalled();
  });
  test("missing live session cannot discover orders", async () => {
    const db = client(),
      repo = createAdminOrdersRepository(db, scope, {
        publicMediaBaseUrl: "https://media.example.invalid/",
      });
    const request: AdminOrdersStoreRequest = {
      schemaVersion: 1,
      access,
      requestHash: null,
      command: { schemaVersion: 1, action: "CONTEXT" },
    };
    expect(await repo.execute(request)).toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
  test("short or incorrect CSRF cannot authorize", async () => {
    for (const digest of [Buffer.alloc(1), Buffer.alloc(32)]) {
      const actorId = randomUUID(),
        sessionId = randomUUID();
      const db = client([
        [{ id: sessionId, admin_identity_id: actorId }],
        [{ id: actorId }],
        [
          {
            actor_id: actorId,
            session_id: randomUUID(),
            csrf_token_digest: digest,
          },
        ],
      ]);
      expect(
        await authorizeAdminOrders(db, access, { permission: "orders.read" }),
      ).toMatchObject({ code: "CSRF_INVALID" });
      expect(db.query).toHaveBeenCalledTimes(3);
    }
  });
  test("session expiry after authorization locks prevents access", async () => {
    const actorId = randomUUID(),
      sessionId = randomUUID();
    const db = client([
      [{ id: sessionId, admin_identity_id: actorId }],
      [{ id: actorId }],
      [
        {
          actor_id: actorId,
          session_id: randomUUID(),
          csrf_token_digest: Buffer.from(access.csrfTokenDigest, "hex"),
          expires_at: "2026-09-21T10:00:00.000000Z",
        },
      ],
      [{ permission_key: "orders.read" }],
      [],
      [{ now: "2026-09-21T09:59:59.999999Z" }],
      [{ live: false }],
    ]);
    expect(
      await authorizeAdminOrders(db, access, { permission: "orders.read" }),
    ).toMatchObject({ code: "UNAUTHENTICATED" });
  });
  test("changed session ownership fails closed after the identity lock", async () => {
    const actorId = randomUUID(),
      sessionId = randomUUID();
    const db = client([
      [{ id: sessionId, admin_identity_id: actorId }],
      [{ id: actorId }],
      [],
    ]);
    expect(
      await authorizeAdminOrders(db, access, { permission: "orders.read" }),
    ).toMatchObject({ code: "UNAUTHENTICATED" });
    const calls = db.query.mock.calls as unknown as [string, unknown[]][];
    expect(calls[1]?.[0]).toContain("public.admin_identities");
    expect(calls[2]?.[1]).toEqual([
      Buffer.from(access.sessionTokenDigest, "hex"),
      actorId,
      sessionId,
    ]);
  });
  test("private names and purge pending block fulfillment", () => {
    expect(fulfillmentActions(order, line, ["orders.fulfillment"])).toEqual([]);
    expect(
      fulfillmentActions(
        order,
        {
          ...line,
          moderation_status: "APPROVED",
          privacy_state: "PURGE_PENDING",
        },
        ["orders.fulfillment"],
      ),
    ).toEqual([]);
    expect(
      fulfillmentActions(order, { ...line, moderation_status: "APPROVED" }, [
        "orders.fulfillment",
      ]),
    ).toEqual(["PREPARE"]);
  });
  test.each(["UNPAID", "PENDING", "PARTIALLY_REFUNDED", "REFUNDED", "FAILED"])(
    "payment %s cannot become admin fulfillment authority",
    (payment_status) => {
      expect(
        fulfillmentActions(
          { ...order, payment_status },
          { ...line, moderation_status: "APPROVED" },
          ["orders.manage", "orders.fulfillment"],
        ),
      ).toEqual([]);
    },
  );
  test("only application-owned holds resume and terminals never move", () => {
    const held = {
      ...line,
      status: "ON_HOLD",
      moderation_status: "APPROVED",
      has_message: true,
      has_display_name: false,
      resume_status: null,
    };
    expect(fulfillmentActions(order, held, ["orders.manage"])).toEqual([]);
    expect(
      fulfillmentActions(order, { ...held, resume_status: "PREPARING" }, [
        "orders.manage",
      ]),
    ).toEqual(["RESUME"]);
    expect(
      fulfillmentActions(order, { ...held, status: "DELIVERED" }, [
        "orders.manage",
        "orders.fulfillment",
      ]),
    ).toEqual([]);
    expect(
      fulfillmentActions(order, { ...held, status: "CANCELED" }, [
        "orders.manage",
        "orders.fulfillment",
      ]),
    ).toEqual([]);
  });
  test.each([
    [["PENDING", "PENDING"], "PENDING"],
    [["PREPARING", "PENDING"], "PREPARING"],
    [["PREPARING", "DELIVERED"], "PREPARING"],
    [["DELIVERED", "DELIVERED"], "DELIVERED"],
    [["DELIVERED", "ON_HOLD"], "ON_HOLD"],
    [["CANCELED", "CANCELED"], "CANCELED"],
  ])("aggregate follows the entire order %j", (states, target) =>
    expect(
      deriveAdminOrderFulfillment(states.map((status) => ({ status }))),
    ).toBe(target),
  );
  test("idempotency replay requires both exact request hash and order identity", async () => {
    const principal = adminOrdersPrincipalSchema.parse({
      actorId: randomUUID(),
      sessionId: randomUUID(),
      authorizedAt: "2026-09-21T09:00:00.000000Z",
      sessionExpiresAt: "2026-09-21T10:00:00.000000Z",
      permissions: ["orders.note"],
      reviewLocales: [],
    });
    const request = {
      schemaVersion: 1,
      access,
      requestHash: "c".repeat(64),
      command: {
        schemaVersion: 1,
        action: "ADD_NOTE",
        orderId: randomUUID(),
        idempotencyKey: randomUUID(),
      },
    } as AdminOrdersStoreRequest;
    const db = client([
      [
        {
          order_id: randomUUID(),
          result_id: randomUUID(),
          request_hash: request.requestHash,
        },
      ],
    ]);
    expect(await readAdminOrderReceipt(db, request, principal)).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });
});
