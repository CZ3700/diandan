#!/usr/bin/env node
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import sharp from "sharp";
import {
  S3Client,
  PutBucketCorsCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { digestAdminContentToken } from "@fan-support/application";
import {
  adminResourceResponseSchema,
  mediaPortResponseSchema,
  mediaSourceInspectionResponseSchema,
  persistenceTransactionFailureSchema,
  persistencePortResponseSchema,
  adminContentFailureSchema,
  contentAuthoringResponseSchema,
  baseContentResponseSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import { createMediaSourceInspector } from "@fan-support/media-image";
import { createS3MediaStorageAdapter } from "@fan-support/media-s3";
import { createStructuredLogger } from "@fan-support/observability";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "@fan-support/persistence-postgres";
import { createApiApplication } from "../dist/bootstrap.js";
import { createTestResourceManagementComposition } from "../dist/resource-management-composition.js";
import { createTestContentAuthoringComposition } from "../dist/content-authoring-composition.js";
import { createTestBaseContentComposition } from "../dist/base-content-composition.js";
import { createWorkerMediaProcessingComposition } from "../../worker/dist/media-processing-composition.js";
import { createMediaProcessingWorkerRuntime } from "../../worker/dist/media-processing-runtime.js";
import { mediaProvenanceEligibilitySql } from "../../../packages/persistence-postgres/dist/resource-media-eligibility-sql.js";
import { seedResourceManagementFixtures } from "../../../packages/persistence-postgres/scripts/postgres-resource-management-fixtures.mjs";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
import { createResourceUploadBrowser } from "./resource-management-browser.mjs";
import {
  installResourceAuditFault,
  removeResourceAuditFault,
  resourceCounts,
  seedResourceSession,
  seedExpiredResourceUpload,
} from "./resource-management-http-fixtures.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const runnerArgument = "--run-resource-http";
const prefix = "/api/v1/admin/resources";
const authoringPrefix = "/api/v1/admin/content-authoring";
const reviewPrefix = "/api/v1/admin/content-review";
const tokenPepper = randomBytes(32).toString("hex");
const credentials = Object.fromEntries(
  [
    "editor",
    "reviewer",
    "denied",
    "no-mfa",
    "expired",
    "revoked",
    "other-session",
    "during-inspection",
    "after-issue",
    "short-session",
  ].map((name) => [
    name,
    {
      token: randomBytes(32).toString("base64url"),
      csrf: randomBytes(32).toString("base64url"),
    },
  ]),
);
const digest = (purpose, token) =>
  digestAdminContentToken({ tokenPepper, purpose, token });
let stage = "initialization",
  assertions = 0,
  requests = 0,
  failedLabel;
const operations = [];
function check(value, label) {
  assertions++;
  if (!value) failedLabel = label;
  assert.ok(value, label);
}
function codeFor(value) {
  const parsed = adminContentFailureSchema.safeParse(value);
  if (parsed.success) return parsed.data.code;
  const transaction = persistenceTransactionFailureSchema.safeParse(value);
  if (transaction.success) return transaction.data.error.code;
  const port = persistencePortResponseSchema.safeParse(value);
  return port.success && port.data.outcome === "FAILURE"
    ? port.data.error.code
    : "UNKNOWN_FAILURE";
}
function diagnosticPersistence(config) {
  const persistence = createPostgresPersistence(config);
  return {
    close: () => persistence.close(),
    resourceManagementTransactionManager: {
      runInResourceManagementTransaction: (work) =>
        persistence.resourceManagementTransactionManager.runInResourceManagementTransaction(
          async (repos) => {
            const wrapped = {};
            for (const [port, methods] of Object.entries({
              authorization: ["authorize"],
              resources: [
                "readPolicy",
                "registerPolicy",
                "reserveUpload",
                "readUpload",
                "registerUpload",
                "readMedia",
                "setRights",
                "enqueueMedia",
                "readMediaJob",
                "retryMediaJob",
              ],
              idempotency: ["begin", "complete"],
            })) {
              wrapped[port] = {};
              for (const method of methods)
                wrapped[port][method] = async (...args) => {
                  try {
                    const value = await repos[port][method](...args);
                    const code = codeFor(value);
                    operations.push({
                      operation: `${port}.${method}`,
                      outcome:
                        value?.outcome === "SUCCESS" ? "SUCCESS" : "FAILURE",
                      ...(value?.outcome === "FAILURE" ? { code } : {}),
                    });
                    return value;
                  } catch (error) {
                    operations.push({
                      operation: `${port}.${method}`,
                      outcome: "THREW",
                      code: codeFor(error?.failure),
                      ...(typeof error?.code === "string" &&
                      /^[A-Z0-9]{5}$/u.test(error.code)
                        ? { sqlstate: error.code }
                        : {}),
                    });
                    throw error;
                  }
                };
            }
            return work(wrapped);
          },
        ),
    },
  };
}
function environment(database, s3, origin) {
  const url = new globalThis.URL("postgresql://localhost");
  url.hostname = database.host;
  url.port = String(database.port);
  url.pathname = `/${database.database}`;
  url.username = database.user;
  url.password = database.password;
  return {
    NODE_ENV: "test",
    FAN_SUPPORT_DEPLOYMENT_ENV: "test",
    FAN_SUPPORT_SITE_ORIGIN: origin,
    FAN_SUPPORT_DATABASE_URL: url.href,
    FAN_SUPPORT_OBJECT_STORAGE_AUTH_MODE: "static",
    FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT: s3.endpoint,
    FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT: s3.endpoint,
    FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET: s3.sourceBucket,
    FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET: s3.derivativeBucket,
    FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN:
      "https://media.example.invalid",
    FAN_SUPPORT_OBJECT_STORAGE_REGION: "us-east-1",
    FAN_SUPPORT_OBJECT_STORAGE_ACCESS_KEY_ID: s3.accessKeyId,
    FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY: s3.secretAccessKey,
    FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
    FAN_SUPPORT_OBJECT_STORAGE_MAX_UPLOAD_BYTES: "33554432",
  };
}
async function imageBytes(variation = 0, small = false) {
  return sharp({
    create: {
      width: small ? 50 : 1800,
      height: small ? 40 : 1400,
      channels: 3,
      background: { r: 30 + variation, g: 75, b: 125 },
    },
  })
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 85 })
    .toBuffer();
}
function uploadBody(
  bytes,
  mimeType = "image/jpeg",
  reasonCode = "HTTP_RESOURCE_UPLOAD",
) {
  return {
    schemaVersion: 1,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.length,
    mimeType,
    rightsReference: "rights:synthetic-local-fixture",
    expectedVersion: 0,
    reasonCode,
  };
}
async function verify(database, s3, configPath) {
  stage = "migrations";
  await runMigrations({
    clientConfig: database,
    workspaceRoot,
    command: { direction: "up", targetVersion: "0017" },
  });
  const observer = new Client(database);
  await observer.connect();
  const storage = createS3MediaStorageAdapter({
    schemaVersion: 1,
    sourceBucket: s3.sourceBucket,
    derivativeBucket: s3.derivativeBucket,
    publicMediaOrigin: "https://media.example.invalid",
    maxUploadBytes: 33554432,
    region: "us-east-1",
    authentication: {
      mode: "static",
      endpoint: s3.endpoint,
      presignEndpoint: s3.endpoint,
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
      forcePathStyle: true,
    },
  });
  const s3Observer = new S3Client({
    region: "us-east-1",
    endpoint: s3.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
    },
  });
  const logs = [],
    capabilityUrls = [],
    objectKeys = [];
  let browser,
    app,
    worker,
    networkHook,
    signingFails = false,
    inspections = 0,
    signedGrants = 0;
  const runtimes = [];
  try {
    stage = "synthetic browser origins";
    browser = await createResourceUploadBrowser({
      configPath,
      endpoint: s3.endpoint,
    });
    const origin = browser.allowedOrigin;
    await s3Observer.send(
      new PutBucketCorsCommand({
        Bucket: s3.sourceBucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: [origin],
              AllowedMethods: ["PUT"],
              AllowedHeaders: [
                "content-type",
                "if-none-match",
                "x-amz-checksum-sha256",
              ],
              MaxAgeSeconds: 0,
            },
          ],
        },
      }),
    );
    stage = "normal-trigger fixtures";
    const resourceCreatedAt = (
      await observer.query(
        "SELECT to_char((clock_timestamp()-interval '10 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at",
      )
    ).rows[0].at;
    const fixtures = await seedResourceManagementFixtures(observer, {
      resourceCreatedAt,
      sessions: Object.entries(credentials)
        .filter(([name]) => name !== "short-session")
        .map(([name, value]) => ({
          name,
          actor: ["reviewer", "denied"].includes(name) ? name : "editor",
          sessionTokenDigest: digest("admin-session", value.token),
          csrfTokenDigest: digest("admin-csrf", value.csrf),
          authenticatedWithMfa: name !== "no-mfa",
          expiresInSeconds: name === "expired" ? -60 : 3600,
          revoked: name === "revoked",
        })),
    });
    await runMigrations({
      clientConfig: database,
      workspaceRoot,
      command: { direction: "up" },
    });
    const publications = async () =>
      JSON.stringify(
        (
          await observer.query(
            "SELECT jsonb_agg(to_jsonb(p) ORDER BY id) AS value FROM content_publications p",
          )
        ).rows[0].value,
      );
    const publishedBefore = await publications();
    const networkOutsideTransaction = async () =>
      check(
        Number(
          (
            await observer.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction' AND pid<>pg_backend_pid()",
            )
          ).rows[0].count,
        ) === 0,
        "network inspection/signing holds no database transaction",
      );
    const realInspector = createMediaSourceInspector({
      storage: {
        ...storage,
        createDownloadGrant: async (command) => {
          const result = await storage.createDownloadGrant(command);
          const parsed = mediaPortResponseSchema.safeParse(result);
          operations.push({
            operation: "storage.createDownloadGrant",
            outcome: parsed.success ? result.outcome : "INVALID_RESPONSE",
            ...(parsed.success && result.outcome === "FAILURE"
              ? {
                  code: result.error.code,
                  remainingMs: Date.parse(command.expiresAt) - Date.now(),
                }
              : {}),
          });
          return result;
        },
      },
      now: () => new Date(),
    });
    const inspector = {
      inspect: async (command) => {
        inspections++;
        await networkOutsideTransaction();
        const result = await realInspector.inspect(command);
        const parsed = mediaSourceInspectionResponseSchema.safeParse(result);
        operations.push({
          operation: "inspector.inspect",
          outcome: parsed.success ? result.outcome : "INVALID_RESPONSE",
          ...(parsed.success && result.outcome === "FAILURE"
            ? { code: result.error.code }
            : {}),
        });
        if (networkHook) {
          const hook = networkHook;
          networkHook = undefined;
          await hook();
        }
        return result;
      },
    };
    const trackedStorage = {
      ...storage,
      createUploadGrant: async (command) => {
        signedGrants++;
        await networkOutsideTransaction();
        if (signingFails)
          return {
            schemaVersion: 1,
            operation: "CREATE_UPLOAD_GRANT",
            outcome: "FAILURE",
            error: {
              code: "TEMPORARY_UNAVAILABLE",
              schemaVersion: 1,
              recovery: "RETRY_SAME_COMMAND",
              retryAfterMs: 1000,
            },
          };
        const result = await storage.createUploadGrant(command);
        const parsed = mediaPortResponseSchema.safeParse(result);
        operations.push({
          operation: "storage.createUploadGrant",
          outcome: parsed.success ? result.outcome : "INVALID_RESPONSE",
          ...(parsed.success && result.outcome === "FAILURE"
            ? { code: result.error.code }
            : {}),
          ...(parsed.success && result.outcome === "SUCCESS"
            ? {
                expiryDeltaMs:
                  Date.parse(result.value.expiresAt) -
                  Date.parse(command.expiresAt),
                remainingMs: Date.parse(command.expiresAt) - Date.now(),
              }
            : {}),
        });
        return result;
      },
    };
    const options = {
      environment: "TEST",
      database,
      tokenPepper,
      allowedOrigin: origin,
    };
    const resource = createTestResourceManagementComposition(
      { ...options, storage: trackedStorage, inspector },
      { createPersistence: diagnosticPersistence },
    );
    const authoring = createTestContentAuthoringComposition(options),
      baseContent = createTestBaseContentComposition(options);
    runtimes.push(
      resource.resourceManagementRuntime,
      authoring.contentAuthoringRuntime,
      baseContent.baseContentRuntime,
    );
    app = await createApiApplication(environment(database, s3, origin), {
      logger: createStructuredLogger({
        service: "api",
        write: (line) => logs.push(line),
      }),
      ...resource,
      ...authoring,
      ...baseContent,
    });
    await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    async function request(
      endpoint,
      body,
      {
        actor = "editor",
        status = 200,
        key,
        scope = prefix,
        extraHeaders = {},
        raw = false,
      } = {},
    ) {
      stage = `HTTP ${endpoint}`;
      operations.length = 0;
      const headers = {
        origin,
        "content-type": "application/json",
        cookie: `__Host-fan-admin-session=${credentials[actor].token}`,
        "x-csrf-token": credentials[actor].csrf,
        ...(key ? { "idempotency-key": key } : {}),
        ...extraHeaders,
      };
      for (const [name, value] of Object.entries(headers))
        if (value === null) delete headers[name];
      const response = await globalThis.fetch(`${base}${scope}${endpoint}`, {
        method: "POST",
        headers,
        body: raw ? body : JSON.stringify(body),
        signal: globalThis.AbortSignal.timeout(30000),
      });
      requests++;
      const text = await response.text();
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        /* Only a safe status and schema result are reported. */
      }
      const statuses = Array.isArray(status) ? status : [status];
      if (!statuses.includes(response.status))
        console.error(
          `Resource HTTP diagnostic ${JSON.stringify({ request: requests, endpoint, actor, expected: statuses, actual: response.status, code: codeFor(value), operations })}`,
        );
      check(
        statuses.includes(response.status),
        `${endpoint} expected HTTP status`,
      );
      check(
        response.headers.get("cache-control") === "private, no-store",
        "response private no-store",
      );
      check(
        response.headers.get("x-robots-tag") === "noindex, nofollow",
        "response noindex",
      );
      check(
        response.headers.get("referrer-policy") === "no-referrer",
        "response no-referrer",
      );
      check(
        response.headers.get("access-control-allow-origin") === null,
        "API does not reflect CORS origin",
      );
      const secrets = [
        database.password,
        tokenPepper,
        s3.secretAccessKey,
        ...Object.values(credentials).flatMap((v) => [v.token, v.csrf]),
      ];
      check(
        !secrets.some((secret) => text.includes(secret)),
        "response excludes credentials",
      );
      let schema = adminResourceResponseSchema;
      if (scope === authoringPrefix) schema = contentAuthoringResponseSchema;
      if (scope === reviewPrefix) schema = baseContentResponseSchema;
      const parsed = schema.safeParse(value);
      check(parsed.success, "response matches frozen contract");
      if (value.outcome === "SUCCESS" && value.kind === "UPLOAD_GRANT") {
        capabilityUrls.push(value.grant.url);
        check(
          Object.keys(value.grant).sort().join(",") ===
            "expiresAt,headers,method,url",
          "upload capability is minimal",
        );
      } else {
        check(
          !capabilityUrls.some((url) => text.includes(url)),
          "ordinary response excludes upload capability",
        );
        check(
          !objectKeys.some((key) => text.includes(key)),
          "ordinary response excludes private storage key",
        );
        check(
          !text.includes("X-Amz-") && !text.includes("x-amz-"),
          "ordinary response excludes signed storage details",
        );
      }
      return { ...value, httpStatus: response.status };
    }
    async function begin(bytes, options = {}) {
      const value = await request(
        "/uploads/begin",
        {
          ...uploadBody(bytes, options.mimeType),
          ...(options.rightsReference
            ? { rightsReference: options.rightsReference }
            : {}),
        },
        {
          key: options.key ?? randomUUID(),
          actor: options.actor ?? "editor",
          status: options.status ?? 200,
        },
      );
      if (value.outcome !== "SUCCESS") return value;
      const row = (
        await observer.query(
          "SELECT object_key,expires_at<=created_at+interval '900 seconds' AS bounded FROM media_upload_reservations WHERE id=$1",
          [value.uploadId],
        )
      ).rows[0];
      check(
        row?.bounded === true,
        "upload reservation TTL bounded by fifteen minutes",
      );
      objectKeys.push(row.object_key);
      const url = new globalThis.URL(value.grant.url);
      check(
        url.origin === s3.endpoint && url.protocol === "https:",
        "upload grant uses actual isolated TLS storage",
      );
      check(
        Number(url.searchParams.get("X-Amz-Expires")) <= 300,
        "signed capability TTL bounded by five minutes",
      );
      check(
        value.grant.headers["x-amz-checksum-sha256"] ===
          createHash("sha256").update(bytes).digest("base64"),
        "S3 grant signs the expected checksum",
      );
      check(
        value.grant.headers["if-none-match"] === "*",
        "S3 grant forbids overwrites",
      );
      return { ...value, objectKey: row.object_key };
    }
    async function put(upload, bytes, status = 200) {
      stage = "actual TLS upload";
      const response = await globalThis.fetch(upload.grant.url, {
        method: "PUT",
        headers: upload.grant.headers,
        body: bytes,
        signal: globalThis.AbortSignal.timeout(15000),
      });
      await response.body?.cancel();
      check(
        (Array.isArray(status) ? status : [status]).includes(response.status),
        "actual TLS PUT returns expected status",
      );
    }
    const complete = (upload, options = {}) =>
      request(
        "/uploads/complete",
        {
          schemaVersion: 1,
          uploadId: upload.uploadId,
          expectedVersion: 1,
          reasonCode: options.reasonCode ?? "HTTP_RESOURCE_COMPLETE",
        },
        {
          key: options.key ?? randomUUID(),
          actor: options.actor ?? "editor",
          status: options.status ?? 200,
        },
      );
    async function absent(objectKey) {
      try {
        await s3Observer.send(
          new HeadObjectCommand({ Bucket: s3.sourceBucket, Key: objectKey }),
        );
        return false;
      } catch (error) {
        return error?.$metadata?.httpStatusCode === 404;
      }
    }
    async function fault(endpoint, body, options = {}) {
      const before = await resourceCounts(observer),
        key = randomUUID();
      await installResourceAuditFault(observer);
      try {
        const result = await request(
          endpoint,
          { ...body, reasonCode: "HTTP_RESOURCE_ATOMICITY" },
          { ...options, key, status: 503 },
        );
        check(
          result.code === "CONTENT_UNAVAILABLE",
          "database fault exposes safe unavailable code",
        );
        check(
          (await resourceCounts(observer)) === before,
          "audit failure rolls back all DB resource and idempotency rows",
        );
      } finally {
        await removeResourceAuditFault(observer);
      }
      return request(
        endpoint,
        { ...body, reasonCode: "HTTP_RESOURCE_ATOMICITY" },
        { ...options, key },
      );
    }

    stage = "real authentication boundary";
    const readMedia = {
      schemaVersion: 1,
      assetId: fixtures.catalog.media[0].assetId,
    };
    for (const [actor, status] of [
      ["denied", 403],
      ["no-mfa", 401],
      ["expired", 401],
      ["revoked", 401],
    ])
      await request("/media/read", readMedia, { actor, status });
    await request("/media/read", readMedia, { actor: "reviewer" });
    for (const extraHeaders of [
      { origin: null },
      { origin: browser.deniedOrigin },
      { "x-csrf-token": null },
      { "x-csrf-token": credentials.denied.csrf },
      { "sec-fetch-site": "cross-site" },
    ])
      await request("/media/read", readMedia, { extraHeaders, status: 403 });
    await request("/media/read", readMedia, {
      extraHeaders: { cookie: null },
      status: 401,
    });
    await request("/media/read?token=URL_CANARY", readMedia, { status: 400 });
    await request("/media/read", "{broken", { raw: true, status: 400 });
    await request("/media/read", "x".repeat(64 * 1024 + 1), {
      raw: true,
      status: 413,
    });

    const policyKeys = [];
    for (const kind of ["TERMS", "PRIVACY", "REFUND", "DELIVERY"]) {
      const policyKey = `http-${kind.toLowerCase()}-${randomUUID()}`,
        body = {
          schemaVersion: 1,
          policyKey,
          kind,
          expectedVersion: 0,
          reasonCode: "HTTP_POLICY_REGISTER",
        },
        key = randomUUID();
      policyKeys.push(policyKey);
      const created =
        kind === "TERMS"
          ? await fault("/policies/register", body)
          : await request("/policies/register", body, { key });
      const snapshot = await request("/policies/read", {
        schemaVersion: 1,
        policyKey,
      });
      check(
        snapshot.policy.kind === kind,
        "registered policy kind survives read",
      );
      if (kind !== "TERMS") {
        const replay = await request("/policies/register", body, { key });
        check(
          replay.replayed && replay.resultId === created.resultId,
          "policy registration exact replay",
        );
        await request(
          "/policies/register",
          { ...body, kind: kind === "PRIVACY" ? "TERMS" : "PRIVACY" },
          { key, status: 409 },
        );
      }
      await request("/policies/register", body, {
        key: randomUUID(),
        status: 409,
      });
    }
    await request(
      "/policies/read",
      { schemaVersion: 1, policyKey: policyKeys[0] },
      { actor: "reviewer", status: 403 },
    );
    await request(
      "/policies/read",
      { schemaVersion: 1, policyKey: "missing-policy" },
      { status: 404 },
    );

    const bytes = await imageBytes();
    await request(
      "/uploads/begin",
      { ...uploadBody(bytes), objectKey: "FORGED_STORAGE_KEY" },
      { key: randomUUID(), status: 400 },
    );
    await request("/uploads/begin", uploadBody(bytes), {
      key: randomUUID(),
      actor: "reviewer",
      status: 403,
    });
    const auditBegin = await fault(
      "/uploads/begin",
      uploadBody(await imageBytes(1)),
    );
    check(
      auditBegin.kind === "UPLOAD_GRANT",
      "begin recovers same idempotency key after audit failure",
    );
    const signingKey = randomUUID(),
      signingBytes = await imageBytes(2);
    signingFails = true;
    await begin(signingBytes, { key: signingKey, status: 503 });
    signingFails = false;
    const reservationsBefore = (
      await observer.query("SELECT count(*) FROM media_upload_reservations")
    ).rows[0].count;
    const signingRecovery = await begin(signingBytes, { key: signingKey });
    check(signingRecovery.replayed, "signing recovery reuses committed ticket");
    check(
      (await observer.query("SELECT count(*) FROM media_upload_reservations"))
        .rows[0].count === reservationsBefore,
      "signing failure does not duplicate ticket",
    );

    const browserUpload = await begin(bytes, { key: "browser-allowed-upload" });
    stage = "real browser allowed origin";
    const allowed = await browser.upload(browserUpload.grant, bytes, true);
    check(
      allowed.outcome === "RESPONSE" && allowed.status === 200,
      "allowed browser JavaScript reads successful S3 PUT",
    );
    check(
      allowed.methods.includes("OPTIONS") && allowed.methods.includes("PUT"),
      "browser automatically preflights before PUT",
    );
    check(
      allowed.statuses.some(
        (v) => v.method === "OPTIONS" && v.status >= 200 && v.status < 300,
      ),
      "actual browser preflight succeeded",
    );
    const head = await s3Observer.send(
      new HeadObjectCommand({
        Bucket: s3.sourceBucket,
        Key: browserUpload.objectKey,
        ChecksumMode: "ENABLED",
      }),
    );
    check(
      head.ContentLength === bytes.length &&
        head.ChecksumSHA256 ===
          createHash("sha256").update(bytes).digest("base64"),
      "S3 HEAD proves browser uploaded exact signed bytes",
    );
    const deniedUpload = await begin(await imageBytes(3));
    stage = "real browser denied origin";
    const denied = await browser.upload(
      deniedUpload.grant,
      await imageBytes(3),
      false,
    );
    check(
      denied.outcome === "REJECTED",
      "disallowed browser JavaScript is rejected by real CORS",
    );
    check(
      denied.methods.includes("OPTIONS"),
      "disallowed browser attempted automatic preflight",
    );
    check(
      await absent(deniedUpload.objectKey),
      "HEAD proves disallowed browser did not create object",
    );
    await complete(deniedUpload, { status: 404 });
    await put(browserUpload, bytes, [409, 412]);
    const completed = await fault("/uploads/complete", {
      schemaVersion: 1,
      uploadId: browserUpload.uploadId,
      expectedVersion: 1,
      reasonCode: "HTTP_COMPLETE",
    });
    check(
      completed.kind === "MUTATION",
      "trusted decoder registration succeeds after audit fault",
    );
    const sourceId = completed.resultId;
    const registered = await request("/uploads/read", {
      schemaVersion: 1,
      uploadId: browserUpload.uploadId,
    });
    check(
      registered.upload.status === "REGISTERED" &&
        registered.upload.assetId === sourceId,
      "ticket is registered to canonical source",
    );
    const source = await request("/media/read", {
      schemaVersion: 1,
      assetId: sourceId,
    });
    check(
      source.media.width === 1800 &&
        source.media.height === 1400 &&
        source.media.identityKind === "SOURCE" &&
        source.media.rightsStatus === "PENDING",
      "encoded geometry verified independently without rights approval",
    );
    check(
      (
        await observer.query(
          "SELECT verified_orientation FROM media_upload_reservations WHERE id=$1",
          [browserUpload.uploadId],
        )
      ).rows[0].verified_orientation === 6,
      "EXIF orientation recorded by real decoder",
    );
    await request(
      "/uploads/read",
      { schemaVersion: 1, uploadId: browserUpload.uploadId },
      { actor: "other-session", status: 404 },
    );
    await complete(browserUpload, { status: 409 });

    const dup = await begin(bytes, {
      rightsReference: "rights:other-upload-evidence",
    });
    await put(dup, bytes);
    const dupKey = randomUUID(),
      dupComplete = await complete(dup, { key: dupKey });
    check(
      dupComplete.resultId === sourceId,
      "checksum dedup preserves canonical SOURCE identity",
    );
    check(
      (
        await observer.query(
          "SELECT rights_reference FROM media_assets WHERE id=$1",
          [sourceId],
        )
      ).rows[0].rights_reference === "rights:synthetic-local-fixture",
      "dedup never overwrites canonical source rights evidence",
    );
    const inspectionsBefore = inspections,
      replay = await complete(dup, { key: dupKey });
    check(
      replay.replayed &&
        replay.resultId === sourceId &&
        inspections === inspectionsBefore,
      "complete replay skips network inspection",
    );
    const corrupt = await begin(await imageBytes(4));
    const wrong = Buffer.from(await imageBytes(4));
    wrong[100] ^= 1;
    await put(corrupt, wrong, [400, 403]);
    check(
      await absent(corrupt.objectKey),
      "checksum rejection leaves no object",
    );
    await complete(corrupt, { status: 404 });
    await put(corrupt, wrong.subarray(1), [400, 403]);
    check(
      await absent(corrupt.objectKey),
      "signed length mismatch leaves no object",
    );
    await put(
      {
        ...corrupt,
        grant: {
          ...corrupt.grant,
          headers: { ...corrupt.grant.headers, "content-type": "image/png" },
        },
      },
      await imageBytes(4),
      [400, 403],
    );
    check(
      await absent(corrupt.objectKey),
      "signed MIME tampering leaves no object",
    );
    const invalidBytes = Buffer.from("synthetic-not-an-image");
    const invalid = await begin(invalidBytes);
    await put(invalid, invalidBytes);
    await complete(invalid, { status: 400 });
    const mismatched = await begin(await imageBytes(5), {
      mimeType: "image/png",
    });
    await put(mismatched, await imageBytes(5));
    await complete(mismatched, { status: 400 });
    const missing = await begin(await imageBytes(6));
    await complete(missing, { status: 404 });
    stage = "expired reservation fixture";
    const elapsed = await seedExpiredResourceUpload(observer, {
      actorId: fixtures.editor,
      sessionId: fixtures.sessions.editor,
    });
    await request(
      "/uploads/read",
      { schemaVersion: 1, uploadId: elapsed },
      { status: 409 },
    );
    await complete({ uploadId: elapsed }, { status: 409 });

    const short = credentials["short-session"],
      shortId = await seedResourceSession(
        observer,
        fixtures,
        {
          sessionTokenDigest: digest("admin-session", short.token),
          csrfTokenDigest: digest("admin-csrf", short.csrf),
        },
        true,
      );
    const shortUpload = await begin(await imageBytes(7), {
      actor: "short-session",
    });
    const cap = (
      await observer.query(
        "SELECT t.expires_at=s.expires_at AS exact,extract(microseconds FROM s.expires_at)::bigint%1000<>0 AS submillisecond,$3::timestamptz<=s.expires_at AS grant_bounded FROM media_upload_reservations t JOIN admin_sessions s ON s.id=t.session_id WHERE t.id=$1 AND s.id=$2",
        [shortUpload.uploadId, shortId, shortUpload.grant.expiresAt],
      )
    ).rows[0];
    check(
      cap.exact && cap.submillisecond && cap.grant_bounded,
      "nonintegral millisecond session exactly caps reservation and bounds grant",
    );
    const signedUrl = new globalThis.URL(shortUpload.grant.url);
    const signedAt = signedUrl.searchParams.get("X-Amz-Date");
    check(
      typeof signedAt === "string" && /^\d{8}T\d{6}Z$/u.test(signedAt),
      "actual S3 signing timestamp has canonical UTC shape",
    );
    const signedIso = signedAt.replace(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u,
      "$1-$2-$3T$4:$5:$6Z",
    );
    const signedDeadline = new Date(
      Date.parse(signedIso) +
        Number(signedUrl.searchParams.get("X-Amz-Expires")) * 1000,
    ).toISOString();
    check(
      (
        await observer.query(
          "SELECT $2::timestamptz<=expires_at AS bounded FROM admin_sessions WHERE id=$1",
          [shortId, signedDeadline],
        )
      ).rows[0].bounded === true,
      "actual S3 signature deadline never exceeds microsecond session expiry",
    );

    const issuedThenRevoked = await begin(await imageBytes(10), {
      actor: "after-issue",
    });
    await observer.query(
      "UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE id=$1",
      [fixtures.sessions["after-issue"]],
    );
    await put(issuedThenRevoked, await imageBytes(10));
    await complete(issuedThenRevoked, { actor: "after-issue", status: 401 });
    check(
      (await absent(issuedThenRevoked.objectKey)) === false,
      "issued S3 capability can upload until expiry while revoked session cannot register it",
    );
    const race = await begin(await imageBytes(8), {
      actor: "during-inspection",
    });
    await put(race, await imageBytes(8));
    const raceBefore = await resourceCounts(observer);
    networkHook = () =>
      observer.query(
        "UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE id=$1",
        [fixtures.sessions["during-inspection"]],
      );
    await complete(race, { actor: "during-inspection", status: 401 });
    check(
      (await resourceCounts(observer)) === raceBefore,
      "revocation during inspection prevents registration and idempotency writes",
    );

    async function authorAndReview(target, content) {
      const created = await request(
        "/create",
        {
          schemaVersion: 1,
          target,
          content,
          expectedVersion: 0,
          reasonCode: "HTTP_RESOURCE_AUTHOR",
        },
        { scope: authoringPrefix, key: randomUUID() },
      );
      const revisionId = created.resultId;
      for (const locale of SUPPORTED_LOCALES) {
        const reviewTarget = { owner: target, revisionId, locale };
        const read = await request(
          "/read",
          { schemaVersion: 1, target: reviewTarget },
          { scope: reviewPrefix },
        );
        const append = {
          schemaVersion: 1,
          target: reviewTarget,
          expectedVersion: read.context.audit.reviewSequence,
          expectedContentHash: read.context.audit.sourceHash,
          expectedSourceHash: read.context.currentEnglishSourceHash,
          reasonCode: "HTTP_RESOURCE_REVIEW",
        };
        await request("/submit", append, {
          scope: reviewPrefix,
          key: randomUUID(),
        });
        await request(
          "/approve",
          { ...append, expectedVersion: append.expectedVersion + 1 },
          { scope: reviewPrefix, key: randomUUID(), actor: "reviewer" },
        );
        const approved = await request(
          "/read",
          { schemaVersion: 1, target: reviewTarget },
          { scope: reviewPrefix },
        );
        check(
          approved.context.audit.review.status === "APPROVED",
          "new resource revision has independent seven-language review",
        );
      }
      return revisionId;
    }
    const metadataId = await authorAndReview(
      { kind: "MEDIA_METADATA", mediaAssetId: sourceId },
      fixtures.content.media,
    );
    await authorAndReview(
      { kind: "POLICY", policyKey: policyKeys[0] },
      {
        ...fixtures.content.policy,
        structure: { ...fixtures.content.policy.structure, kind: "TERMS" },
      },
    );
    const rightsBody = {
      schemaVersion: 1,
      assetId: sourceId,
      expectedVersion: 0,
      rightsStatus: "APPROVED",
      evidenceReference: "rights:approved-local",
      reasonCode: "HTTP_RIGHTS",
    };
    await request("/media/rights", rightsBody, {
      actor: "reviewer",
      key: randomUUID(),
      status: 403,
    });
    await fault("/media/rights", rightsBody);
    const rights = await request("/media/read", {
      schemaVersion: 1,
      assetId: sourceId,
    });
    check(
      rights.media.rightsStatus === "APPROVED" &&
        rights.media.rightsVersion === 1,
      "rights transition exposes current version",
    );
    await request("/media/rights", rightsBody, {
      key: randomUUID(),
      status: 409,
    });
    const rightsRace = await Promise.all(
      ["REJECTED", "EXPIRED"].map((rightsStatus) =>
        request(
          "/media/rights",
          { ...rightsBody, expectedVersion: 1, rightsStatus },
          { key: randomUUID(), status: [200, 409] },
        ),
      ),
    );
    check(
      rightsRace.filter((v) => v.httpStatus === 200).length === 1 &&
        rightsRace.filter((v) => v.httpStatus === 409).length === 1,
      "concurrent rights version permits exactly one writer",
    );
    const enqueue = {
      schemaVersion: 1,
      sourceAssetId: sourceId,
      metadataRevisionId: metadataId,
      role: "GIFT_PRIMARY",
      fit: "CONTAIN",
      expectedVersion: 0,
      reasonCode: "HTTP_ENQUEUE",
    };
    await request("/processing/enqueue", enqueue, {
      key: randomUUID(),
      status: 400,
    });
    await request(
      "/media/rights",
      { ...rightsBody, expectedVersion: 2 },
      { key: randomUUID() },
    );
    await request(
      "/processing/enqueue",
      { ...enqueue, metadataRevisionId: fixtures.catalog.media[0].revisionId },
      { key: randomUUID(), status: 400 },
    );
    const enqueued = await fault("/processing/enqueue", enqueue);
    await request(
      "/processing/retry",
      {
        schemaVersion: 1,
        jobId: enqueued.resultId,
        expectedVersion: 0,
        reasonCode: "HTTP_RETRY",
      },
      { key: randomUUID(), status: 400 },
    );
    async function processOne() {
      stage = "actual durable media worker";
      let runtime;
      worker = await createWorkerMediaProcessingComposition(
        environment(database, s3, origin),
        {
          logger: createStructuredLogger({
            service: "worker",
            write: (line) => logs.push(line),
          }),
          factories: {
            createRuntime: (options) => {
              runtime = createMediaProcessingWorkerRuntime({
                ...options,
                schedule: () => ({ cancel() {} }),
              });
              return runtime;
            },
          },
        },
      );
      await worker.start();
      await runtime.runOnce();
      await worker.stop();
      worker = undefined;
    }
    await processOne();
    const processed = await request("/processing/read", {
      schemaVersion: 1,
      jobId: enqueued.resultId,
    });
    check(
      processed.job.snapshot.status === "SUCCEEDED",
      "HTTP enqueued job completes through actual worker",
    );
    const outputId = processed.job.snapshot.outputAssetId,
      output = await request("/media/read", {
        schemaVersion: 1,
        assetId: outputId,
      });
    check(
      output.media.identityKind === "PROCESSED_MASTER" &&
        output.media.processingStatus === "READY" &&
        output.media.rightsStatus === "PENDING",
      "processed output remains separately reviewed identity",
    );
    const provenanceEligible = async () =>
      (
        await observer.query(
          `SELECT ${mediaProvenanceEligibilitySql} AS eligible FROM public.media_assets asset WHERE asset.id=$1`,
          [outputId],
        )
      ).rows[0].eligible;
    check(
      (await provenanceEligible()) === true,
      "processed master provenance accepts currently approved original",
    );
    await request(
      "/media/rights",
      { ...rightsBody, expectedVersion: 3, rightsStatus: "REJECTED" },
      { key: randomUUID() },
    );
    check(
      (await provenanceEligible()) === false,
      "actual SQL provenance rejects master after HTTP source rights revocation",
    );
    await request(
      "/media/rights",
      { ...rightsBody, expectedVersion: 4 },
      { key: randomUUID() },
    );
    check(
      (await provenanceEligible()) === true,
      "actual SQL provenance reflects restored original rights",
    );
    const confirmation = {
        ...rightsBody,
        expectedVersion: 5,
        evidenceReference: "rights:renewed-evidence",
      },
      confirmationKey = randomUUID();
    const confirmed = await request("/media/rights", confirmation, {
      key: confirmationKey,
    });
    const confirmedReplay = await request("/media/rights", confirmation, {
      key: confirmationKey,
    });
    check(
      confirmedReplay.replayed &&
        confirmedReplay.resultId === confirmed.resultId,
      "same-status renewed evidence replays without another rights event",
    );
    await request(
      "/media/rights",
      { ...confirmation, expectedVersion: 6 },
      { key: randomUUID() },
    );
    const confirmedMedia = await request("/media/read", {
      schemaVersion: 1,
      assetId: sourceId,
    });
    check(
      confirmedMedia.media.rightsVersion === 7 &&
        confirmedMedia.media.rightsStatus === "APPROVED",
      "same-status confirmation preserves status and creates independent evidence versions",
    );
    const objects = (
      await observer.query(
        "SELECT * FROM public.media_processing_outputs WHERE job_id=$1 ORDER BY kind,format,width",
        [enqueued.resultId],
      )
    ).rows;
    check(
      objects.length === 13,
      "worker stores master and twelve responsive variants",
    );
    for (const object of objects) {
      objectKeys.push(object.object_key);
      const download = await storage.createDownloadGrant({
        schemaVersion: 1,
        operation: "CREATE_DOWNLOAD_GRANT",
        storageClass: object.kind === "MASTER" ? "SOURCE" : "DERIVATIVE",
        objectKey: object.object_key,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      });
      check(
        download.outcome === "SUCCESS",
        "independent derivative download grant",
      );
      const response = await globalThis.fetch(download.value.url);
      check(
        response.ok,
        "actual processed object is retrievable with private grant",
      );
      const decodedBytes = Buffer.from(await response.arrayBuffer());
      check(
        decodedBytes.length === Number(object.byte_size) &&
          createHash("sha256").update(decodedBytes).digest("hex") ===
            object.checksum_sha256,
        "stored derivative checksum and bytes match PostgreSQL",
      );
      const decoded = await sharp(decodedBytes).metadata();
      check(
        decoded.width === object.width && decoded.height === object.height,
        "processed object has recorded real geometry",
      );
      check(
        !decoded.exif &&
          !decoded.icc &&
          !decoded.xmp &&
          !decoded.iptc &&
          !decoded.orientation,
        "processing strips all source metadata",
      );
    }
    await request(
      "/processing/retry",
      {
        schemaVersion: 1,
        jobId: enqueued.resultId,
        expectedVersion: 1,
        reasonCode: "HTTP_RETRY",
      },
      { key: randomUUID(), status: 400 },
    );

    const smallBytes = await imageBytes(9, true),
      small = await begin(smallBytes);
    await put(small, smallBytes);
    const smallSource = await complete(small);
    const smallMetadata = await request(
      "/create",
      {
        schemaVersion: 1,
        target: { kind: "MEDIA_METADATA", mediaAssetId: smallSource.resultId },
        content: fixtures.content.media,
        expectedVersion: 0,
        reasonCode: "HTTP_SMALL_AUTHOR",
      },
      { scope: authoringPrefix, key: randomUUID() },
    );
    const smallJob = await request(
      "/processing/enqueue",
      {
        ...enqueue,
        sourceAssetId: smallSource.resultId,
        metadataRevisionId: smallMetadata.resultId,
        fit: "COVER",
      },
      { key: randomUUID() },
    );
    await processOne();
    const failed = await request("/processing/read", {
      schemaVersion: 1,
      jobId: smallJob.resultId,
    });
    check(
      failed.job.snapshot.status === "FAILED" &&
        failed.job.snapshot.error?.code === "SOURCE_TOO_SMALL",
      "real undersized COVER processing yields permanent safe failure",
    );
    const retried = await fault("/processing/retry", {
      schemaVersion: 1,
      jobId: smallJob.resultId,
      expectedVersion: failed.job.snapshot.attemptCount,
      reasonCode: "HTTP_MANUAL_RETRY",
    });
    const generation = await request("/processing/read", {
      schemaVersion: 1,
      jobId: retried.resultId,
    });
    check(
      generation.job.generation === 2 &&
        generation.job.retryOfJobId === smallJob.resultId &&
        generation.job.snapshot.attemptCount === 0,
      "manual retry creates successor generation without erasing history",
    );
    await request(
      "/processing/retry",
      {
        schemaVersion: 1,
        jobId: smallJob.resultId,
        expectedVersion: failed.job.snapshot.attemptCount,
        reasonCode: "HTTP_MANUAL_RETRY",
      },
      { key: randomUUID(), status: 409 },
    );
    await processOne();
    const old = await request("/processing/read", {
      schemaVersion: 1,
      jobId: smallJob.resultId,
    });
    check(
      JSON.stringify(old.job) === JSON.stringify(failed.job),
      "old failed job and attempt evidence remain unchanged",
    );

    stage = "current role revocation and privacy evidence";
    await observer.query(
      "DELETE FROM admin_identity_roles WHERE admin_identity_id=$1 AND role_id IN (SELECT rp.role_id FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE p.permission_key='content.media.upload')",
      [fixtures.editor],
    );
    await complete(dup, { key: dupKey, status: 403 });
    check(
      (await publications()) === publishedBefore,
      "resource authoring and processing never publish public content",
    );
    const secrets = [
      database.password,
      tokenPepper,
      s3.secretAccessKey,
      ...Object.values(credentials).flatMap((v) => [v.token, v.csrf]),
      ...capabilityUrls,
      ...objectKeys,
      "URL_CANARY",
      "FORGED_STORAGE_KEY",
    ];
    check(
      !secrets.some((secret) => logs.join("\n").includes(secret)),
      "all structured API and worker logs exclude credentials, capabilities and keys",
    );
    check(
      signedGrants > 0 && inspections > 0,
      "actual signing and inspection boundaries exercised",
    );
    const storedIdempotency = JSON.stringify(
      (
        await observer.query(
          "SELECT to_jsonb(record) AS value FROM idempotency_records record",
        )
      ).rows,
    );
    check(
      ![
        ...capabilityUrls,
        ...objectKeys,
        ...Object.values(credentials).flatMap((v) => [v.token, v.csrf]),
      ].some((secret) => storedIdempotency.includes(secret)),
      "idempotency persistence contains no upload capability, key or raw session credential",
    );
    console.log(
      `PASS resource management HTTP/S3/browser (${assertions} assertions, ${requests} HTTP requests); real Chromium automatic OPTIONS/PUT, denied-origin HEAD absence, strict Node TLS chain, private source inspection, seven-language policy/media review, actual image worker, rights concurrency, audited rollback and generation history`,
    );
  } catch (error) {
    console.error(
      `Resource scenario diagnostic ${JSON.stringify({ requests, sqlstate: typeof error?.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code) ? error.code : null, cause: error?.message === "resource operation requires its current specific permission" ? "RESOURCE_PERMISSION_HISTORY" : "UNCLASSIFIED" })}`,
    );
    throw error;
  } finally {
    await worker?.stop();
    if (app) await app.close();
    else for (const runtime of runtimes) await runtime.stop();
    await browser?.close();
    s3Observer.destroy();
    await observer.end();
  }
}
try {
  if (process.argv.includes(runnerArgument)) {
    const configPath = process.env.FAN_SUPPORT_MEDIA_S3_TEST_CONFIG;
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    await withEphemeralPostgres((database) => verify(database, s3, configPath));
  } else
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: runnerArgument,
        timeoutMs: 240000,
      }),
    );
} catch (error) {
  const safeName = [
    "TypeError",
    "ReferenceError",
    "AbortError",
    "TimeoutError",
    "Error",
    "AssertionError",
  ].includes(error?.name)
    ? error.name
    : "UNKNOWN";
  const ownLine =
    typeof error?.stack === "string"
      ? error.stack.match(/resource-management-http\.mjs:(\d+):\d+/u)?.[1]
      : undefined;
  console.error(
    `Resource runner diagnostic ${JSON.stringify({ requests, name: safeName, line: ownLine ?? null })}`,
  );
  console.error(
    `FAIL resource management HTTP/S3/browser at ${stage}; assertion=${failedLabel ?? "NONE"}; code=${typeof error?.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code) ? error.code : "UNAVAILABLE"}`,
  );
  process.exitCode = 1;
}
