import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import { adminContentFailureSchema } from "@fan-support/contracts";
import { createStructuredLogger } from "@fan-support/observability";
import { registerFastifyObservability } from "@fan-support/observability/fastify";
import { registerAdminContentRoute } from "./admin-content-route.js";
import {
  registerPublicationPreflightRoute,
  type PublicationPreflightRouteDependencies,
} from "./publication-preflight-route.js";

const origin = "https://admin.example.invalid";
const token = "a".repeat(42) + "A";
const csrf = "b".repeat(42) + "E";
const id = "abcdefab-0000-4000-8000-000000000001";
const otherId = "abcdefab-0000-4000-8000-000000000002";
const requestId = "20000000-0000-4000-8000-000000000001";
const prefix = "/api/v1/admin/content/publication";
const endpoint = prefix + "/preflight";
const target = {
  owner: { kind: "IDOL", idolId: id },
  revisionId: id,
} as const;
const command = { schemaVersion: 1, action: "PUBLISH", target } as const;
const success = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "PUBLICATION_PREFLIGHT",
  target,
  action: "PUBLISH",
  headVersion: 0,
  contentHash: "a".repeat(64),
  evaluatedAt: "2026-09-06T00:00:00.123456Z",
  ready: true,
  issues: [],
} as const;
const headers = {
  origin,
  cookie: `__Host-fan-admin-session=${token}`,
  "x-csrf-token": csrf,
  "content-type": "application/json",
  "x-request-id": requestId,
};

function setup() {
  const logs: string[] = [];
  const app = Fastify({ logger: false });
  registerFastifyObservability(app, {
    service: "api",
    logger: createStructuredLogger({
      service: "api",
      write: (line) => {
        logs.push(line);
      },
    }),
  });
  const execute = vi.fn<(input: unknown) => Promise<unknown>>(
    async () => success,
  );
  registerPublicationPreflightRoute(app, {
    allowedOrigin: origin,
    useCases: {
      execute:
        execute as PublicationPreflightRouteDependencies["useCases"]["execute"],
    },
  });
  return { app, execute, logs };
}

function privacy(value: Record<string, unknown>) {
  expect(value["cache-control"]).toBe("private, no-store");
  expect(value["x-robots-tag"]).toBe("noindex, nofollow");
  expect(value["referrer-policy"]).toBe("no-referrer");
  expect(value["access-control-allow-origin"]).toBeUndefined();
}

test("accepts only the target/action command and supplies credentials and observed request ID without mutation keys", async () => {
  const { app, execute } = setup();
  try {
    for (const action of ["PUBLISH", "ROLLBACK"] as const) {
      execute.mockResolvedValueOnce({ ...success, action });
      const response = await app.inject({
        method: "POST",
        url: endpoint,
        headers,
        payload: { ...command, action },
      });
      expect(response.statusCode).toBe(200);
      privacy(response.headers);
      expect(execute).toHaveBeenLastCalledWith({
        schemaVersion: 1,
        requestId,
        sessionToken: token,
        csrfToken: csrf,
        command: { ...command, action },
      });
    }
  } finally {
    await app.close();
  }
});

