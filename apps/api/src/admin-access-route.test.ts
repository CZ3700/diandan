import { adminAccessBeginResponseSchema } from "@fan-support/contracts";
import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import { registerAdminAccessRoute } from "./admin-access-route.js";
const origin = "https://admin.example.invalid",
  accessKey = "a".repeat(64),
  id = "10000000-0000-4000-8000-000000000001";
const value = adminAccessBeginResponseSchema.parse({
  schemaVersion: 1 as const,
  outcome: "SUCCESS" as const,
  kind: "LOGIN_REDIRECT" as const,
  authorizationUrl: "https://identity.example.invalid/authorize",
  browserToken: "a".repeat(42) + "A",
  expiresAt: "2026-09-18T02:00:00.000Z",
});
const body = { schemaVersion: 1, requestId: id, locale: "ja" };
const headers = {
  origin,
  "x-admin-access-key": accessKey,
  "content-type": "application/json",
};
function setup() {
  const app = Fastify({ logger: false }),
    begin = vi.fn(async () => value),
    callback = vi.fn(),
    logout = vi.fn();
  registerAdminAccessRoute(app, {
    allowedOrigin: origin,
    accessKey,
    useCases: { begin, callback, logout },
  });
  return { app, begin, callback, logout };
}
test("private login endpoint requires BFF authentication and preserves strict schema", async () => {
  const s = setup();
  try {
    const r = await s.app.inject({
      method: "POST",
      url: "/api/v1/admin/access/begin",
      headers,
      payload: body,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual(value);
    expect(s.begin).toHaveBeenCalledWith(body);
    expect(r.headers["cache-control"]).toBe("private, no-store");
    expect(r.headers["referrer-policy"]).toBe("no-referrer");
  } finally {
    await s.app.close();
  }
});
test("missing or duplicate internal keys, cross-origin and client role cannot reach application", async () => {
  const s = setup();
  try {
    for (const change of [
      { "x-admin-access-key": "" },
      { "x-admin-access-key": [accessKey, accessKey] },
      { origin: "https://other.example.invalid" },
      { "sec-fetch-site": "cross-site" },
    ]) {
      const r = await s.app.inject({
        method: "POST",
        url: "/api/v1/admin/access/begin",
        headers: { ...headers, ...change },
        payload: body,
      });
      expect(r.statusCode).toBe(403);
    }
    const r = await s.app.inject({
      method: "POST",
      url: "/api/v1/admin/access/begin",
      headers,
      payload: { ...body, roles: ["manager"] },
    });
    expect(r.statusCode).toBe(400);
    expect(s.begin).not.toHaveBeenCalled();
  } finally {
    await s.app.close();
  }
});
test("query tokens, oversized bodies and thrown provider internals are private sanitized failures", async () => {
  const s = setup();
  try {
    for (const [url, payload, status] of [
      ["/api/v1/admin/access/begin?code=private", body, 400],
      ["/api/v1/admin/access/begin", "{", 400],
      [
        "/api/v1/admin/access/begin",
        JSON.stringify({ value: "x".repeat(10000) }),
        413,
      ],
    ] as const) {
      const r = await s.app.inject({ method: "POST", url, headers, payload });
      expect(r.statusCode).toBe(status);
      expect(r.headers["cache-control"]).toBe("private, no-store");
    }
    s.begin.mockRejectedValueOnce(Error("private-value"));
    const r = await s.app.inject({
      method: "POST",
      url: "/api/v1/admin/access/begin",
      headers,
      payload: body,
    });
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toContain("private-value");
  } finally {
    await s.app.close();
  }
});
