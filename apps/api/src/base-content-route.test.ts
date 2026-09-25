import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import {
  adminContentFailureSchema,
  baseContentResponseSchema,
  baseContentPreviewResponseSchema,
  type BaseContentResponse,
  type BaseContentPreviewResponse,
} from "@fan-support/contracts";
import { createStructuredLogger } from "@fan-support/observability";
import { registerFastifyObservability } from "@fan-support/observability/fastify";
import { registerBaseContentRoute } from "./base-content-route.js";
import { registerAdminContentRoute } from "./admin-content-route.js";
import { registerContentAuthoringRoute } from "./admin-content-authoring-route.js";

const origin = "https://admin.example.invalid";
const token = "a".repeat(42) + "A";
const csrf = "b".repeat(42) + "E";
const id = "abcdefab-0000-4000-8000-000000000001";
const otherId = "abcdefab-0000-4000-8000-000000000002";
const requestId = "20000000-0000-4000-8000-000000000001";
const prefix = "/api/v1/admin/content-review";
const previewPath = "/api/v1/content-review-preview/read";
const target = {
  owner: { kind: "MEDIA_METADATA", mediaAssetId: id },
  revisionId: id,
  locale: "ja",
} as const;
const read = { schemaVersion: 1, target };
const append = {
  ...read,
  expectedVersion: 1,
  expectedContentHash: "a".repeat(64),
  expectedSourceHash: "b".repeat(64),
  reasonCode: "CONTENT_REVIEWED",
};
const issue = { ...read, ttlSeconds: 300, reasonCode: "CONTENT_PREVIEWED" };
const revoke = {
  schemaVersion: 1,
  grantId: id,
  reasonCode: "CONTENT_PREVIEW_REVOKED",
};
const mutation = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "MUTATION",
  resultId: id,
  replayed: false,
} as const;
const grant = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "PREVIEW_GRANT",
  grantId: id,
  token,
  expiresAt: "2026-09-06T00:10:00.000Z",
} as const;
const localized = {
  kind: "MEDIA_METADATA",
  structure: {
    presentationKind: "INFORMATIVE",
    focalPoint: { x: 0.5, y: 0.5 },
  },
  fields: { alt: "PRIVATE_CONTENT_CANARY" },
} as const;
const review = baseContentResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "REVIEW",
  context: {
    schemaVersion: 1,
    target,
    structureEditorId: id,
    lifecycle: { status: "DRAFT" },
    currentEnglishSourceHash: "b".repeat(64),
    stale: false,
    audit: {
      id,
      reviewId: id,
      reviewSequence: 1,
      locale: "ja",
      origin: "HUMAN",
      sourceHash: "a".repeat(64),
      translatedFromSourceHash: "b".repeat(64),
      editorId: id,
      editedAt: "2026-09-06T00:00:00.000Z",
      review: { status: "DRAFT" },
    },
  },
  content: localized,
  source: { kind: "MEDIA_METADATA", fields: { alt: "English source" } },
});
const preview = baseContentPreviewResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  target,
  content: localized,
});
const previewBody = { ...read, token };
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
  const execute = vi.fn<(input: unknown) => Promise<BaseContentResponse>>(
    async (input) => {
      const action = (input as { command: { action: string } }).command.action;
      return action === "READ_REVIEW"
        ? review
        : action === "ISSUE_PREVIEW"
          ? grant
          : mutation;
    },
  );
  const readPreview = vi.fn<
    (input: unknown) => Promise<BaseContentPreviewResponse>
  >(async () => preview);
  registerBaseContentRoute(app, {
    allowedOrigin: origin,
    useCases: { execute, readPreview },
  });
  return { app, execute, readPreview, logs };
}
function privacy(value: Record<string, unknown>) {
  expect(value["cache-control"]).toBe("private, no-store");
  expect(value["x-robots-tag"]).toBe("noindex, nofollow");
  expect(value["referrer-policy"]).toBe("no-referrer");
  expect(value["access-control-allow-origin"]).toBeUndefined();
}
test("maps five commands and injects trusted credentials, request ID and mutation keys", async () => {
  const { app, execute } = setup();
  try {
    for (const [path, action, body, needsKey] of [
      ["/read", "READ_REVIEW", read, false],
      ["/submit", "SUBMIT_REVIEW", append, true],
      ["/approve", "APPROVE_REVIEW", append, true],
      ["/preview/issue", "ISSUE_PREVIEW", issue, false],
      ["/preview/revoke", "REVOKE_PREVIEW", revoke, true],
    ] as const) {
      const key = needsKey ? { "idempotency-key": "fixture-base-review" } : {};
      const response = await app.inject({
        method: "POST",
        url: prefix + path,
        headers: { ...headers, ...key },
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
          ...(needsKey ? { idempotencyKey: "fixture-base-review" } : {}),
        },
      });
    }
  } finally {
    await app.close();
  }
});
test("rejects missing, duplicate and encoded credentials and noncanonical origins before application access", async () => {
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
test("rejects client authority, wrong actions, URL input and missing or duplicate mutation keys", async () => {
  const { app, execute } = setup();
  try {
    for (const payload of [
      ...[
        "action",
        "idempotencyKey",
        "requestId",
        "actorId",
        "sessionToken",
        "csrfToken",
        "createdAt",
      ].map((key) => ({ ...append, [key]: "FORGED_CANARY" })),
      { ...append, schemaVersion: 2 },
      { ...append, expectedVersion: 0 },
      null,
      [],
    ]) {
      const response = await app.inject({
        method: "POST",
        url: prefix + "/submit",
        headers: { ...headers, "idempotency-key": "fixture-base-review" },
        payload: JSON.stringify(payload),
      });
      expect(response.statusCode).toBe(400);
      privacy(response.headers);
    }
    for (const key of [
      undefined,
      ["fixture-base-review", "fixture-base-review"],
    ]) {
      const response = await app.inject({
        method: "POST",
        url: prefix + "/approve",
        headers: {
          ...headers,
          ...(key === undefined ? {} : { "idempotency-key": key }),
        },
        payload: append,
      });
      expect(response.statusCode).toBe(400);
    }
    for (const url of [
      prefix + "/read?token=URL_CANARY",
      previewPath + "?token=URL_CANARY",
    ]) {
      const response = await app.inject({
        method: "POST",
        url,
        headers,
        payload: read,
      });
      expect(response.statusCode).toBe(400);
      privacy(response.headers);
    }
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
test("both private scopes sanitize parser, body limit, unknown route and method failures", async () => {
  const { app, execute, readPreview } = setup();
  try {
    for (const path of [prefix + "/read", previewPath]) {
      for (const [payload, contentType, status] of [
        ["{broken", "application/json", 400],
        ["{}", "text/plain", 400],
        ["x".repeat(64 * 1024 + 1), "application/json", 413],
      ] as const) {
        const response = await app.inject({
          method: "POST",
          url: path,
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
        ["GET", path],
        ["POST", path + "/unknown"],
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
    }
    expect(execute).not.toHaveBeenCalled();
    expect(readPreview).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
test("binds review and preview responses to requested owner, revision and locale", async () => {
  const { app, execute, readPreview } = setup();
  try {
    if (review.outcome !== "SUCCESS" || review.kind !== "REVIEW")
      throw new Error("invalid fixture");
    for (const wrongTarget of [
      { ...target, revisionId: otherId },
      { ...target, owner: { ...target.owner, mediaAssetId: otherId } },
      { ...target, locale: "th" },
    ]) {
      execute.mockResolvedValueOnce({
        ...review,
        context: {
          ...review.context,
          target: wrongTarget,
          audit: { ...review.context.audit, locale: wrongTarget.locale },
        },
      } as BaseContentResponse);
      readPreview.mockResolvedValueOnce({
        ...preview,
        target: wrongTarget,
      } as BaseContentPreviewResponse);
      for (const [url, payload] of [
        [prefix + "/read", read],
        [previewPath, previewBody],
      ] as const) {
        const response = await app.inject({
          method: "POST",
          url,
          headers,
          payload,
        });
        expect(response.statusCode).toBe(503);
        privacy(response.headers);
      }
    }
    for (const value of [
      mutation,
      { ...review, privateField: "RESPONSE_CANARY" },
    ]) {
      execute.mockResolvedValueOnce(value as BaseContentResponse);
      const response = await app.inject({
        method: "POST",
        url: prefix + "/read",
        headers,
        payload: read,
      });
      expect(response.statusCode).toBe(503);
    }
    const upperTarget = {
      ...target,
      revisionId: id.toUpperCase(),
      owner: { ...target.owner, mediaAssetId: id.toUpperCase() },
    };
    const response = await app.inject({
      method: "POST",
      url: prefix + "/read",
      headers,
      payload: { ...read, target: upperTarget },
    });
    expect(response.statusCode).toBe(200);
  } finally {
    await app.close();
  }
});
test("preview accepts only token JSON body with exact Origin and needs no administrator cookies", async () => {
  const { app, execute, readPreview } = setup();
  try {
    const previewHeaders = { origin, "content-type": "application/json" };
    const response = await app.inject({
      method: "POST",
      url: previewPath,
      headers: previewHeaders,
      payload: previewBody,
    });
    expect(response.statusCode).toBe(200);
    privacy(response.headers);
    expect(readPreview).toHaveBeenLastCalledWith(previewBody);
    expect(execute).not.toHaveBeenCalled();
    for (const payload of [
      { ...read },
      { ...previewBody, actorId: id },
      { ...previewBody, target: { ...target, locale: "fr" } },
    ]) {
      const result = await app.inject({
        method: "POST",
        url: previewPath,
        headers: previewHeaders,
        payload,
      });
      expect(result.statusCode).toBe(400);
      privacy(result.headers);
    }
    const result = await app.inject({
      method: "POST",
      url: previewPath,
      headers: { "content-type": "application/json" },
      payload: previewBody,
    });
    expect(result.statusCode).toBe(403);
    expect(readPreview).toHaveBeenCalledOnce();
  } finally {
    await app.close();
  }
});
test("maps failures and omits exception, credentials and content from errors and observability", async () => {
  const { app, execute, readPreview, logs } = setup();
  try {
    for (const [code, status] of Object.entries({
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
    })) {
      const failure = adminContentFailureSchema.parse({
        schemaVersion: 1,
        outcome: "FAILURE",
        code,
      });
      execute.mockResolvedValueOnce(failure);
      readPreview.mockResolvedValueOnce(failure);
      for (const [url, payload] of [
        [prefix + "/read", read],
        [previewPath, previewBody],
      ] as const) {
        const response = await app.inject({
          method: "POST",
          url,
          headers,
          payload,
        });
        expect(response.statusCode).toBe(status);
        privacy(response.headers);
      }
    }
    execute.mockRejectedValueOnce(new Error("EXCEPTION_CANARY"));
    readPreview.mockRejectedValueOnce(new Error("EXCEPTION_CANARY"));
    for (const [url, payload] of [
      [prefix + "/read", read],
      [previewPath, previewBody],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url,
        headers,
        payload,
      });
      expect(response.statusCode).toBe(503);
      for (const canary of [
        token,
        csrf,
        "EXCEPTION_CANARY",
        "PRIVATE_CONTENT_CANARY",
      ])
        expect(logs.join("\n") + response.body).not.toContain(canary);
    }
  } finally {
    await app.close();
  }
});
test("coexists with authoring and extension scopes and validates configured Origin", async () => {
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
  registerContentAuthoringRoute(app, {
    allowedOrigin: origin,
    useCases: { execute: failure },
  });
  try {
    for (const path of [
      prefix,
      "/api/v1/content-review-preview",
      "/api/v1/admin/content",
      "/api/v1/content-preview",
      "/api/v1/admin/content-authoring",
    ]) {
      const response = await app.inject({
        method: "POST",
        url: path + "/unknown",
        headers,
        payload: {},
      });
      expect(response.statusCode).toBe(404);
      privacy(response.headers);
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
      registerBaseContentRoute(instance, {
        allowedOrigin,
        useCases: { execute: failure, readPreview: failure },
      }),
    ).toThrow("Base content allowed origin is invalid");
    await instance.close();
  }
});
