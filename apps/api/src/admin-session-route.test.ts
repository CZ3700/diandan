import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import { registerAdminSessionRoute } from "./admin-session-route.js";
const origin = "https://admin.example.invalid",
  token = "a".repeat(42) + "A",
  csrf = "b".repeat(42) + "A";
const path = "/api/v1/admin/session/read";
const response = {
  schemaVersion: 1 as const,
  outcome: "SUCCESS" as const,
  kind: "ADMIN_SESSION" as const,
  actorId: "10000000-0000-4000-8000-000000000001",
  permissions: ["content.read" as const],
  localeScopes: ["ja" as const],
};
const headers = {
  origin,
  cookie: `__Host-fan-admin-session=${token}`,
  "x-csrf-token": csrf,
  "content-type": "application/json",
};
function setup() {
  const app = Fastify({ logger: false }),
    execute = vi.fn(async () => response);
  registerAdminSessionRoute(app, {
    allowedOrigin: origin,
    useCases: { execute },
  });
  return { app, execute };
}
function privacy(value: { headers: Record<string, unknown> }) {
  expect(value.headers["cache-control"]).toBe("private, no-store");
  expect(value.headers["x-robots-tag"]).toBe("noindex, nofollow");
  expect(value.headers["referrer-policy"]).toBe("no-referrer");
  expect(value.headers["set-cookie"]).toBeUndefined();
}
test("session reads inject current credentials and a server request id, never client authority", async () => {
  const { app, execute } = setup();
  try {
    const result = await app.inject({
      method: "POST",
      url: path,
      headers,
      payload: { schemaVersion: 1 },
    });
    expect(result.statusCode).toBe(200);
    privacy(result);
    expect(result.json()).toEqual(response);
    expect(execute).toHaveBeenCalledWith({
      schemaVersion: 1,
      requestId: expect.stringMatching(/^[a-f0-9-]{36}$/u),
      sessionToken: token,
      csrfToken: csrf,
      command: { schemaVersion: 1, action: "READ_SESSION" },
    });
    const forged = await app.inject({
      method: "POST",
      url: path,
      headers,
      payload: { schemaVersion: 1, actorId: response.actorId },
    });
    expect(forged.statusCode).toBe(400);
    privacy(forged);
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});
test("missing session, duplicate cookie, Origin and CSRF failures are private", async () => {
  const { app, execute } = setup();
  try {
    for (const [change, expected] of [
      [{ cookie: "other=value" }, 401],
      [{ cookie: `${headers.cookie};${headers.cookie}` }, 401],
      [{ origin: "https://other.example.invalid" }, 403],
      [{ "x-csrf-token": "bad" }, 403],
      [{ "sec-fetch-site": "cross-site" }, 403],
    ] as const) {
      const result = await app.inject({
        method: "POST",
        url: path,
        headers: { ...headers, ...change },
        payload: { schemaVersion: 1 },
      });
      expect(result.statusCode).toBe(expected);
      privacy(result);
    }
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
test("query credentials, malformed JSON, oversized bodies and unsupported methods retain safe headers", async () => {
  const { app } = setup();
  try {
    for (const [url, payload, expected] of [
      [path + "?token=invalid", "{}", 400],
      [path, "{", 400],
      [path, JSON.stringify({ value: "x".repeat(65536) }), 413],
    ] as const) {
      const result = await app.inject({
        method: "POST",
        url,
        headers,
        payload,
      });
      expect(result.statusCode).toBe(expected);
      privacy(result);
    }
    const result = await app.inject({ method: "GET", url: path, headers });
    expect(result.statusCode).toBe(404);
    privacy(result);
  } finally {
    await app.close();
  }
});
test("invalid or thrown upstream results cannot expose credentials", async () => {
  const { app, execute } = setup();
  try {
    execute
      .mockResolvedValueOnce({ ...response, sessionToken: token } as never)
      .mockRejectedValueOnce(new Error(token));
    for (let index = 0; index < 2; index++) {
      const result = await app.inject({
        method: "POST",
        url: path,
        headers,
        payload: { schemaVersion: 1 },
      });
      expect(result.statusCode).toBe(503);
      privacy(result);
      expect(result.json()).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CONTENT_UNAVAILABLE",
      });
    }
  } finally {
    await app.close();
  }
});
