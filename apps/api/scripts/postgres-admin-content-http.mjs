#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { Client, Pool } from "pg";
import { digestAdminContentToken } from "@fan-support/application";
import {
  adminContentResponseSchema,
  adminAuthorizationResponseSchema,
  adminContentFailureSchema,
  contentPreviewResponseSchema,
  persistencePortResponseSchema,
  persistenceTransactionFailureSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import { createStructuredLogger } from "@fan-support/observability";
import {
  runMigrations,
  withEphemeralPostgres,
} from "@fan-support/persistence-postgres";
import { createPostgresPersistenceWithPoolFactory } from "../../../packages/persistence-postgres/dist/postgres-persistence.js";
import { createApiApplication } from "../dist/bootstrap.js";
import { createTestAdminContentComposition } from "../dist/admin-content-composition.js";
import {
  seedAdminContentFixtures,
  revokeAdminContentLocaleGrant,
} from "../../../packages/persistence-postgres/scripts/postgres-admin-content-fixtures.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const origin = "https://admin.example.invalid";
const tokenPepper = randomBytes(32).toString("hex");
const credentials = Object.fromEntries(
  ["editor", "reviewer", "denied", "no-mfa", "expired", "revoked"].map(
    (name) => [
      name,
      {
        token: randomBytes(32).toString("base64url"),
        csrf: randomBytes(32).toString("base64url"),
      },
    ],
  ),
);
const digest = (purpose, token) =>
  digestAdminContentToken({ tokenPepper, purpose, token });
const operationDiagnostics = [];
let firstAuthorization;
let simulatePreviewClockRollback = false;
let injectedPreviewClockReads = 0;
let simulateIssueClockRollback = false;
let injectedIssueClockReads = 0;
let currentPersistenceOperation;

function createDiagnosticPool(config) {
  const pool = new Pool(config);
  return {
    async connect() {
      const client = await pool.connect();
      return {
        async query(sql, values) {
          let selectedSql = sql;
          const revokeClock =
            simulatePreviewClockRollback &&
            currentPersistenceOperation === "contentPreviews.revoke" &&
            sql.trimStart().startsWith("SELECT ") &&
            sql.includes(" AS now");
          const issueClock =
            simulateIssueClockRollback &&
            currentPersistenceOperation === "contentPreviews.issue" &&
            sql.includes("WITH preview_clock AS") &&
            sql.includes(" AS now");
          if (
            (revokeClock || issueClock) &&
            /(?:clock_timestamp|transaction_timestamp)\(\)/u.test(sql)
          ) {
            const clockPattern = issueClock
              ? /clock_timestamp\(\)/gu
              : /(?:clock_timestamp|transaction_timestamp)\(\)/gu;
            selectedSql = sql.replace(
              clockPattern,
              (read) => `(${read} - interval '60 seconds')`,
            );
            if (revokeClock) injectedPreviewClockReads++;
            if (issueClock) injectedIssueClockReads++;
          }
          return client.query(selectedSql, values);
        },
        release: (destroy) => client.release(destroy),
      };
    },
    end: () => pool.end(),
    on: (event, listener) => pool.on(event, listener),
    off: (event, listener) => pool.off(event, listener),
  };
}
function failureCode(value) {
  const admin = adminContentFailureSchema.safeParse(value);
  if (admin.success) return admin.data.code;
  const transaction = persistenceTransactionFailureSchema.safeParse(value);
  if (transaction.success) return transaction.data.error.code;
  const port = persistencePortResponseSchema.safeParse(value);
  if (port.success && port.data.outcome === "FAILURE")
    return port.data.error.code;
  return "UNKNOWN_FAILURE";
}
function recordOperation(operation, result) {
  const entry = {
    operation,
    outcome: result?.outcome === "SUCCESS" ? "SUCCESS" : "FAILURE",
  };
  if (entry.outcome === "FAILURE") entry.code = failureCode(result);
  if (operation === "authorization.authorize") {
    const parsed = adminAuthorizationResponseSchema.safeParse(result);
    if (parsed.success && parsed.data.outcome === "SUCCESS") {
      const time = {
        authorized: Date.parse(parsed.data.principal.authorizedAt),
        expires: Date.parse(parsed.data.principal.expiresAt),
      };
      firstAuthorization ??= time;
      entry.authorizedDeltaMs = time.authorized - firstAuthorization.authorized;
      entry.expiryDeltaMs = time.expires - firstAuthorization.expires;
    }
  }
  if (
    operation === "idempotency.begin" &&
    ["STARTED", "REPLAY", "CONFLICT", "IN_PROGRESS"].includes(
      result?.value?.decision,
    )
  )
    entry.decision = result.value.decision;
  operationDiagnostics.push(entry);
}
function diagnosticPersistence(config) {
  const persistence = createPostgresPersistenceWithPoolFactory(
    config,
    undefined,
    createDiagnosticPool,
  );
  return {
    ...persistence,
    adminContentTransactionManager: {
      async runInAdminContentTransaction(work) {
        try {
          return await persistence.adminContentTransactionManager.runInAdminContentTransaction(
            async (repositories) => {
              const wrapped = {};
              for (const [repositoryName, methods] of Object.entries({
                authorization: ["authorize"],
                contentDrafts: [
                  "read",
                  "createIdolAliases",
                  "createGiftDetails",
                ],
                contentReviews: ["loadTarget", "append"],
                contentPreviews: ["issue", "read", "revoke"],
                idempotency: ["begin", "complete"],
              })) {
                wrapped[repositoryName] = {};
                for (const method of methods) {
                  const operation = `${repositoryName}.${method}`;
                  wrapped[repositoryName][method] = async (input) => {
                    const previousOperation = currentPersistenceOperation;
                    currentPersistenceOperation = operation;
                    try {
                      const result =
                        await repositories[repositoryName][method](input);
                      recordOperation(operation, result);
                      return result;
                    } catch (error) {
                      recordOperation(operation, error?.failure);
                      throw error;
                    } finally {
                      currentPersistenceOperation = previousOperation;
                    }
                  };
                }
              }
              return work(wrapped);
            },
          );
        } catch (error) {
          recordOperation("transaction", error?.failure);
          throw error;
        }
      },
    },
  };
}
let stage = "initialization";
let assertions = 0;
let requests = 0;
const check = (condition, label) => {
  stage = label;
  assert.ok(condition, label);
  assertions++;
};
function environment(config) {
  const database = new URL("postgresql://localhost");
  database.hostname = config.host;
  database.port = String(config.port);
  database.username = config.user;
  database.password = config.password;
  database.pathname = `/${config.database}`;
  return {
    NODE_ENV: "test",
    FAN_SUPPORT_DEPLOYMENT_ENV: "test",
    FAN_SUPPORT_SITE_ORIGIN: "http://localhost:3002",
    FAN_SUPPORT_DATABASE_URL: database.toString(),
    FAN_SUPPORT_OBJECT_STORAGE_AUTH_MODE: "static",
    FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT: "https://object-storage:9000",
    FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT: "https://object-storage:9000",
    FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET: "fan-support-media-source",
    FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET:
      "fan-support-media-derivative",
    FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN:
      "https://media.example.invalid",
    FAN_SUPPORT_OBJECT_STORAGE_REGION: "us-east-1",
    FAN_SUPPORT_OBJECT_STORAGE_ACCESS_KEY_ID: "TEST_ACCESS_KEY_ID",
    FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY:
      "TEST_OBJECT_STORAGE_SECRET_VALUE",
    FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
  };
}

try {
  await withEphemeralPostgres(async (clientConfig) => {
    stage = "migrations";
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up", targetVersion: "0017" },
    });
    const observer = new Client(clientConfig);
    await observer.connect();
    let app;
    let composition;
    const logs = [];
    try {
      stage = "normal-trigger authorization fixture";
      const fixture = await seedAdminContentFixtures(observer, {
        sessions: Object.entries(credentials).map(([name, value]) => ({
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
        clientConfig,
        workspaceRoot,
        command: { direction: "up" },
      });
      const originalPublished = (
        await observer.query(
          "SELECT jsonb_agg(to_jsonb(p) ORDER BY id) AS value FROM content_publications p",
        )
      ).rows[0].value;
      stage = "real API composition startup";
      composition = createTestAdminContentComposition(
        {
          environment: "TEST",
          database: clientConfig,
          tokenPepper,
          allowedOrigin: origin,
        },
        { createPersistence: diagnosticPersistence },
      );
      app = await createApiApplication(environment(clientConfig), {
        logger: createStructuredLogger({
          service: "api",
          write: (line) => logs.push(line),
        }),
        ...composition,
      });
      await app.listen(0, "127.0.0.1");
      const address = app.getHttpServer().address();
      check(
        address !== null && typeof address === "object",
        "real HTTP listener binds loopback",
      );
      const base = `http://127.0.0.1:${address.port}`;
      async function request(
        endpoint,
        body,
        {
          actor = "editor",
          status = 200,
          key,
          extraHeaders = {},
          preview = false,
          raw = false,
        } = {},
      ) {
        operationDiagnostics.length = 0;
        firstAuthorization = undefined;
        stage = `HTTP ${endpoint}`;
        const identity = credentials[actor];
        const headers = {
          origin,
          "content-type": "application/json",
          ...(!preview
            ? {
                cookie: `__Host-fan-admin-session=${identity.token}`,
                "x-csrf-token": identity.csrf,
              }
            : {}),
          ...(key ? { "idempotency-key": key } : {}),
          ...extraHeaders,
        };
        for (const [name, value] of Object.entries(headers))
          if (value === null) delete headers[name];
        const response = await globalThis.fetch(
          `${base}${preview ? "/api/v1/content-preview" : "/api/v1/admin/content"}${endpoint}`,
          {
            method: "POST",
            headers,
            body: raw ? body : JSON.stringify(body),
            signal: globalThis.AbortSignal.timeout(30_000),
          },
        );
        requests++;
        const text = await response.text();
        if (response.status !== status) {
          let code = "INVALID_RESPONSE";
          try {
            code = failureCode(JSON.parse(text));
          } catch {
            /* Keep malformed responses out of diagnostics. */
          }
          globalThis.console.error(
            `HTTP diagnostic ${JSON.stringify({ request: requests, endpoint, actor: Object.hasOwn(credentials, actor) ? actor : "UNKNOWN", kind: ["IDOL_ALIASES", "GIFT_DETAILS"].includes(body?.target?.kind) ? body.target.kind : null, locale: SUPPORTED_LOCALES.includes(body?.target?.locale) ? body.target.locale : null, expectedStatus: status, actualStatus: response.status, code, operations: operationDiagnostics })}`,
          );
        }
        check(
          response.status === status,
          `${endpoint} HTTP expected ${status}, actual ${response.status}`,
        );
        check(
          response.headers.get("cache-control") === "private, no-store",
          `${endpoint} private no-store`,
        );
        check(
          response.headers.get("x-robots-tag") === "noindex, nofollow",
          `${endpoint} noindex`,
        );
        check(
          response.headers.get("referrer-policy") === "no-referrer",
          `${endpoint} no-referrer`,
        );
        check(
          response.headers.get("access-control-allow-origin") === null,
          `${endpoint} no reflected CORS origin`,
        );
        check(
          ![
            clientConfig.password,
            tokenPepper,
            ...Object.values(credentials).flatMap((value) => [
              value.token,
              value.csrf,
            ]),
          ].some((secret) => text.includes(secret)),
          `${endpoint} no session or server secret in response`,
        );
        return (
          preview ? contentPreviewResponseSchema : adminContentResponseSchema
        ).parse(JSON.parse(text));
      }
      const aliasRead = {
        schemaVersion: 1,
        target: {
          schemaVersion: 1,
          kind: "IDOL_ALIASES",
          idolRevisionId: fixture.idolRevisionId,
        },
      };
      for (const [actor, status] of [
        ["denied", 403],
        ["no-mfa", 401],
        ["expired", 401],
        ["revoked", 401],
      ])
        await request("/drafts/read", aliasRead, { actor, status });
      await request("/drafts/read", aliasRead, {
        status: 401,
        extraHeaders: { cookie: null },
      });
      await request("/drafts/read", aliasRead, {
        status: 403,
        extraHeaders: { origin: "https://attacker.example.invalid" },
      });
      await request("/drafts/read", aliasRead, {
        status: 403,
        extraHeaders: { origin: null },
      });
      await request("/drafts/read", aliasRead, {
        status: 403,
        extraHeaders: { "x-csrf-token": credentials.reviewer.csrf },
      });
      await request(
        "/drafts/read",
        { ...aliasRead, actorId: fixture.reviewer },
        { status: 400 },
      );
      await request("/drafts/read", "{", { status: 400, raw: true });
      await request("/unknown", {}, { status: 404 });
      await request("/drafts/read", aliasRead, { status: 404 });
      const aliasCreate = {
        schemaVersion: 1,
        expectedVersion: 1,
        draft: {
          schemaVersion: 1,
          id: randomUUID(),
          idolRevisionId: fixture.idolRevisionId,
          aliases: [
            { id: "common", locale: null, text: "Étoile" },
            { id: "english", locale: "en", text: "Nova" },
            { id: "japanese", locale: "ja", text: "星の名前" },
          ],
          reasonCode: "CONTENT_CREATED",
        },
      };
      const aliasKey = randomUUID();
      stage = "deterministic audit failure rolls back complete HTTP command";
      await observer.query(
        "CREATE FUNCTION public.reject_http_content_creation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='IDOL_ALIAS_DRAFT_CREATE' THEN RAISE EXCEPTION 'fixture content audit unavailable' USING ERRCODE='P0001'; END IF; RETURN NEW; END; $$",
      );
      await observer.query(
        "CREATE TRIGGER reject_http_content_creation BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.reject_http_content_creation()",
      );
      try {
        await request("/drafts/aliases", aliasCreate, {
          key: aliasKey,
          status: 503,
        });
        const rollback = (
          await observer.query(
            "SELECT (SELECT count(*)::int FROM idol_revision_alias_sets) AS drafts,(SELECT count(*)::int FROM idol_revision_alias_reviews) AS reviews,(SELECT count(*)::int FROM audit_logs WHERE action='IDOL_ALIAS_DRAFT_CREATE') AS audits,(SELECT count(*)::int FROM idempotency_records) AS reservations",
          )
        ).rows[0];
        check(
          Object.values(rollback).every((count) => count === 0),
          "failed HTTP command leaves no draft, review, audit or idempotency reservation",
        );
      } finally {
        await observer.query(
          "DROP TRIGGER reject_http_content_creation ON public.audit_logs",
        );
        await observer.query(
          "DROP FUNCTION public.reject_http_content_creation()",
        );
      }
      const created = await request("/drafts/aliases", aliasCreate, {
        key: aliasKey,
      });
      check(
        created.outcome === "SUCCESS" && !created.replayed,
        "first aliases creation succeeds",
      );
      const replay = await request("/drafts/aliases", aliasCreate, {
        key: aliasKey,
      });
      check(
        replay.outcome === "SUCCESS" &&
          replay.replayed &&
          replay.resultId === created.resultId,
        "same command replays stable result",
      );
      await request(
        "/drafts/aliases",
        { ...aliasCreate, draft: { ...aliasCreate.draft, aliases: [] } },
        { key: aliasKey, status: 409 },
      );
      await request("/drafts/aliases", aliasCreate, {
        key: randomUUID(),
        status: 409,
      });
      let aliases = await request("/drafts/read", aliasRead);
      check(
        aliases.outcome === "SUCCESS" &&
          aliases.kind === "DRAFT" &&
          aliases.content.outcome === "SUCCESS",
        "authorized read returns canonical draft",
      );
      const reviewBody = (context) => ({
        schemaVersion: 1,
        target: context.target,
        expectedVersion: context.sequence,
        expectedContentHash: context.contentHash,
        expectedSourceHash: context.sourceHash,
        reasonCode: "CONTENT_REVIEWED",
      });
      const aliasContext = aliases.reviews[0];
      await request(
        "/reviews/submit",
        { ...reviewBody(aliasContext), expectedVersion: 99 },
        { key: randomUUID(), status: 409 },
      );
      await request("/reviews/submit", reviewBody(aliasContext), {
        key: randomUUID(),
      });
      aliases = await request("/drafts/read", aliasRead);
      const approval = reviewBody(aliases.reviews[0]);
      await request("/reviews/approve", approval, {
        key: randomUUID(),
        status: 403,
      });
      await request(
        "/reviews/approve",
        { ...approval, expectedContentHash: "0".repeat(64) },
        { actor: "reviewer", key: randomUUID(), status: 409 },
      );
      const approvalKey = randomUUID();
      await request("/reviews/approve", approval, {
        actor: "reviewer",
        key: approvalKey,
      });
      const approvalReplay = await request("/reviews/approve", approval, {
        actor: "reviewer",
        key: approvalKey,
      });
      check(
        approvalReplay.outcome === "SUCCESS" && approvalReplay.replayed,
        "review result replays after state changes",
      );
      const giftCreate = {
        schemaVersion: 1,
        expectedVersion: 1,
        draft: {
          schemaVersion: 1,
          document: {
            schemaVersion: 1,
            id: randomUUID(),
            giftRevisionId: fixture.giftRevisionId,
            blocks: [{ id: "intro", kind: "PARAGRAPH" }],
          },
          translations: SUPPORTED_LOCALES.map((locale) => ({
            id: randomUUID(),
            locale,
            origin: locale === "en" ? "HUMAN" : "MACHINE",
            blocks: [
              {
                blockId: "intro",
                kind: "PARAGRAPH",
                text: `${locale} fictional gift description`,
              },
            ],
          })),
          reasonCode: "CONTENT_CREATED",
        },
      };
      await request("/drafts/gift-details", giftCreate, { key: randomUUID() });
      const giftRead = {
        schemaVersion: 1,
        target: {
          schemaVersion: 1,
          kind: "GIFT_DETAILS",
          giftRevisionId: fixture.giftRevisionId,
        },
      };
      let gift = await request("/drafts/read", giftRead);
      check(
        gift.outcome === "SUCCESS" &&
          gift.kind === "DRAFT" &&
          gift.reviews.length === SUPPORTED_LOCALES.length,
        "seven localized review contexts come from PostgreSQL",
      );
      for (const context of gift.reviews)
        await request("/reviews/submit", reviewBody(context), {
          key: randomUUID(),
        });
      gift = await request("/drafts/read", giftRead);
      for (const context of gift.reviews)
        await request("/reviews/approve", reviewBody(context), {
          actor: "reviewer",
          key: randomUUID(),
        });
      gift = await request("/drafts/read", giftRead);
      check(
        gift.reviews.every((context) => context.status === "APPROVED"),
        "independent reviewer approves seven languages",
      );
      const previewTarget = {
        kind: "IDOL_ALIASES",
        revisionId: fixture.idolRevisionId,
        locale: "en",
      };
      const previewBody = {
        schemaVersion: 1,
        target: previewTarget,
        ttlSeconds: 60,
        reasonCode: "CONTENT_PREVIEW",
      };
      const grant = await request("/preview/issue", previewBody);
      check(
        grant.outcome === "SUCCESS" && grant.kind === "PREVIEW_GRANT",
        "short-lived preview token issued once",
      );
      const previewRequest = {
        schemaVersion: 1,
        target: previewTarget,
        token: grant.token,
      };
      const preview = await request("/read", previewRequest, { preview: true });
      check(
        preview.outcome === "SUCCESS" &&
          preview.content.kind === "IDOL_ALIASES" &&
          preview.content.aliases.length === 2,
        "read-only preview contains selected locale and shared aliases",
      );
      await request(
        "/read",
        { ...previewRequest, target: { ...previewTarget, locale: "ja" } },
        { preview: true, status: 404 },
      );
      await request(
        "/read",
        {
          ...previewRequest,
          target: { ...previewTarget, revisionId: randomUUID() },
        },
        { preview: true, status: 404 },
      );
      await request(
        "/read",
        { ...previewRequest, token: randomBytes(32).toString("base64url") },
        { preview: true, status: 404 },
      );
      await request("/read?token=redacted", previewRequest, {
        preview: true,
        status: 400,
      });
      const revoke = {
        schemaVersion: 1,
        grantId: grant.grantId,
        reasonCode: "PREVIEW_REVOKED",
      };
      await request("/preview/revoke", revoke, {
        actor: "reviewer",
        key: randomUUID(),
        status: 404,
      });
      const revokeKey = randomUUID();
      await request("/preview/revoke", revoke, { key: revokeKey });
      await request("/preview/revoke", revoke, { key: revokeKey });
      await request("/read", previewRequest, { preview: true, status: 404 });
      stage = "deterministic preview revocation during wall-clock rollback";
      const rollbackGrant = await request("/preview/issue", previewBody);
      check(
        rollbackGrant.outcome === "SUCCESS" &&
          rollbackGrant.kind === "PREVIEW_GRANT",
        "rollback fixture is a normally issued preview grant",
      );
      simulatePreviewClockRollback = true;
      try {
        await request(
          "/preview/revoke",
          {
            schemaVersion: 1,
            grantId: rollbackGrant.grantId,
            reasonCode: "PREVIEW_REVOKED",
          },
          { key: randomUUID() },
        );
      } finally {
        simulatePreviewClockRollback = false;
      }
      check(
        injectedPreviewClockReads === 1,
        "rollback affects exactly one event-time SELECT in the revoke command",
      );
      const rollbackRevocation = (
        await observer.query(
          "SELECT g.revoked_at>=g.created_at AS causal,g.revoked_at=a.created_at AS exact_audit FROM content_preview_grants g JOIN audit_logs a ON a.id=g.revoked_audit_log_id WHERE g.id=$1",
          [rollbackGrant.grantId],
        )
      ).rows[0];
      check(
        rollbackRevocation.causal === true,
        "preview revocation remains after its persisted issuance during rollback",
      );
      check(
        rollbackRevocation.exact_audit === true,
        "rollback revocation timestamp exactly matches its audit",
      );
      stage = "deterministic preview issuance during wall-clock rollback";
      credentials.recent = {
        token: randomBytes(32).toString("base64url"),
        csrf: randomBytes(32).toString("base64url"),
      };
      const recentSession = randomUUID();
      await observer.query(
        "INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,last_seen_at,expires_at) VALUES($1,$2,decode($3,'hex'),decode($4,'hex'),true,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour')",
        [
          recentSession,
          fixture.editor,
          digest("admin-session", credentials.recent.token),
          digest("admin-csrf", credentials.recent.csrf),
        ],
      );
      let rollbackIssued;
      simulateIssueClockRollback = true;
      try {
        rollbackIssued = await request(
          "/preview/issue",
          { ...previewBody, ttlSeconds: 300 },
          { actor: "recent" },
        );
      } finally {
        simulateIssueClockRollback = false;
      }
      check(
        injectedIssueClockReads === 1,
        "rollback affects exactly one event-time SELECT in the issue command",
      );
      const rollbackIssuance = (
        await observer.query(
          "SELECT g.created_at>=s.created_at AS causal,g.created_at=a.created_at AS exact_audit,g.expires_at>s.created_at AND g.expires_at<=s.expires_at AND g.expires_at<g.created_at+interval '300 seconds' AS bounded_ttl FROM content_preview_grants g JOIN admin_sessions s ON s.id=g.session_id JOIN audit_logs a ON a.id=g.audit_log_id WHERE g.id=$1",
          [rollbackIssued.grantId],
        )
      ).rows[0];
      check(
        rollbackIssuance.causal === true,
        "preview issuance remains after its persisted session creation during rollback",
      );
      check(
        rollbackIssuance.exact_audit === true,
        "rollback issuance timestamp exactly matches its audit",
      );
      check(
        rollbackIssuance.bounded_ttl === true,
        "rollback issuance shortens its remaining TTL within the session deadline",
      );
      const giftTarget = {
        kind: "GIFT_DETAILS",
        revisionId: fixture.giftRevisionId,
        locale: "th",
      };
      const giftGrant = await request("/preview/issue", {
        ...previewBody,
        target: giftTarget,
      });
      const giftPreview = await request(
        "/read",
        { schemaVersion: 1, target: giftTarget, token: giftGrant.token },
        { preview: true },
      );
      check(
        giftPreview.outcome === "SUCCESS" &&
          giftPreview.content.kind === "GIFT_DETAILS" &&
          giftPreview.content.translation.blocks[0].text.startsWith("th "),
        "gift preview resolves requested translation without English fallback",
      );
      const secretFields = new Set([
        "editorId",
        "reviewerId",
        "review",
        "sourceHash",
        "objectKey",
        "auditLogId",
        "sessionId",
      ]);
      function safeProjection(value) {
        if (value === null || typeof value !== "object") return true;
        return Object.entries(value).every(
          ([key, entry]) => !secretFields.has(key) && safeProjection(entry),
        );
      }
      check(
        safeProjection(giftPreview),
        "preview projection strips administrative evidence and storage internals",
      );
      stage = "actual short session and preview expiration";
      credentials.short = {
        token: randomBytes(32).toString("base64url"),
        csrf: randomBytes(32).toString("base64url"),
      };
      const shortSession = randomUUID();
      // Allow issuance and its positive read to finish before testing real expiry.
      await observer.query(
        "INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,last_seen_at,expires_at) VALUES($1,$2,decode($3,'hex'),decode($4,'hex'),true,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '15 seconds')",
        [
          shortSession,
          fixture.editor,
          digest("admin-session", credentials.short.token),
          digest("admin-csrf", credentials.short.csrf),
        ],
      );
      const shortGrant = await request("/preview/issue", previewBody, {
        actor: "short",
      });
      check(
        (
          await observer.query(
            "SELECT g.expires_at=s.expires_at AND g.expires_at>clock_timestamp() AS bounded_and_current FROM content_preview_grants g JOIN admin_sessions s ON s.id=g.session_id WHERE g.id=$1 AND s.id=$2",
            [shortGrant.grantId, shortSession],
          )
        ).rows[0]?.bounded_and_current === true,
        "short preview is current and expires exactly at its real session deadline",
      );
      await request(
        "/read",
        { ...previewRequest, token: shortGrant.token },
        { preview: true },
      );
      const expirationDeadline = globalThis.performance.now() + 20_000;
      let shortExpired = false;
      while (
        !shortExpired &&
        globalThis.performance.now() < expirationDeadline
      ) {
        shortExpired =
          (
            await observer.query(
              "SELECT clock_timestamp()>=GREATEST(g.expires_at,s.expires_at)+interval '250 milliseconds' AS expired FROM content_preview_grants g JOIN admin_sessions s ON s.id=g.session_id WHERE g.id=$1 AND s.id=$2",
              [shortGrant.grantId, shortSession],
            )
          ).rows[0]?.expired === true;
        if (!shortExpired) await setTimeout(25);
      }
      check(
        shortExpired,
        "PostgreSQL reaches both actual expiry times within the monotonic wait budget",
      );
      await request(
        "/read",
        { ...previewRequest, token: shortGrant.token },
        { preview: true, status: 404 },
      );
      await request("/drafts/read", aliasRead, { actor: "short", status: 401 });
      stage = "single-language review scope";
      for (const locale of SUPPORTED_LOCALES.filter(
        (value) => value !== "ja",
      )) {
        await revokeAdminContentLocaleGrant(observer, {
          adminIdentityId: fixture.reviewer,
          locale,
          actorId: fixture.editor,
        });
      }
      await request("/drafts/read", giftRead, {
        actor: "reviewer",
        status: 403,
      });
      const reviewTarget = {
        kind: "GIFT_DETAILS",
        revisionId: fixture.giftRevisionId,
        locale: "ja",
      };
      const selectedReview = await request(
        "/reviews/read",
        { schemaVersion: 1, target: reviewTarget },
        { actor: "reviewer" },
      );
      check(
        selectedReview.outcome === "SUCCESS" &&
          selectedReview.kind === "REVIEW" &&
          selectedReview.context.target.locale === "ja" &&
          selectedReview.content.kind === "GIFT_DETAILS",
        "single-language reviewer reads its canonical review target",
      );
      check(
        selectedReview.content.translation.blocks[0].text.startsWith("ja ") &&
          selectedReview.source.blocks[0].text.startsWith("en "),
        "review read exposes selected translation and actual English source",
      );
      await request(
        "/reviews/read",
        { schemaVersion: 1, target: { ...reviewTarget, locale: "th" } },
        { actor: "reviewer", status: 403 },
      );
      await request(
        "/reviews/read",
        {
          schemaVersion: 1,
          target: { kind: "IDOL_ALIASES", revisionId: fixture.idolRevisionId },
        },
        { actor: "reviewer", status: 403 },
      );
      stage = "locale permission revocation";
      await revokeAdminContentLocaleGrant(observer, {
        adminIdentityId: fixture.reviewer,
        locale: "ja",
        actorId: fixture.editor,
      });
      await request(
        "/preview/issue",
        { ...previewBody, target: { ...previewTarget, locale: "ja" } },
        { actor: "reviewer", status: 403 },
      );
      stage = "session revocation invalidates outstanding preview";
      await observer.query(
        "UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE id=$1",
        [fixture.sessions.editor],
      );
      await request(
        "/read",
        { schemaVersion: 1, target: giftTarget, token: giftGrant.token },
        { preview: true, status: 404 },
      );
      const stored = (
        await observer.query(
          "SELECT encode(token_digest,'hex') AS digest FROM content_preview_grants WHERE id=$1",
          [grant.grantId],
        )
      ).rows[0];
      check(
        stored.digest === digest("content-preview", grant.token),
        "PostgreSQL stores domain-separated preview digest only",
      );
      check(
        JSON.stringify(
          (
            await observer.query(
              "SELECT jsonb_agg(to_jsonb(p) ORDER BY id) AS value FROM content_publications p",
            )
          ).rows[0].value,
        ) === JSON.stringify(originalPublished),
        "authoring and preview leave immutable publications unchanged",
      );
      check(
        ![
          tokenPepper,
          grant.token,
          rollbackGrant.token,
          rollbackIssued.token,
          giftGrant.token,
          shortGrant.token,
          ...Object.values(credentials).flatMap((value) => [
            value.token,
            value.csrf,
          ]),
        ].some((secret) => logs.join("\n").includes(secret)),
        "real HTTP logs contain no credentials or preview tokens",
      );
      check(
        (
          await observer.query(
            "SELECT count(*)::int AS count FROM audit_logs WHERE action='IDOL_ALIAS_DRAFT_CREATE'",
          )
        ).rows[0].count === 1,
        "replayed alias command does not duplicate audit",
      );
      await app.close();
      app = undefined;
      globalThis.console.log(
        `PASS admin content HTTP: ${assertions} assertions / ${requests} real requests; PostgreSQL sessions, RBAC, CSRF, idempotency, reviews, scoped previews and expiry verified`,
      );
    } finally {
      if (app) await app.close();
      else if (composition) await composition.adminContentRuntime.stop();
      await observer.end();
    }
  });
} catch {
  globalThis.console.error(`FAIL admin content HTTP at ${stage}`);
  process.exitCode = 1;
}