test("rejects missing, duplicate and encoded authority credentials before application access", async () => {
  const { app, execute } = setup();
  try {
    for (const candidate of [
      { ...headers, origin: undefined },
      { ...headers, origin: "null" },
      { ...headers, origin: origin + "/" },
      { ...headers, origin: [origin, origin] },
      { ...headers, "sec-fetch-site": "cross-site" },
      { ...headers, cookie: undefined },
      { ...headers, cookie: [headers.cookie, headers.cookie] },
      { ...headers, cookie: `${headers.cookie}; ${headers.cookie}` },
      { ...headers, cookie: `bad; ${headers.cookie}` },
      { ...headers, cookie: `__Host-fan-admin-session="${token}"` },
      { ...headers, cookie: `__Host-fan-admin-session=%61${token.slice(1)}` },
      { ...headers, "x-csrf-token": undefined },
      { ...headers, "x-csrf-token": [csrf, csrf] },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: endpoint,
        headers: Object.fromEntries(
          Object.entries(candidate).filter(([, value]) => value !== undefined),
        ),
        payload: command,
      });
      expect([401, 403]).toContain(response.statusCode);
      privacy(response.headers);
    }
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("rejects caller supplied candidates, identities, timestamps, extra target fields and unsupported commands", async () => {
  const { app, execute } = setup();
  try {
    for (const payload of [
      ...[
        "candidate",
        "actorId",
        "requestId",
        "sessionToken",
        "csrfToken",
        "evaluatedAt",
        "idempotencyKey",
        "manifest",
        "ready",
        "contentHash",
      ].map((key) => ({ ...command, [key]: "FORGED_AUTHORITY_CANARY" })),
      { ...command, schemaVersion: 2 },
      { ...command, action: "VALIDATE" },
      { ...command, target: { ...target, locale: "en" } },
      { ...command, target: { ...target, revisionId: "not-a-revision" } },
      {
        ...command,
        target: { ...target, owner: { kind: "IDOL", idolId: id, giftId: id } },
      },
      { ...command, target: { ...target, owner: { kind: "UNKNOWN" } } },
      null,
      [],
    ]) {
      const response = await app.inject({
        method: "POST",
        url: endpoint,
        headers,
        payload: JSON.stringify(payload),
      });
      expect(response.statusCode).toBe(400);
      privacy(response.headers);
    }
    for (const url of [
      endpoint + "?token=URL_CANARY",
      endpoint + "?locale=en",
    ]) {
      const response = await app.inject({
        method: "POST",
        url,
        headers,
        payload: command,
      });
      expect(response.statusCode).toBe(400);
      privacy(response.headers);
    }
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("sanitizes parsing, the 64 KiB body limit, unknown routes and methods", async () => {
  const { app, execute } = setup();
  try {
    for (const [payload, contentType, status] of [
      ["{broken", "application/json", 400],
      ["{}", "text/plain", 400],
      ["x".repeat(64 * 1024 + 1), "application/json", 413],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: endpoint,
        headers: { ...headers, "content-type": contentType },
        payload,
      });
      expect(response.statusCode).toBe(status);
      privacy(response.headers);
      expect(response.json()).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "INVALID_COMMAND",
      });
    }
    for (const [method, url] of [
      ["GET", endpoint],
      ["POST", prefix + "/unknown"],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers,
        ...(method === "POST" ? { payload: {} } : {}),
      });
      expect(response.statusCode).toBe(404);
      privacy(response.headers);
    }
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("binds successful responses to the owner, revision and requested action for all five kinds", async () => {
  const { app, execute } = setup();
  try {
    for (const owner of [
      { kind: "IDOL", idolId: id },
      { kind: "GIFT", giftId: id },
      { kind: "MEDIA_METADATA", mediaAssetId: id },
      { kind: "HOMEPAGE" },
      { kind: "POLICY", policyKey: "privacy" },
    ]) {
      const selected = { revisionId: id, owner };
      execute.mockResolvedValueOnce({ ...success, target: selected });
      const response = await app.inject({
        method: "POST",
        url: endpoint,
        headers,
        payload: { ...command, target: selected },
      });
      expect(response.statusCode).toBe(200);
      const wrongOwner = Object.fromEntries(
        Object.entries(owner).map(([key, value]) => {
          if (key === "kind") return [key, value];
          return [key, key === "policyKey" ? "unrelated" : otherId];
        }),
      );
      for (const wrong of [
        { ...success, target: { ...selected, revisionId: otherId } },
        {
          ...success,
          target: {
            ...selected,
            owner: { kind: "POLICY", policyKey: "unrelated" },
          },
        },
        { ...success, target: selected, action: "ROLLBACK" },
        ...(owner.kind === "HOMEPAGE"
          ? []
          : [{ ...success, target: { ...selected, owner: wrongOwner } }]),
      ]) {
        execute.mockResolvedValueOnce(wrong);
        const result = await app.inject({
          method: "POST",
          url: endpoint,
          headers,
          payload: { ...command, target: selected },
        });
        expect(result.statusCode).toBe(503);
        privacy(result.headers);
      }
    }
    execute.mockResolvedValueOnce(success);
    const upperCase = await app.inject({
      method: "POST",
      url: endpoint,
      headers,
      payload: {
        ...command,
        target: {
          revisionId: id.toUpperCase(),
          owner: { kind: "IDOL", idolId: id.toUpperCase() },
        },
      },
    });
    expect(upperCase.statusCode).toBe(200);
  } finally {
    await app.close();
  }
});

test("returns blocked content as a successful report and rejects contradictory readiness", async () => {
  const { app, execute } = setup();
  const issue = {
    code: "TRANSLATION_MISSING",
    severity: "BLOCKER",
    path: ["translations", "ja"],
    locale: "ja",
  };
  try {
    execute.mockResolvedValueOnce({
      ...success,
      ready: false,
      issues: [issue],
    });
    const blocked = await app.inject({
      method: "POST",
      url: endpoint,
      headers,
      payload: command,
    });
    expect(blocked.statusCode).toBe(200);
    expect(blocked.json()).toMatchObject({
      outcome: "SUCCESS",
      ready: false,
      issues: [issue],
    });
    privacy(blocked.headers);
    execute.mockResolvedValueOnce({ ...success, ready: true, issues: [issue] });
    const invalid = await app.inject({
      method: "POST",
      url: endpoint,
      headers,
      payload: command,
    });
    expect(invalid.statusCode).toBe(503);
    privacy(invalid.headers);
  } finally {
    await app.close();
  }
});

test("maps safe application failures and suppresses exception and schema-invalid response contents", async () => {
  const { app, execute, logs } = setup();
  try {
    for (const [code, status] of Object.entries({
      INVALID_COMMAND: 400,
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      CSRF_INVALID: 403,
      NOT_FOUND: 404,
      CONTENT_UNAVAILABLE: 503,
      CONFLICT: 409,
    })) {
      execute.mockResolvedValueOnce(
        adminContentFailureSchema.parse({
          schemaVersion: 1,
          outcome: "FAILURE",
          code,
        }),
      );
      const response = await app.inject({
        method: "POST",
        url: endpoint,
        headers,
        payload: command,
      });
      expect(response.statusCode).toBe(status);
      privacy(response.headers);
    }
    for (const malformed of [
      { ...success, kind: "REVIEW" },
      { ...success, candidate: "PRIVATE_RESPONSE_CANARY" },
      { ...success, headVersion: -1 },
    ]) {
      execute.mockResolvedValueOnce(malformed);
      const response = await app.inject({
        method: "POST",
        url: endpoint,
        headers,
        payload: command,
      });
      expect(response.statusCode).toBe(503);
      privacy(response.headers);
      expect(response.body).not.toContain("PRIVATE_RESPONSE_CANARY");
    }
    execute.mockRejectedValueOnce(new Error("EXCEPTION_CANARY"));
    const response = await app.inject({
      method: "POST",
      url: endpoint,
      headers,
      payload: command,
    });
    expect(response.statusCode).toBe(503);
    for (const canary of [
      token,
      csrf,
      "EXCEPTION_CANARY",
      "PRIVATE_RESPONSE_CANARY",
    ])
      expect(logs.join("\n") + response.body).not.toContain(canary);
  } finally {
    await app.close();
  }
});

test("coexists with the existing parent content scope and rejects invalid configured origins", async () => {
  const { app } = setup();
  const failure = async () =>
    adminContentFailureSchema.parse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "NOT_FOUND",
    });
  registerAdminContentRoute(app, {
    allowedOrigin: origin,
    execute: failure,
    readPreview: failure,
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: endpoint,
      headers,
      payload: command,
    });
    expect(response.statusCode).toBe(200);
    for (const path of [prefix, "/api/v1/admin/content"]) {
      const unknown = await app.inject({
        method: "POST",
        url: path + "/unknown",
        headers,
        payload: {},
      });
      expect(unknown.statusCode).toBe(404);
      privacy(unknown.headers);
    }
  } finally {
    await app.close();
  }
  for (const allowedOrigin of [
    "null",
    origin + "/",
    origin + "/path",
    "file:///tmp/admin",
    "https://user:password@example.invalid",
  ]) {
    const instance = Fastify({ logger: false });
    expect(() =>
      registerPublicationPreflightRoute(instance, {
        allowedOrigin,
        useCases: { execute: failure },
      }),
    ).toThrow("Publication preflight allowed origin is invalid");
    await instance.close();
  }
});
