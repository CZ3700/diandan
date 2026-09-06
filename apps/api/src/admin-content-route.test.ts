import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import { createStructuredLogger } from "@fan-support/observability";
import { registerFastifyObservability } from "@fan-support/observability/fastify";

import { registerAdminContentRoute } from "./admin-content-route.js";
import {
  adminContentResponseSchema,
  type AdminContentResponse,
  type ContentPreviewResponse,
} from "@fan-support/contracts";

const origin = "https://admin.example.invalid";
const token = "a".repeat(42) + "A";
const csrf = "b".repeat(42) + "E";
const id = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000001";
const mutation = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "MUTATION",
  resultId: id,
  replayed: false,
} as const;
const draftResponse = adminContentResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "DRAFT",
  content: {
    schemaVersion: 1,
    outcome: "SUCCESS",
    aliasSet: {
      schemaVersion: 1,
      id,
      idolRevisionId: id,
      aliases: [],
      contentHash: "a".repeat(64),
      editorId: id,
      editedAt: "2026-09-05T18:00:00.000Z",
      review: { status: "DRAFT" },
    },
  },
  reviews: [],
});
const read = {
  schemaVersion: 1,
  target: { schemaVersion: 1, kind: "IDOL_ALIASES", idolRevisionId: id },
};
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
  const execute = vi.fn<(input: unknown) => Promise<AdminContentResponse>>(
    async (input) =>
      (input as { command: { action: string } }).command.action === "READ_DRAFT"
        ? draftResponse
        : mutation,
  );
  const readPreview = vi.fn<
    (input: unknown) => Promise<ContentPreviewResponse>
  >(
    async () =>
      ({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "PREVIEW_UNAVAILABLE",
      }) as const,
  );
  registerAdminContentRoute(app, {
    allowedOrigin: origin,
    execute,
    readPreview,
  });
  return { app, execute, readPreview, logs };
}

function privacy(headers: Record<string, unknown>) {
  expect(headers["cache-control"]).toBe("private, no-store");
  expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["access-control-allow-origin"]).toBeUndefined();
}

test("injects authenticated request context while preserving strict route-specific commands", async () => {
  const { app, execute } = setup();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/content/drafts/read",
      headers,
      payload: read,
    });
    expect(response.statusCode).toBe(200);
    privacy(response.headers);
    expect(execute).toHaveBeenCalledWith({
      schemaVersion: 1,
      requestId,
      sessionToken: token,
      csrfToken: csrf,
      command: { ...read, action: "READ_DRAFT" },
    });
    const body = {
      schemaVersion: 1,
      draft: {
        schemaVersion: 1,
        id,
        idolRevisionId: id,
        aliases: [],
        reasonCode: "CONTENT_CREATED",
      },
      expectedVersion: 1,
    };
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/content/drafts/aliases",
      headers: { ...headers, "idempotency-key": "fixture-create-aliases" },
      payload: body,
    });
    expect(created.statusCode).toBe(200);
    expect(execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: {
          ...body,
          action: "CREATE_IDOL_ALIASES",
          idempotencyKey: "fixture-create-aliases",
        },
      }),
    );
  } finally {
    await app.close();
  }
});

