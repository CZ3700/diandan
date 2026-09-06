import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  publicationRuntimeResponseSchema,
} from "@fan-support/contracts";
import { createStructuredLogger } from "@fan-support/observability";
import { registerFastifyObservability } from "@fan-support/observability/fastify";
import { registerPublicationPreflightRoute } from "./publication-preflight-route.js";
import {
  registerPublicationRuntimeRoute,
  type PublicationRuntimeRouteDependencies,
} from "./publication-runtime-route.js";

const origin = "https://admin.example.invalid";
const token = "a".repeat(42) + "A";
const csrf = "b".repeat(42) + "E";
const id = "abcdefab-0000-4000-8000-000000000001";
const otherId = "abcdefab-0000-4000-8000-000000000002";
const requestId = "20000000-0000-4000-8000-000000000001";
const prefix = "/api/v1/admin/content/publication";
const target = { owner: { kind: "IDOL", idolId: id }, revisionId: id } as const;
const body = {
  schemaVersion: 1,
  target,
  expectedVersion: 0,
  expectedContentHash: "a".repeat(64),
  reasonCode: "HTTP_PUBLICATION",
} as const;
const headers = {
  origin,
  cookie: `__Host-fan-admin-session=${token}`,
  "x-csrf-token": csrf,
  "content-type": "application/json",
  "x-request-id": requestId,
  "idempotency-key": "publication-route-test",
};
const success = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "PUBLICATION_MUTATION",
  resultId: id,
  action: "PUBLISH",
  target,
  headVersion: 1,
  contentHash: "b".repeat(64),
  publicationId: id,
  manifestHash: "c".repeat(64),
  replayed: false,
} as const;
const time = "2026-09-06T00:00:00.123456Z";
const status = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "PUBLICATION_STATUS",
  publicationId: id,
  target,
  headVersion: 1,
  manifestHash: "c".repeat(64),
  publishedAt: time,
  isCurrent: true,
  jobs: SUPPORTED_LOCALES.map((locale, index) => ({
    schemaVersion: 1,
    id: `abcdefab-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    publicationId: id,
    outboxEventId: id,
    locale,
    generation: 1,
    retryOf: null,
    status: "PENDING",
    version: 1,
    attemptCount: 0,
    failureCount: 0,
    createdAt: time,
    updatedAt: time,
    nextAttemptAt: time,
    completedAt: null,
    errorCode: null,
  })),
};
const retry = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "PURGE_RETRY",
  resultId: id,
  publicationId: id,
  purgeJobId: otherId,
  generation: 2,
  version: 1,
  replayed: false,
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
  registerPublicationRuntimeRoute(app, {
    allowedOrigin: origin,
    useCases: {
      execute:
        execute as PublicationRuntimeRouteDependencies["useCases"]["execute"],
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

test("maps five action paths and injects credentials, observed request ID and header idempotency", async () => {
  const { app, execute } = setup();
  try {
    for (const action of ["VALIDATE", "PUBLISH", "ROLLBACK"] as const) {
      execute.mockResolvedValueOnce({
        ...success,
        action,
        ...(action === "VALIDATE"
          ? { publicationId: null, manifestHash: null, headVersion: 0 }
          : {}),
      });
      const response = await app.inject({
        method: "POST",
        url: `${prefix}/${action.toLowerCase()}`,
        headers,
        payload: body,
      });
      expect(response.statusCode).toBe(200);
      privacy(response.headers);
      expect(execute).toHaveBeenLastCalledWith({
        schemaVersion: 1,
        requestId,
        sessionToken: token,
        csrfToken: csrf,
        command: {
          ...body,
          action,
          idempotencyKey: headers["idempotency-key"],
        },
      });
    }
    const { "idempotency-key": unusedKey, ...readHeaders } = headers;
    void unusedKey;
    execute.mockResolvedValueOnce(status);
    const read = await app.inject({
      method: "POST",
      url: prefix + "/status",
      headers: readHeaders,
      payload: { schemaVersion: 1, publicationId: id },
    });
    expect(read.statusCode).toBe(200);
    privacy(read.headers);
    expect(execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: { schemaVersion: 1, action: "STATUS", publicationId: id },
      }),
    );
    execute.mockResolvedValueOnce(retry);
    const retryBody = {
      schemaVersion: 1,
      publicationId: id,
      purgeJobId: id,
      expectedVersion: 2,
      reasonCode: "HTTP_RETRY",
    };
    const retried = await app.inject({
      method: "POST",
      url: prefix + "/retry",
      headers,
      payload: retryBody,
    });
    expect(retried.statusCode).toBe(200);
    expect(execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: {
          ...retryBody,
          action: "RETRY_PURGE",
          idempotencyKey: headers["idempotency-key"],
        },
      }),
    );
  } finally {
    await app.close();
  }
});

test("rejects missing or duplicate authority headers and mutation keys before Application", async () => {
  const { app, execute } = setup();
  try {
    for (const [patch, expected] of [
      [{ origin: undefined }, 403],
      [{ origin: "null" }, 403],
      [{ origin: [origin, origin] }, 403],
      [{ "sec-fetch-site": "cross-site" }, 403],
      [{ cookie: undefined }, 401],
      [{ cookie: [headers.cookie, headers.cookie] }, 401],
      [{ cookie: `${headers.cookie}; ${headers.cookie}` }, 401],
      [{ cookie: `__Host-fan-admin-session=%61${token.slice(1)}` }, 401],
      [{ cookie: `bad; ${headers.cookie}` }, 401],
      [{ "x-csrf-token": undefined }, 403],
      [{ "x-csrf-token": [csrf, csrf] }, 403],
      [{ "idempotency-key": undefined }, 400],
      [{ "idempotency-key": ["same", "same"] }, 400],
      [{ "content-type": "text/plain" }, 400],
    ] as const) {
      const result = await app.inject({
        method: "POST",
        url: prefix + "/publish",
        headers: Object.fromEntries(
          Object.entries({ ...headers, ...patch })
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [
              key,
              typeof value === "string" || value === undefined
                ? value
                : [...value],
            ]),
        ),
        payload: JSON.stringify(body),
      });
      expect(result.statusCode).toBe(expected);
      privacy(result.headers);
    }
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("rejects unknown authority, omitted concurrency and invalid versions or reasons", async () => {
  const { app, execute } = setup();
  try {
    for (const payload of [
      ...[
        "action",
        "idempotencyKey",
        "actorId",
        "sessionId",
        "requestId",
        "sessionToken",
        "csrfToken",
        "manifest",
        "ready",
        "evaluatedAt",
        "paths",
      ].map((key) => ({ ...body, [key]: "BODY_AUTHORITY_CANARY" })),
      { ...body, schemaVersion: 2 },
      { ...body, expectedVersion: -1 },
      { ...body, expectedVersion: 0.5 },
      { ...body, expectedVersion: Number.MAX_SAFE_INTEGER + 1 },
      { ...body, expectedVersion: undefined },
      { ...body, expectedContentHash: undefined },
      { ...body, reasonCode: undefined },
      { ...body, reasonCode: "free form" },
      { ...body, target: { ...target, locale: "en" } },
      null,
      [],
    ]) {
      const response = await app.inject({
        method: "POST",
        url: prefix + "/publish",
        headers,
        payload: JSON.stringify(payload),
      });
      expect(response.statusCode).toBe(400);
      privacy(response.headers);
    }
    for (const path of ["/status?token=QUERY_CANARY", "/publish?locale=en"]) {
      const response = await app.inject({
        method: "POST",
        url: prefix + path,
        headers,
        payload: body,
      });
      expect(response.statusCode).toBe(400);
      privacy(response.headers);
    }
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("returns field-level blocked publication as 409 and preserves safe failure statuses", async () => {
  const { app, execute } = setup();
  try {
    const blocked = {
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "PUBLICATION_BLOCKED",
      issues: [
        {
          code: "TRANSLATION_MISSING",
          severity: "BLOCKER",
          path: ["translations", "ja"],
          locale: "ja",
        },
      ],
    };
    execute.mockResolvedValueOnce(blocked);
    const result = await app.inject({
      method: "POST",
      url: prefix + "/publish",
      headers,
      payload: body,
    });
    expect(result.statusCode).toBe(409);
    expect(result.json()).toEqual(blocked);
    privacy(result.headers);
    for (const [code, expected] of Object.entries({
      INVALID_COMMAND: 400,
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      CSRF_INVALID: 403,
      NOT_FOUND: 404,
      STALE_CONTENT: 409,
      STALE_VERSION: 409,
      IDEMPOTENCY_CONFLICT: 409,
      CONFLICT: 409,
      CONTENT_UNAVAILABLE: 503,
    })) {
      execute.mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "FAILURE",
        code,
      });
      const response = await app.inject({
        method: "POST",
        url: prefix + "/publish",
        headers,
        payload: body,
      });
      expect(response.statusCode).toBe(expected);
      privacy(response.headers);
    }
  } finally {
    await app.close();
  }
});

test("binds response action, owner, revision and status publication without leaking provider fields", async () => {
  const { app, execute, logs } = setup();
  try {
    for (const malformed of [
      { ...success, action: "ROLLBACK" },
      { ...success, target: { ...target, revisionId: otherId } },
      {
        ...success,
        target: { ...target, owner: { kind: "IDOL", idolId: otherId } },
      },
      { ...success, providerReference: "PRIVATE_PROVIDER_CANARY" },
      { ...success, publicationId: null },
      { ...success, kind: "PURGE_RETRY" },
    ]) {
      execute.mockResolvedValueOnce(malformed);
      const response = await app.inject({
        method: "POST",
        url: prefix + "/publish",
        headers,
        payload: body,
      });
      expect(response.statusCode).toBe(503);
      privacy(response.headers);
      expect(response.body).not.toContain("PRIVATE_PROVIDER_CANARY");
    }
    for (const wrong of [
      { ...status, publicationId: otherId },
      {
        ...status,
        jobs: status.jobs.map((job) => ({ ...job, publicationId: otherId })),
      },
    ]) {
      execute.mockResolvedValueOnce(wrong);
      const response = await app.inject({
        method: "POST",
        url: prefix + "/status",
        headers,
        payload: { schemaVersion: 1, publicationId: id },
      });
      expect(response.statusCode).toBe(503);
    }
    execute.mockRejectedValueOnce(new Error("PRIVATE_EXCEPTION_CANARY"));
    const response = await app.inject({
      method: "POST",
      url: prefix + "/publish",
      headers,
      payload: body,
    });
    expect(response.statusCode).toBe(503);
    for (const canary of [
      token,
      csrf,
      "PRIVATE_PROVIDER_CANARY",
      "PRIVATE_EXCEPTION_CANARY",
    ])
      expect(logs.join("\n") + response.body).not.toContain(canary);
  } finally {
    await app.close();
  }
});

test("protects parser errors and unknown methods while coexisting with preflight", async () => {
  const { app } = setup();
  registerPublicationPreflightRoute(app, {
    allowedOrigin: origin,
    useCases: {
      execute: async () => ({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "NOT_FOUND",
      }),
    },
  });
  try {
    for (const [method, path, payload, expected] of [
      ["POST", "/publish", "{broken", 400],
      ["POST", "/publish", "x".repeat(64 * 1024 + 1), 413],
      ["GET", "/publish", undefined, 404],
      ["POST", "/unknown", "{}", 404],
    ] as const) {
      const response = await app.inject({
        method,
        url: prefix + path,
        headers,
        ...(payload === undefined ? {} : { payload }),
      });
      expect(response.statusCode).toBe(expected);
      privacy(response.headers);
    }
    const preflight = await app.inject({
      method: "POST",
      url: prefix + "/preflight",
      headers,
      payload: { schemaVersion: 1, target, action: "PUBLISH" },
    });
    expect(preflight.statusCode).toBe(404);
    privacy(preflight.headers);
    const publish = await app.inject({
      method: "POST",
      url: prefix + "/publish",
      headers,
      payload: body,
    });
    expect(publish.statusCode).toBe(200);
  } finally {
    await app.close();
  }
  for (const allowedOrigin of [
    "null",
    origin + "/",
    "file:///tmp/admin",
    "https://user:password@example.invalid",
  ]) {
    const instance = Fastify({ logger: false });
    expect(() =>
      registerPublicationRuntimeRoute(instance, {
        allowedOrigin,
        useCases: {
          execute: async () => publicationRuntimeResponseSchema.parse(success),
        },
      }),
    ).toThrow("Publication runtime allowed origin is invalid");
    await instance.close();
  }
});
