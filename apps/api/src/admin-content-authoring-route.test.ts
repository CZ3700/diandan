import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import {
  adminContentFailureSchema,
  contentAuthoringResponseSchema,
  type ContentAuthoringResponse,
} from "@fan-support/contracts";
import { createStructuredLogger } from "@fan-support/observability";
import { registerFastifyObservability } from "@fan-support/observability/fastify";
import { registerContentAuthoringRoute } from "./admin-content-authoring-route.js";
import { registerAdminContentRoute } from "./admin-content-route.js";

const origin = "https://admin.example.invalid";
const token = "a".repeat(42) + "A";
const csrf = "b".repeat(42) + "E";
const id = "10000000-0000-4000-8000-000000000001";
const otherId = "10000000-0000-4000-8000-000000000002";
const requestId = "20000000-0000-4000-8000-000000000001";
const prefix = "/api/v1/admin/content-authoring";
const target = { kind: "MEDIA_METADATA", mediaAssetId: id } as const;
const content = {
  kind: "MEDIA_METADATA",
  structure: {
    presentationKind: "INFORMATIVE",
    focalPoint: { x: 0.5, y: 0.5 },
  },
  translations: [
    { locale: "en", origin: "HUMAN", fields: { alt: "Fixture portrait" } },
  ],
} as const;
const read = { schemaVersion: 1, target, revisionId: id };
const create = {
  schemaVersion: 1,
  target,
  expectedVersion: 0,
  reasonCode: "CONTENT_CREATED",
  content,
};
const copy = {
  schemaVersion: 1,
  target,
  expectedVersion: 1,
  reasonCode: "CONTENT_EDITED",
  sourceRevisionId: id,
  expectedSourceHash: "a".repeat(64),
  changes: {
    kind: "MEDIA_METADATA",
    translations: [
      { locale: "ja", origin: "HUMAN", fields: { alt: "ポートレート" } },
    ],
  },
};
const mutation = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "MUTATION",
  resultId: id,
  replayed: false,
} as const;
const revision = contentAuthoringResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "REVISION",
  snapshot: {
    schemaVersion: 1,
    target,
    revisionId: id,
    revisionNumber: 1,
    headVersion: 1,
    lifecycle: { status: "DRAFT" },
    createdBy: id,
    createdAt: "2026-09-06T00:00:00.000Z",
    contentHash: "a".repeat(64),
    content,
    extensions: {},
    translationAudits: [
      {
        id,
        reviewId: id,
        reviewSequence: 1,
        locale: "en",
        origin: "HUMAN",
        sourceHash: "a".repeat(64),
        translatedFromSourceHash: "a".repeat(64),
        editorId: id,
        editedAt: "2026-09-06T00:00:00.000Z",
        review: { status: "DRAFT" },
      },
    ],
  },
});
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
  const execute = vi.fn<(input: unknown) => Promise<ContentAuthoringResponse>>(
    async (input) =>
      (input as { command: { action: string } }).command.action === "READ"
        ? revision
        : mutation,
  );
  registerContentAuthoringRoute(app, {
    allowedOrigin: origin,
    useCases: { execute },
  });
  return { app, execute, logs };
}
function privacy(value: Record<string, unknown>) {
  expect(value["cache-control"]).toBe("private, no-store");
  expect(value["x-robots-tag"]).toBe("noindex, nofollow");
  expect(value["referrer-policy"]).toBe("no-referrer");
  expect(value["access-control-allow-origin"]).toBeUndefined();
}

test("maps all authoring operations and injects trusted session, request and idempotency context", async () => {
  const { app, execute } = setup();
  try {
    for (const [action, body] of [
      ["READ", read],
      ["CREATE", create],
      ["COPY", copy],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: `${prefix}/${action.toLowerCase()}`,
        headers: {
          ...headers,
          ...(action === "READ"
            ? {}
            : { "idempotency-key": "fixture-authoring-key" }),
        },
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
          ...(action === "READ"
            ? {}
            : { idempotencyKey: "fixture-authoring-key" }),
        },
      });
    }
  } finally {
    await app.close();
  }
});