test("denies missing, ambiguous, cross-origin and noncanonical credentials before application access", async () => {
  const { app, execute } = setup();
  try {
    const invalidHeaders = [
      { ...headers, origin: "https://attacker.example.invalid" },
      { ...headers, origin: "null" },
      { ...headers, origin: origin + "/" },
      { ...headers, origin: undefined },
      { ...headers, "x-csrf-token": undefined },
      { ...headers, "x-csrf-token": [csrf, csrf] },
      { ...headers, cookie: undefined },
      {
        ...headers,
        cookie: `__Host-fan-admin-session=${token}; __Host-fan-admin-session=${token}`,
      },
      { ...headers, cookie: `__Host-fan-admin-session=%61${token.slice(1)}` },
      { ...headers, cookie: `__Host-fan-admin-session="${token}"` },
      { ...headers, "sec-fetch-site": "cross-site" },
    ];
    for (const value of invalidHeaders) {
      const selected = Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string | string[]] =>
            entry[1] !== undefined,
        ),
      );
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/content/drafts/read",
        headers: selected,
        payload: read,
      });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      privacy(response.headers);
    }
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("rejects client identity, route action, query credentials and missing idempotency key", async () => {
  const { app, execute } = setup();
  try {
    for (const payload of [
      { ...read, action: "READ_DRAFT" },
      { ...read, actorId: id },
      { ...read, requestId },
      { ...read, idempotencyKey: "spoofed" },
      { ...read, sessionToken: token },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/content/drafts/read",
        headers,
        payload,
      });
      expect(response.statusCode).toBe(400);
      privacy(response.headers);
    }
    const queried = await app.inject({
      method: "POST",
      url: `/api/v1/admin/content/drafts/read?token=${token}`,
      headers,
      payload: read,
    });
    expect(queried.statusCode).toBe(400);
    const missingKey = await app.inject({
      method: "POST",
      url: "/api/v1/admin/content/preview/revoke",
      headers,
      payload: { schemaVersion: 1, grantId: id, reasonCode: "PREVIEW_REVOKED" },
    });
    expect(missingKey.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("privacy and stable failure responses survive invalid JSON, content type, body limit and unknown paths", async () => {
  const { app, execute } = setup();
  try {
    for (const [url, body, contentType, status] of [
      ["/api/v1/admin/content/drafts/read", "{", "application/json", 400],
      ["/api/v1/admin/content/drafts/read", "body", "text/plain", 400],
      [
        "/api/v1/admin/content/drafts/read",
        JSON.stringify({ text: "x".repeat(16 * 1024 * 1024) }),
        "application/json",
        413,
      ],
      ["/api/v1/admin/content/unknown", "{}", "application/json", 404],
      ["/api/v1/content-preview/unknown", "{}", "application/json", 404],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url,
        headers: { ...headers, "content-type": contentType },
        payload: body,
      });
      expect(response.statusCode).toBe(status);
      privacy(response.headers);
      expect(response.body).not.toContain("SyntaxError");
    }
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("preview consumes only a strict body token without admin credentials and contains errors without token logging", async () => {
  const { app, readPreview, execute, logs } = setup();
  try {
    const payload = {
      schemaVersion: 1,
      target: { kind: "IDOL_ALIASES", revisionId: id, locale: "en" },
      token,
    };
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/content-preview/read",
      headers: { origin, "content-type": "application/json" },
      payload,
    });
    expect(response.statusCode).toBe(404);
    privacy(response.headers);
    expect(readPreview).toHaveBeenCalledWith(payload);
    execute.mockImplementationOnce(async () => {
      throw new Error(`private ${token} ${csrf}`);
    });
    const failed = await app.inject({
      method: "POST",
      url: "/api/v1/admin/content/drafts/read",
      headers,
      payload: read,
    });
    expect(failed.statusCode).toBe(503);
    privacy(failed.headers);
    expect(failed.body).not.toContain(token);
    expect(logs.join("\n")).not.toContain(token);
    expect(logs.join("\n")).not.toContain(csrf);
  } finally {
    await app.close();
  }
});

test("rejects malformed or action-inappropriate application results", async () => {
  const { app, execute } = setup();
  try {
    for (const result of [
      mutation,
      { ...draftResponse, internalSecret: "fixture-private-value" },
    ]) {
      execute.mockResolvedValueOnce(result);
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/content/drafts/read",
        headers,
        payload: read,
      });
      expect(response.statusCode).toBe(503);
      privacy(response.headers);
      expect(response.body).not.toContain("fixture-private-value");
    }
  } finally {
    await app.close();
  }
});

test("maps every command endpoint without accepting server-owned fields in its body", async () => {
  const { app, execute } = setup();
  const target = { kind: "IDOL_ALIASES", revisionId: id };
  const review = {
    schemaVersion: 1,
    target,
    expectedVersion: 1,
    expectedContentHash: "a".repeat(64),
    expectedSourceHash: null,
    reasonCode: "CONTENT_REVIEWED",
  };
  const cases = [
    [
      "/drafts/gift-details",
      "CREATE_GIFT_DETAILS",
      {
        schemaVersion: 1,
        expectedVersion: 1,
        draft: {
          schemaVersion: 1,
          document: {
            schemaVersion: 1,
            id,
            giftRevisionId: id,
            blocks: [{ id: "intro", kind: "PARAGRAPH" }],
          },
          translations: [
            {
              id,
              locale: "en",
              origin: "HUMAN",
              blocks: [
                {
                  blockId: "intro",
                  kind: "PARAGRAPH",
                  text: "Gift description",
                },
              ],
            },
          ],
          reasonCode: "CONTENT_CREATED",
        },
      },
    ],
    ["/reviews/submit", "SUBMIT_REVIEW", review],
    ["/reviews/approve", "APPROVE_REVIEW", { ...review, expectedVersion: 2 }],
    [
      "/preview/revoke",
      "REVOKE_PREVIEW",
      { schemaVersion: 1, grantId: id, reasonCode: "PREVIEW_REVOKED" },
    ],
  ] as const;
  try {
    for (const [path, action, body] of cases) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/admin/content${path}`,
        headers: { ...headers, "idempotency-key": "fixture-command-identity" },
        payload: body,
      });
      expect(response.statusCode).toBe(200);
      privacy(response.headers);
      expect(execute).toHaveBeenLastCalledWith(
        expect.objectContaining({
          command: {
            ...body,
            action,
            idempotencyKey: "fixture-command-identity",
          },
        }),
      );
    }
    execute.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "PREVIEW_GRANT",
      grantId: id,
      token,
      expiresAt: "2026-09-05T18:05:00.000Z",
    });
    const body = {
      schemaVersion: 1,
      target: { ...target, locale: "en" },
      ttlSeconds: 300,
      reasonCode: "CONTENT_PREVIEW",
    };
    const preview = await app.inject({
      method: "POST",
      url: "/api/v1/admin/content/preview/issue",
      headers,
      payload: body,
    });
    expect(preview.statusCode).toBe(200);
    privacy(preview.headers);
    expect(execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: { ...body, action: "ISSUE_PREVIEW" },
      }),
    );
  } finally {
    await app.close();
  }
});

test("returns stable statuses for every declared failure and rejects preview target substitution", async () => {
  const { app, execute, readPreview } = setup();
  const failures = [
    ["INVALID_COMMAND", 400],
    ["UNAUTHENTICATED", 401],
    ["FORBIDDEN", 403],
    ["CSRF_INVALID", 403],
    ["NOT_FOUND", 404],
    ["REVISION_NOT_DRAFT", 409],
    ["ALREADY_EXISTS", 409],
    ["INVALID_CONTENT", 400],
    ["CONTENT_UNAVAILABLE", 503],
    ["STALE_CONTENT", 409],
    ["STALE_VERSION", 409],
    ["SELF_REVIEW", 403],
    ["INVALID_REVIEW_STATE", 409],
    ["IDEMPOTENCY_CONFLICT", 409],
    ["CONFLICT", 409],
    ["PREVIEW_UNAVAILABLE", 404],
  ] as const;
  try {
    for (const [code, status] of failures) {
      execute.mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "FAILURE",
        code,
      });
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/content/drafts/read",
        headers,
        payload: read,
      });
      expect(response.statusCode).toBe(status);
      expect(response.json().code).toBe(code);
      privacy(response.headers);
    }
    const target = {
      kind: "IDOL_ALIASES",
      revisionId: id,
      locale: "en",
    } as const;
    readPreview.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "SUCCESS",
      target: { ...target, locale: "ja" },
      content: { kind: "IDOL_ALIASES", aliases: [] },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/content-preview/read",
      headers: { origin, "content-type": "application/json" },
      payload: { schemaVersion: 1, target, token },
    });
    expect(response.statusCode).toBe(503);
    privacy(response.headers);
  } finally {
    await app.close();
  }
});

test("rejects ambiguous duplicate authority headers and invalid configured origins", async () => {
  const { app, execute } = setup();
  try {
    for (const duplicated of [
      "origin",
      "cookie",
      "x-csrf-token",
      "idempotency-key",
    ] as const) {
      const base = {
        ...headers,
        "idempotency-key": "fixture-command-identity",
      };
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/content/preview/revoke",
        headers: {
          ...base,
          [duplicated]: [base[duplicated], base[duplicated]],
        },
        payload: {
          schemaVersion: 1,
          grantId: id,
          reasonCode: "PREVIEW_REVOKED",
        },
      });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      privacy(response.headers);
    }
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
  for (const allowedOrigin of [
    "https://admin.example.invalid/",
    "https://user@admin.example.invalid",
    "https://admin.example.invalid/path",
    "file:///tmp/test",
  ]) {
    const isolated = Fastify();
    expect(() =>
      registerAdminContentRoute(isolated, {
        allowedOrigin,
        execute: async () => mutation,
        readPreview: async () => ({
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "PREVIEW_UNAVAILABLE",
        }),
      }),
    ).toThrow("Admin content allowed origin is invalid");
    await isolated.close();
  }
});

test("reads one canonical review target without an idempotency header", async () => {
  const { app, execute } = setup();
  const target = { kind: "IDOL_ALIASES", revisionId: id };
  const result = adminContentResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "REVIEW",
    context: {
      schemaVersion: 1,
      target,
      subjectId: id,
      sequence: 1,
      status: "DRAFT",
      editorId: id,
      structureEditorId: id,
      editedAt: "2026-09-05T18:00:00.000Z",
      contentHash: "a".repeat(64),
      sourceHash: null,
      locales: ["en"],
    },
    content: { kind: "IDOL_ALIASES", aliases: [] },
    source: null,
  });
  try {
    execute.mockResolvedValueOnce(result);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/content/reviews/read",
      headers,
      payload: { schemaVersion: 1, target },
    });
    expect(response.statusCode).toBe(200);
    privacy(response.headers);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: { schemaVersion: 1, action: "READ_REVIEW", target },
      }),
    );
  } finally {
    await app.close();
  }
});
