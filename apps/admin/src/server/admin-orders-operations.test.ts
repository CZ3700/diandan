import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getAdminOperation } from "./admin-operations";
import { createAdminBff } from "./admin-bff";

const id = "10000000-0000-4000-8000-000000000001";
test("only a missing order-context endpoint is unavailable by capability while service failures stay retryable", async () => {
  const config = {
    schemaVersion: 1,
    mode: "TEST",
    siteOrigin: "http://localhost:3100",
    internalApiOrigin: "http://127.0.0.1:3200",
  } as const;
  const csrf = "c".repeat(43),
    session = "s".repeat(43);
  const request = () =>
    new Request(`${config.siteOrigin}/api/admin/orders-context`, {
      method: "POST",
      headers: {
        origin: config.siteOrigin,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        "x-csrf-token": csrf,
        cookie: `__Host-fan-admin-session=${session}; __Host-fan-admin-csrf=${csrf}`,
      },
      body: JSON.stringify({ schemaVersion: 1 }),
    });
  const missing = await createAdminBff({
    config,
    fetch: async () =>
      Response.json({ message: "Route unavailable" }, { status: 404 }),
  }).operation(request(), "orders-context");
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "NOT_FOUND",
  });
  const failed = await createAdminBff({
    config,
    fetch: async () =>
      Response.json({ message: "Upstream detail omitted" }, { status: 503 }),
  }).operation(request(), "orders-context");
  expect(failed.status).toBe(503);
  expect(await failed.json()).toMatchObject({
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  });
});
test("order operations keep distinct fixed routes and reject browser-supplied authority", () => {
  const operation = getAdminOperation("orders-prepare");
  expect(operation).toBeDefined();
  const body = {
    schemaVersion: 1,
    orderId: id,
    expectedOrderVersion: 1,
    fulfillmentId: id,
    expectedFulfillmentVersion: 1,
    reasonCode: "OPERATOR_PREPARE",
  };
  expect(operation!.path).toBe("/api/v1/admin/orders/prepare");
  expect(operation!.parseCommand(body, id)).toEqual({
    ...body,
    action: "PREPARE",
    idempotencyKey: id,
  });
  expect(operation!.apiBody(operation!.parseCommand(body, id))).toEqual(body);
  expect(() => operation!.parseCommand(body)).toThrow();
  for (const extra of [
    { actorId: id },
    { action: "DELIVER" },
    { sessionToken: "private" },
    { idempotencyKey: id },
  ])
    expect(() => operation!.parseCommand({ ...body, ...extra }, id)).toThrow();
});

test("order rate limits preserve their typed retry state and private response headers", async () => {
  const config = {
    schemaVersion: 1,
    mode: "TEST",
    siteOrigin: "http://localhost:3100",
    internalApiOrigin: "http://127.0.0.1:3200",
  } as const;
  const csrf = "c".repeat(43),
    session = "s".repeat(43);
  const response = await createAdminBff({
    config,
    fetch: async () =>
      Response.json(
        { schemaVersion: 1, outcome: "FAILURE", code: "RATE_LIMITED" },
        { status: 429 },
      ),
  }).operation(
    new Request(`${config.siteOrigin}/api/admin/orders-context`, {
      method: "POST",
      headers: {
        origin: config.siteOrigin,
        "content-type": "application/json",
        "x-csrf-token": csrf,
        cookie: `__Host-fan-admin-session=${session}; __Host-fan-admin-csrf=${csrf}`,
      },
      body: JSON.stringify({ schemaVersion: 1 }),
    }),
    "orders-context",
  );
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "RATE_LIMITED",
  });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

test("ordinary order reads cannot accept private message responses", () => {
  const ordinary = getAdminOperation("orders-detail");
  const sensitive = getAdminOperation("orders-message-read");
  expect(ordinary).toBeDefined();
  expect(sensitive).toBeDefined();
  const message = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MESSAGE",
    orderId: id,
    itemId: id,
    intentVersion: 1,
    accessId: id,
    expiresAt: "2026-09-19T00:00:00Z",
    reviewLocale: "en",
    content: {
      displayMode: "anonymous",
      fanMessage: "SYNTHETIC_PRIVATE",
      fanMessageLocale: "en",
    },
  };
  expect(() => ordinary!.parseResponse(message)).toThrow();
  expect(sensitive!.parseResponse(message)).toEqual(message);
  expect(() =>
    sensitive!.parseResponse({ ...message, sessionToken: "private" }),
  ).toThrow();
});

test("Manager actions require explicit confirmation and note mutations retain bounded private input", () => {
  const hold = getAdminOperation("orders-hold");
  const note = getAdminOperation("orders-note-add");
  expect(hold).toBeDefined();
  expect(note).toBeDefined();
  const line = {
    schemaVersion: 1,
    orderId: id,
    expectedOrderVersion: 1,
    fulfillmentId: id,
    expectedFulfillmentVersion: 1,
    reasonCode: "OPERATOR_HOLD",
  };
  expect(() => hold!.parseCommand(line, id)).toThrow();
  expect(hold!.parseCommand({ ...line, confirmed: true }, id)).toMatchObject({
    action: "HOLD",
    confirmed: true,
  });
  expect(note!.readOnly).toBe(false);
  expect(note!.bodyLimit).toBeLessThanOrEqual(65536);
});

test("proof operations keep fixed routes; only reservations, attachments and withdrawals are keyed", () => {
  for (const [name, path] of [
    ["orders-proof-begin", "/api/v1/admin/orders/proof-uploads/begin"],
    ["orders-proof-complete", "/api/v1/admin/orders/proof-uploads/complete"],
    ["orders-proofs-attach", "/api/v1/admin/orders/proofs/attach"],
    ["orders-proofs-withdraw", "/api/v1/admin/orders/proofs/withdraw"],
    ["orders-proofs-view", "/api/v1/admin/orders/proofs/view"],
  ] as const)
    expect(getAdminOperation(name)?.path).toBe(path);
  const complete = getAdminOperation("orders-proof-complete")!;
  expect(
    complete.parseCommand({ schemaVersion: 1, orderId: id, uploadId: id }),
  ).toEqual({
    schemaVersion: 1,
    orderId: id,
    uploadId: id,
    action: "COMPLETE_PROOF_UPLOAD",
  });
  const attach = getAdminOperation("orders-proofs-attach")!;
  const body = {
    schemaVersion: 1,
    orderId: id,
    expectedOrderVersion: 1,
    fulfillmentId: id,
    expectedFulfillmentVersion: 1,
    reasonCode: "DELIVERY_PROOF_CONFIRMED",
    uploadIds: [id],
    privacyConfirmed: true,
  };
  expect(attach.parseCommand(body, id)).toEqual({
    ...body,
    action: "ATTACH_PROOFS",
    idempotencyKey: id,
  });
  expect(() => attach.parseCommand(body)).toThrow();
  expect(() =>
    attach.parseCommand({ ...body, privacyConfirmed: false }, id),
  ).toThrow();
  expect(() =>
    getAdminOperation("orders-proofs-view")!.parseResponse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      orderId: id,
      resultId: id,
      replayed: false,
    }),
  ).toThrow();
});