test("rejects missing or duplicate credentials and noncanonical origins before application access", async () => {
  const { app, execute } = setup();
  try {
    const cases = [
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
    ];
    for (const candidate of cases) {
      const response = await app.inject({
        method: "POST",
        url: prefix + "/read",
        headers: Object.fromEntries(
          Object.entries(candidate).filter(([, value]) => value !== undefined),
        ),
        payload: read,
      });
      expect([401, 403]).toContain(response.statusCode);
      privacy(response.headers);
    }
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("rejects client authority, wrong actions, URL input and absent or duplicate mutation keys", async () => {
  const { app, execute } = setup();
  try {
    const payloads = [
      ...[
        "action",
        "idempotencyKey",
        "requestId",
        "actorId",
        "sessionToken",
        "csrfToken",
        "createdAt",
      ].map((key) => ({ ...create, [key]: "forged" })),
      { ...create, content: { ...content, kind: "IDOL" } },
      { ...create, schemaVersion: 2 },
      { ...copy, expectedVersion: -1 },
      null,
      [],
    ];
    for (const payload of payloads) {
      const response = await app.inject({
        method: "POST",
        url: prefix + "/create",
        headers: { ...headers, "idempotency-key": "fixture-authoring-key" },
        payload: JSON.stringify(payload),
      });
      expect(response.statusCode).toBe(400);
      privacy(response.headers);
    }
    for (const key of [
      undefined,
      ["fixture-authoring-key", "fixture-authoring-key"],
    ]) {
      const response = await app.inject({
        method: "POST",
        url: prefix + "/copy",
        headers: {
          ...headers,
          ...(key === undefined ? {} : { "idempotency-key": key }),
        },
        payload: copy,
      });
      expect(response.statusCode).toBe(400);
    }
    const response = await app.inject({
      method: "POST",
      url: prefix + "/read?token=URL_CANARY",
      headers,
      payload: read,
    });
    expect(response.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("returns private safe JSON for parser errors, body limits, unknown paths and unsupported methods", async () => {
  const { app, execute } = setup();
  try {
    for (const [payload, contentType, expected] of [
      ["{broken", "application/json", 400],
      ["{}", "text/plain", 400],
      ["x".repeat(16 * 1024 * 1024 + 1), "application/json", 413],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: prefix + "/read",
        headers: { ...headers, "content-type": contentType },
        payload,
      });
      expect(response.statusCode).toBe(expected);
      privacy(response.headers);
      expect(response.json()).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "INVALID_COMMAND",
      });
    }
    for (const [method, path] of [
      ["POST", "/unknown"],
      ["GET", "/read"],
    ] as const) {
      const response = await app.inject({
        method,
        url: prefix + path,
        headers,
        ...(method === "POST" ? { payload: read } : {}),
      });
      expect(response.statusCode).toBe(404);
      privacy(response.headers);
    }
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("binds successful READ snapshots to exact target and revision and rejects incorrect result kinds", async () => {
  const { app, execute } = setup();
  try {
    if (revision.outcome !== "SUCCESS" || revision.kind !== "REVISION")
      throw new Error("invalid fixture");
    const alternatives: unknown[] = [
      mutation,
      { ...revision, snapshot: { ...revision.snapshot, revisionId: otherId } },
      {
        ...revision,
        snapshot: {
          ...revision.snapshot,
          target: { ...target, mediaAssetId: otherId },
        },
      },
      { ...revision, privateField: "RESPONSE_CANARY" },
    ];
    for (const value of alternatives) {
      execute.mockResolvedValueOnce(value as ContentAuthoringResponse);
      const response = await app.inject({
        method: "POST",
        url: prefix + "/read",
        headers,
        payload: read,
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CONTENT_UNAVAILABLE",
      });
      privacy(response.headers);
    }
    execute.mockResolvedValueOnce(revision);
    const response = await app.inject({
      method: "POST",
      url: prefix + "/create",
      headers: { ...headers, "idempotency-key": "fixture-authoring-key" },
      payload: create,
    });
    expect(response.statusCode).toBe(503);
  } finally {
    await app.close();
  }
});

test("maps every frozen failure code and never exposes exception, credential, content or URL canaries", async () => {
  const { app, execute, logs } = setup();
  try {
    const statuses = {
      INVALID_COMMAND: 400,
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      CSRF_INVALID: 403,
      NOT_FOUND: 404,
      REVISION_NOT_DRAFT: 409,
      ALREADY_EXISTS: 409,
      INVALID_CONTENT: 400,
      CONTENT_UNAVAILABLE: 503,
      STALE_CONTENT: 409,
      STALE_VERSION: 409,
      SELF_REVIEW: 403,
      INVALID_REVIEW_STATE: 409,
      IDEMPOTENCY_CONFLICT: 409,
      CONFLICT: 409,
      PREVIEW_UNAVAILABLE: 404,
    } as const;
    for (const [code, status] of Object.entries(statuses)) {
      execute.mockResolvedValueOnce(
        adminContentFailureSchema.parse({
          schemaVersion: 1,
          outcome: "FAILURE",
          code,
        }),
      );
      const response = await app.inject({
        method: "POST",
        url: prefix + "/read",
        headers,
        payload: read,
      });
      expect(response.statusCode).toBe(status);
      privacy(response.headers);
    }
    execute.mockRejectedValueOnce(new Error("EXCEPTION_CANARY"));
    const response = await app.inject({
      method: "POST",
      url: prefix + "/read",
      headers,
      payload: read,
    });
    expect(response.statusCode).toBe(503);
    const logged = logs.join("\n") + response.body;
    for (const canary of [
      token,
      csrf,
      "EXCEPTION_CANARY",
      "Fixture portrait",
      "URL_CANARY",
    ])
      expect(logged).not.toContain(canary);
  } finally {
    await app.close();
  }
});

test("coexists with the extension route without overriding either private boundary", async () => {
  const { app, execute } = setup();
  const extension = vi.fn(async () =>
    adminContentFailureSchema.parse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "NOT_FOUND",
    }),
  );
  registerAdminContentRoute(app, {
    allowedOrigin: origin,
    execute: extension,
    readPreview: extension,
  });
  try {
    for (const path of [
      prefix + "/unknown",
      "/api/v1/admin/content/unknown",
      "/api/v1/content-preview/unknown",
    ]) {
      const response = await app.inject({
        method: "POST",
        url: path,
        headers,
        payload: {},
      });
      expect(response.statusCode).toBe(404);
      privacy(response.headers);
    }
    const response = await app.inject({
      method: "POST",
      url: prefix + "/read",
      headers,
      payload: read,
    });
    expect(response.statusCode).toBe(200);
    expect(execute).toHaveBeenCalledOnce();
    expect(extension).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("rejects invalid configured origins before registering routes", async () => {
  for (const allowedOrigin of [
    "null",
    origin + "/",
    origin + "/path",
    "file:///tmp/admin",
    "https://user:password@example.invalid",
  ]) {
    const app = Fastify({ logger: false });
    expect(() =>
      registerContentAuthoringRoute(app, {
        allowedOrigin,
        useCases: { execute: async () => mutation },
      }),
    ).toThrow("Content authoring allowed origin is invalid");
    await app.close();
  }
});
