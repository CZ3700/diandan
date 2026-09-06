import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import {
  adminResourceResponseSchema,
  credentiallessHttpsUrlSchema,
  adminContentFailureSchema,
  type AdminResourceResponse,
} from "@fan-support/contracts";
import { createStructuredLogger } from "@fan-support/observability";
import { registerFastifyObservability } from "@fan-support/observability/fastify";
import { registerResourceManagementRoute } from "./resource-management-route.js";

const origin = "https://admin.example.invalid";
const token = "a".repeat(42) + "A";
const csrf = "b".repeat(42) + "E";
const id = "abcdefab-0000-4000-8000-000000000001";
const otherId = "abcdefab-0000-4000-8000-000000000002";
const requestId = "20000000-0000-4000-8000-000000000001";
const prefix = "/api/v1/admin/resources";
const headers = {
  origin,
  cookie: `__Host-fan-admin-session=${token}`,
  "x-csrf-token": csrf,
  "content-type": "application/json",
  "x-request-id": requestId,
};
const write = {
  schemaVersion: 1,
  expectedVersion: 0,
  reasonCode: "HTTP_RESOURCE_FIXTURE",
};
const begin = {
  ...write,
  checksumSha256: "a".repeat(64),
  byteSize: 123,
  mimeType: "image/jpeg",
  rightsReference: "rights:fixture",
};
const mutation = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "MUTATION",
  resultId: id,
  replayed: false,
} as const;
const uploadGrant = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "UPLOAD_GRANT",
  uploadId: id,
  replayed: false,
  grant: {
    method: "PUT",
    url: credentiallessHttpsUrlSchema.parse(
      "https://storage.example.invalid/source/fixture?signature=SIGNED_URL_CANARY",
    ),
    headers: {
      "content-type": "image/jpeg",
      "if-none-match": "*",
      "x-amz-checksum-sha256": Buffer.from("a".repeat(64), "hex").toString(
        "base64",
      ),
    },
    expiresAt: "2026-09-06T00:05:00.000Z",
  },
} as const;
const policy = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "POLICY",
  policy: {
    schemaVersion: 1,
    policyKey: "test-terms",
    kind: "TERMS",
    createdAt: "2026-09-06T00:00:00.123456Z",
  },
} as const;
const upload = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "UPLOAD",
  upload: {
    schemaVersion: 1,
    uploadId: id,
    version: 1,
    status: "PENDING",
    assetId: null,
    expiresAt: "2026-09-06T00:15:00.123456Z",
  },
} as const;
const media = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "MEDIA",
  media: {
    schemaVersion: 1,
    assetId: id,
    identityKind: "SOURCE",
    mimeType: "image/jpeg",
    width: 1800,
    height: 1400,
    byteSize: 123,
    processingStatus: "PENDING",
    rightsStatus: "PENDING",
    rightsVersion: 0,
  },
} as const;
const job = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "MEDIA_JOB",
  job: {
    schemaVersion: 1,
    snapshot: {
      schemaVersion: 1,
      jobId: id,
      status: "PENDING",
      attemptCount: 0,
      outputAssetId: null,
      error: null,
      nextAttemptAt: null,
    },
    generation: 1,
    retryOfJobId: null,
  },
} as const;
const cases = [
  [
    "/policies/read",
    "READ_POLICY",
    { schemaVersion: 1, policyKey: "test-terms" },
    false,
    policy,
  ],
  [
    "/policies/register",
    "REGISTER_POLICY",
    { ...write, policyKey: "test-terms", kind: "TERMS" },
    true,
    mutation,
  ],
  ["/uploads/begin", "BEGIN_UPLOAD", begin, true, uploadGrant],
  [
    "/uploads/read",
    "READ_UPLOAD",
    { schemaVersion: 1, uploadId: id },
    false,
    upload,
  ],
  [
    "/uploads/complete",
    "COMPLETE_UPLOAD",
    { ...write, expectedVersion: 1, uploadId: id },
    true,
    mutation,
  ],
  [
    "/media/read",
    "READ_MEDIA",
    { schemaVersion: 1, assetId: id },
    false,
    media,
  ],
  [
    "/media/rights",
    "SET_MEDIA_RIGHTS",
    {
      ...write,
      assetId: id,
      rightsStatus: "APPROVED",
      evidenceReference: "rights:approved",
    },
    true,
    mutation,
  ],
  [
    "/processing/enqueue",
    "ENQUEUE_MEDIA",
    {
      ...write,
      sourceAssetId: id,
      metadataRevisionId: otherId,
      role: "HERO_DESKTOP",
      fit: "CONTAIN",
    },
    true,
    mutation,
  ],
  [
    "/processing/read",
    "READ_MEDIA_JOB",
    { schemaVersion: 1, jobId: id },
    false,
    job,
  ],
  [
    "/processing/retry",
    "RETRY_MEDIA_JOB",
    { ...write, jobId: id },
    true,
    mutation,
  ],
] as const;
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
  const execute = vi.fn<(input: unknown) => Promise<AdminResourceResponse>>(
    async (input) => {
      const action = (input as { command: { action: string } }).command.action;
      return adminResourceResponseSchema.parse(
        cases.find((item) => item[1] === action)?.[4],
      );
    },
  );
  registerResourceManagementRoute(app, {
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
test("maps all ten commands with server-owned action, current credentials, request ID and write keys", async () => {
  const { app, execute } = setup();
  try {
    for (const [path, action, body, needsKey] of cases) {
      const response = await app.inject({
        method: "POST",
        url: prefix + path,
        headers: {
          ...headers,
          ...(needsKey ? { "idempotency-key": "resource-fixture" } : {}),
        },
        payload: body,
      });
      expect(response.statusCode, action).toBe(200);
      privacy(response.headers);
      expect(execute).toHaveBeenLastCalledWith({
        schemaVersion: 1,
        requestId,
        sessionToken: token,
        csrfToken: csrf,
        command: {
          ...body,
          action,
          ...(needsKey ? { idempotencyKey: "resource-fixture" } : {}),
        },
      });
    }
  } finally {
    await app.close();
  }
});
test("requires single canonical Origin, opaque cookie and CSRF even on reads", async () => {
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
        url: prefix + "/media/read",
        headers: Object.fromEntries(
          Object.entries(candidate).filter(([, value]) => value !== undefined),
        ),
        payload: { schemaVersion: 1, assetId: id },
      });
      expect([401, 403]).toContain(response.statusCode);
      privacy(response.headers);
    }
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
test("rejects authority, client storage identity or inspection receipts, query input and invalid write keys", async () => {
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
        "objectKey",
        "width",
        "receipt",
      ].map((key) => ({ ...begin, [key]: "FORGED_CANARY" })),
      { ...begin, schemaVersion: 2 },
      { ...begin, expectedVersion: 1 },
      { ...begin, byteSize: 25 * 1024 * 1024 + 1 },
      null,
      [],
    ]) {
      const response = await app.inject({
        method: "POST",
        url: prefix + "/uploads/begin",
        headers: { ...headers, "idempotency-key": "resource-fixture" },
        payload: JSON.stringify(payload),
      });
      expect(response.statusCode).toBe(400);
      privacy(response.headers);
    }
    for (const key of [undefined, ["resource-fixture", "resource-fixture"]]) {
      const response = await app.inject({
        method: "POST",
        url: prefix + "/uploads/begin",
        headers: {
          ...headers,
          ...(key === undefined ? {} : { "idempotency-key": key }),
        },
        payload: begin,
      });
      expect(response.statusCode).toBe(400);
    }
    const response = await app.inject({
      method: "POST",
      url: prefix + "/uploads/begin?token=URL_CANARY",
      headers,
      payload: begin,
    });
    expect(response.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
test("sanitizes parser, 64 KiB body limit, unknown route and method failures", async () => {
  const { app, execute } = setup();
  try {
    for (const [payload, contentType, status] of [
      ["{broken", "application/json", 400],
      ["{}", "text/plain", 400],
      ["x".repeat(64 * 1024 + 1), "application/json", 413],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: prefix + "/media/read",
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
    for (const [method, path] of [
      ["GET", "/media/read"],
      ["POST", "/unknown"],
    ] as const) {
      const response = await app.inject({
        method,
        url: prefix + path,
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
test("binds read responses to the requested resource and rejects wrong kinds and extra private fields", async () => {
  const { app, execute } = setup();
  try {
    const mismatches = [
      [
        cases[0],
        {
          ...policy,
          policy: { ...policy.policy, policyKey: "another-policy" },
        },
      ],
      [
        cases[3],
        { ...upload, upload: { ...upload.upload, uploadId: otherId } },
      ],
      [cases[5], { ...media, media: { ...media.media, assetId: otherId } }],
      [
        cases[8],
        {
          ...job,
          job: {
            ...job.job,
            snapshot: { ...job.job.snapshot, jobId: otherId },
          },
        },
      ],
    ] as const;
    for (const [[path, , payload], wrong] of mismatches) {
      for (const value of [
        wrong,
        mutation,
        { ...wrong, objectKey: "source/PRIVATE_KEY_CANARY" },
      ]) {
        execute.mockResolvedValueOnce(value as AdminResourceResponse);
        const response = await app.inject({
          method: "POST",
          url: prefix + path,
          headers,
          payload,
        });
        expect(response.statusCode).toBe(503);
        privacy(response.headers);
      }
    }
    const response = await app.inject({
      method: "POST",
      url: prefix + "/media/read",
      headers,
      payload: { schemaVersion: 1, assetId: id.toUpperCase() },
    });
    expect(response.statusCode).toBe(200);
  } finally {
    await app.close();
  }
});
test("only BEGIN exposes a strict provider-neutral upload grant", async () => {
  const { app, execute } = setup();
  try {
    execute.mockResolvedValueOnce({
      ...uploadGrant,
      grant: {
        ...uploadGrant.grant,
        headers: {
          "content-type": "image/jpeg",
          "x-provider-upload-proof": "OPAQUE_CANARY",
        },
      },
    } as AdminResourceResponse);
    const valid = await app.inject({
      method: "POST",
      url: prefix + "/uploads/begin",
      headers: { ...headers, "idempotency-key": "resource-fixture" },
      payload: begin,
    });
    expect(valid.statusCode).toBe(200);
    execute.mockResolvedValueOnce({
      ...uploadGrant,
      grant: { ...uploadGrant.grant, objectKey: "source/PRIVATE_KEY_CANARY" },
    } as AdminResourceResponse);
    const invalid = await app.inject({
      method: "POST",
      url: prefix + "/uploads/begin",
      headers: { ...headers, "idempotency-key": "resource-fixture" },
      payload: begin,
    });
    expect(invalid.statusCode).toBe(503);
    expect(invalid.body).not.toContain("SIGNED_URL_CANARY");
    execute.mockResolvedValueOnce(uploadGrant as AdminResourceResponse);
    const response = await app.inject({
      method: "POST",
      url: prefix + "/uploads/complete",
      headers: { ...headers, "idempotency-key": "resource-fixture" },
      payload: { ...write, uploadId: id, expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(503);
  } finally {
    await app.close();
  }
});
test("maps safe failures and keeps credentials and upload capabilities out of errors and logs", async () => {
  const { app, execute, logs } = setup();
  try {
    const statuses = {
      INVALID_COMMAND: 400,
      INVALID_CONTENT: 400,
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      CSRF_INVALID: 403,
      SELF_REVIEW: 403,
      NOT_FOUND: 404,
      PREVIEW_UNAVAILABLE: 404,
      CONTENT_UNAVAILABLE: 503,
    };
    for (const code of adminContentFailureSchema.shape.code.options) {
      execute.mockResolvedValueOnce({
        schemaVersion: 1,
        outcome: "FAILURE",
        code,
      });
      const response = await app.inject({
        method: "POST",
        url: prefix + "/media/read",
        headers,
        payload: { schemaVersion: 1, assetId: id },
      });
      expect(response.statusCode).toBe(
        statuses[code as keyof typeof statuses] ?? 409,
      );
      privacy(response.headers);
    }
    execute.mockRejectedValueOnce(
      new Error(`${token} ${csrf} ${uploadGrant.grant.url}`),
    );
    const response = await app.inject({
      method: "POST",
      url: prefix + "/media/read",
      headers,
      payload: { schemaVersion: 1, assetId: id },
    });
    expect(response.statusCode).toBe(503);
    for (const secret of [
      token,
      csrf,
      "SIGNED_URL_CANARY",
      "URL_CANARY",
      "FORGED_CANARY",
    ]) {
      expect(response.body).not.toContain(secret);
      expect(logs.join("\n")).not.toContain(secret);
    }
  } finally {
    await app.close();
  }
});
test("rejects invalid configured origins before registering routes", async () => {
  const app = Fastify({ logger: false });
  try {
    const credentials = new URL(origin);
    credentials.username = "invalid";
    for (const allowedOrigin of [
      origin + "/",
      "null",
      "file:///tmp/test",
      origin + "/path",
      credentials.toString(),
    ]) {
      expect(() =>
        registerResourceManagementRoute(app, {
          allowedOrigin,
          useCases: { execute: async () => mutation },
        }),
      ).toThrow("Resource management allowed origin is invalid");
    }
  } finally {
    await app.close();
  }
});
