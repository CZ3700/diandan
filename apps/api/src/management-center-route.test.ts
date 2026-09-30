import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import { registerManagementCenterRoute } from "./management-center-route.js";
const id = "00000000-0000-4000-8000-000000000001";
const origin = "http://localhost:3100";
const headers = {
  origin,
  "content-type": "application/json",
  cookie: `__Host-fan-admin-session=${"s".repeat(43)}`,
  "x-csrf-token": "c".repeat(43),
  "idempotency-key": "management-submit-01",
};
const intent = {
  kind: "SAVE_ARTIST",
  sourceLocale: "th",
  id: null,
  expectedVersion: 0,
  name: "Artist",
  description: "Description",
  image: { uploadId: id },
};
const operation = {
  operationId: id,
  version: 1,
  kind: "SAVE_ARTIST",
  sourceLocale: "th",
  status: "PROCESSING",
  targetId: id,
  updatedAt: "2026-09-08T00:00:00Z",
  result: null,
  failure: null,
};
test("original preview is a private read bound to the current target and version", async () => {
  const app = Fastify({ logger: false });
  const target = { kind: "ARTIST", id, expectedVersion: 2 };
  const result = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "ORIGINAL_IMAGE",
    target,
    currentImage: { assetId: id, metadataRevisionId: id },
    focalPoint: { x: 0.5, y: 0.3 },
    sourceWidth: 800,
    sourceHeight: 1200,
    download: {
      method: "GET",
      url: "https://media.example.invalid/private-preview",
      headers: {},
      expiresAt: "2026-09-28T08:00:00Z",
    },
  };
  const execute = vi.fn().mockResolvedValue(result);
  registerManagementCenterRoute(app, {
    allowedOrigin: origin,
    useCases: { execute },
  });
  const read = () =>
    app.inject({
      method: "POST",
      url: "/api/v1/admin/management/images/read",
      headers,
      payload: { schemaVersion: 1, target },
    });
  try {
    const response = await read();
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: { schemaVersion: 1, action: "READ_IMAGE_SOURCE", target },
      }),
    );
    for (const changed of [
      { ...target, id: id.replace(/1$/u, "2") },
      { ...target, kind: "GIFT" },
      { ...target, expectedVersion: 3 },
    ]) {
      execute.mockResolvedValueOnce({ ...result, target: changed });
      expect((await read()).statusCode).toBe(503);
    }
  } finally {
    await app.close();
  }
});
test("a locked inventory policy returns the precise private 409 failure", async () => {
  const app = Fastify({ logger: false });
  const value = {
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "INVENTORY_POLICY_LOCKED",
  };
  registerManagementCenterRoute(app, {
    allowedOrigin: origin,
    useCases: { execute: vi.fn().mockResolvedValue(value) },
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/management/submit",
      headers,
      payload: {
        schemaVersion: 1,
        intent: {
          ...intent,
          kind: "SAVE_GIFT",
          id,
          expectedVersion: 2,
          image: null,
          giftKind: "VIRTUAL",
          category: "OTHER",
          price: { market: "TEST", currency: "USD", amountMinor: 1000 },
          inventory: { policy: "PROCURE_ON_DEMAND" },
          eligibility: { rule: "ALL_ACTIVE_ARTISTS" },
        },
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual(value);
    expect(response.headers["cache-control"]).toBe("private, no-store");
  } finally {
    await app.close();
  }
});
test("one submit injects real transport credentials and strictly binds operation response", async () => {
  const app = Fastify({ logger: false });
  const execute = vi.fn().mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "OPERATION",
    operation,
  });
  registerManagementCenterRoute(app, {
    allowedOrigin: origin,
    useCases: { execute },
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/management/submit",
      headers,
      payload: { schemaVersion: 1, intent },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: {
          schemaVersion: 1,
          action: "SUBMIT",
          intent,
          idempotencyKey: headers["idempotency-key"],
        },
      }),
    );
    execute.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "OPERATION",
      operation: { ...operation, sourceLocale: "en" },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/admin/management/submit",
          headers,
          payload: { schemaVersion: 1, intent },
        })
      ).statusCode,
    ).toBe(503);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/admin/management/submit",
          headers,
          payload: { schemaVersion: 1, intent, actorId: id },
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});
test("status checks exact operation ID and never returns another operation", async () => {
  const app = Fastify({ logger: false });
  const execute = vi.fn().mockResolvedValue({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "OPERATION",
    operation,
  });
  registerManagementCenterRoute(app, {
    allowedOrigin: origin,
    useCases: { execute },
  });
  try {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/admin/management/operations/read",
          headers,
          payload: { schemaVersion: 1, operationId: id.replace(/1$/u, "2") },
        })
      ).statusCode,
    ).toBe(503);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/admin/management/operations/read?x=1",
          headers,
          payload: { schemaVersion: 1, operationId: id },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/admin/management/operations/read",
          headers: { ...headers, origin: "https://other.invalid" },
          payload: { schemaVersion: 1, operationId: id },
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    await app.close();
  }
});
test("assigning an artist is a private mutation bound to the artist and broker it asked for", async () => {
  const app = Fastify({ logger: false });
  const brokerId = id.replace(/1$/u, "2");
  const assigned = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "ARTIST_ASSIGNED",
    artistId: id,
    assignment: { brokerId, displayName: "Mina Park", active: true },
  };
  const execute = vi.fn().mockResolvedValue(assigned);
  registerManagementCenterRoute(app, {
    allowedOrigin: origin,
    useCases: { execute },
  });
  const assign = (payload: Record<string, unknown>, extra = {}) =>
    app.inject({
      method: "POST",
      url: "/api/v1/admin/management/artists/assign",
      headers: { ...headers, ...extra },
      payload: { schemaVersion: 1, ...payload },
    });
  const body = { artistId: id, brokerId, expectedBrokerId: null };
  try {
    const response = await assign(body);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: {
          schemaVersion: 1,
          action: "ASSIGN_ARTIST",
          ...body,
          idempotencyKey: headers["idempotency-key"],
        },
      }),
    );
    // Another artist, another broker, or "unassigned" when a broker was asked for.
    for (const wrong of [
      { ...assigned, artistId: brokerId },
      { ...assigned, assignment: { ...assigned.assignment, brokerId: id } },
      { ...assigned, assignment: null },
    ]) {
      execute.mockResolvedValueOnce(wrong);
      expect((await assign(body)).statusCode).toBe(503);
    }
    execute.mockResolvedValueOnce({ ...assigned, assignment: null });
    expect(
      (await assign({ ...body, brokerId: null, expectedBrokerId: brokerId }))
        .statusCode,
    ).toBe(200);
    execute.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "FORBIDDEN",
    });
    expect((await assign(body)).statusCode).toBe(403);
    expect((await assign({ ...body, actorId: id })).statusCode).toBe(400);
    expect(
      (await assign(body, { origin: "https://other.invalid" })).statusCode,
    ).toBe(403);
  } finally {
    await app.close();
  }
});
