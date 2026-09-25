#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { digestAdminContentToken } from "@fan-support/application";
import {
  adminContentFailureSchema,
  adminContentResponseSchema,
  baseContentResponseSchema,
  baseContentPreviewResponseSchema,
  contentAuthoringResponseSchema,
  persistencePortResponseSchema,
  persistenceTransactionFailureSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import { createStructuredLogger } from "@fan-support/observability";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "@fan-support/persistence-postgres";
import { createApiApplication } from "../dist/bootstrap.js";
import { createTestContentAuthoringComposition } from "../dist/content-authoring-composition.js";
import { createTestAdminContentComposition } from "../dist/admin-content-composition.js";
import { createTestBaseContentComposition } from "../dist/base-content-composition.js";
import { seedContentAuthoringFixtures } from "../../../packages/persistence-postgres/scripts/postgres-content-authoring-fixtures.mjs";
import { revokeAdminContentLocaleGrant } from "../../../packages/persistence-postgres/scripts/postgres-admin-content-fixtures.mjs";
import {
  seedJapaneseReviewer,
  installBaseReviewAuditFault,
  removeBaseReviewAuditFault,
  baseReviewCounts,
  seedElapsedBasePreview,
  seedShortBaseSession,
} from "./base-content-http-fixtures.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const origin = "https://admin.example.invalid";
const prefix = "/api/v1/admin/content-review";
const authoringPrefix = "/api/v1/admin/content-authoring";
const extensionPrefix = "/api/v1/admin/content";
const previewPrefix = "/api/v1/content-review-preview";
const tokenPepper = randomBytes(32).toString("hex");
const credentials = Object.fromEntries(
  [
    "editor",
    "reviewer",
    "denied",
    "no-mfa",
    "expired",
    "revoked",
    "ja-reviewer",
    "revocable",
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
const names = ["idol", "gift", "media", "homepage", "policy"];
const kinds = ["IDOL", "GIFT", "MEDIA_METADATA", "HOMEPAGE", "POLICY"];
const revisionColumns = {
  idol: "idol_revision_id",
  gift: "gift_revision_id",
  media: "media_metadata_revision_id",
  homepage: "homepage_revision_id",
  policy: "policy_revision_id",
};
const primaryFields = {
  IDOL: "displayName",
  GIFT: "title",
  MEDIA_METADATA: "alt",
  HOMEPAGE: "heroTitle",
  POLICY: "title",
};
let stage = "initialization";
let assertions = 0;
let requests = 0;
let failedAssertionLabel;
const operations = [];
const mintedTokens = [];
function check(value, label) {
  assertions++;
  if (!value) failedAssertionLabel = label;
  assert.ok(value, label);
}
function failureCode(value) {
  const failure = adminContentFailureSchema.safeParse(value);
  if (failure.success) return failure.data.code;
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
    baseContentTransactionManager: {
      runInBaseContentTransaction: (work) =>
        persistence.baseContentTransactionManager.runInBaseContentTransaction(
          async (repositories) => {
            const wrapped = {};
            for (const [port, methods] of Object.entries({
              authorization: ["authorize"],
              baseContentReviews: ["read", "append"],
              baseContentPreviews: ["issue", "read", "revoke"],
              idempotency: ["begin", "complete"],
            })) {
              wrapped[port] = {};
              for (const method of methods)
                wrapped[port][method] = async (...args) => {
                  try {
                    const result = await repositories[port][method](...args);
                    operations.push({
                      operation: `${port}.${method}`,
                      outcome:
                        result?.outcome === "SUCCESS" ? "SUCCESS" : "FAILURE",
                      ...(result?.outcome === "FAILURE"
                        ? { code: failureCode(result) }
                        : {}),
                    });
                    return result;
                  } catch (error) {
                    operations.push({
                      operation: `${port}.${method}`,
                      outcome: "THREW",
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
function unrelatedOwner(owner) {
  switch (owner.kind) {
    case "IDOL":
      return { kind: "IDOL", idolId: randomUUID() };
    case "GIFT":
      return { kind: "GIFT", giftId: randomUUID() };
    case "MEDIA_METADATA":
      return { kind: "MEDIA_METADATA", mediaAssetId: randomUUID() };
    case "POLICY":
      return { kind: "POLICY", policyKey: "wrong-owner" };
    case "HOMEPAGE":
      return { kind: "POLICY", policyKey: "wrong-owner" };
  }
}
function reviewBody(context, reasonCode = "HTTP_BASE_REVIEWED") {
  return {
    schemaVersion: 1,
    target: context.target,
    expectedVersion: context.audit.reviewSequence,
    expectedContentHash: context.audit.sourceHash,
    expectedSourceHash: context.currentEnglishSourceHash,
    reasonCode,
  };
}
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
    const compositions = [];
    const logs = [];
    try {
      stage = "normal-trigger fixtures";
      const fixtures = await seedContentAuthoringFixtures(observer, {
        sessions: Object.entries(credentials)
          .filter(([name]) => name !== "ja-reviewer")
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
      const japaneseReviewer = await seedJapaneseReviewer(observer, fixtures, {
        sessionTokenDigest: digest(
          "admin-session",
          credentials["ja-reviewer"].token,
        ),
        csrfTokenDigest: digest("admin-csrf", credentials["ja-reviewer"].csrf),
      });
      await runMigrations({
        clientConfig,
        workspaceRoot,
        command: { direction: "up" },
      });
      const publicationState = async () =>
        JSON.stringify(
          (
            await observer.query(
              "SELECT jsonb_agg(to_jsonb(p) ORDER BY id) AS value FROM content_publications p",
            )
          ).rows[0].value,
        );
      const publishedBefore = await publicationState();
      const options = {
        environment: "TEST",
        database: clientConfig,
        tokenPepper,
        allowedOrigin: origin,
      };
      const baseComposition = createTestBaseContentComposition(options, {
        createPersistence: diagnosticPersistence,
      });
      const authoring = createTestContentAuthoringComposition(options);
      const extensions = createTestAdminContentComposition(options);
      compositions.push(
        baseComposition.baseContentRuntime,
        authoring.contentAuthoringRuntime,
        extensions.adminContentRuntime,
      );
      app = await createApiApplication(environment(clientConfig), {
        logger: createStructuredLogger({
          service: "api",
          write: (line) => logs.push(line),
        }),
        ...baseComposition,
        ...authoring,
        ...extensions,
      });
      await app.listen(0, "127.0.0.1");
      const address = app.getHttpServer().address();
      check(
        address !== null && typeof address === "object",
        "base content HTTP binds loopback",
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
          raw = false,
          scope = prefix,
        } = {},
      ) {
        stage = `HTTP ${endpoint}`;
        operations.length = 0;
        const identity = credentials[actor];
        const headers = {
          origin,
          "content-type": "application/json",
          ...(scope === previewPrefix
            ? {}
            : {
                cookie: `__Host-fan-admin-session=${identity.token}`,
                "x-csrf-token": identity.csrf,
              }),
          ...(key ? { "idempotency-key": key } : {}),
          ...extraHeaders,
        };
        for (const [name, value] of Object.entries(headers))
          if (value === null) delete headers[name];
        const response = await globalThis.fetch(`${base}${scope}${endpoint}`, {
          method: "POST",
          headers,
          body: raw ? body : JSON.stringify(body),
          signal: globalThis.AbortSignal.timeout(30_000),
        });
        requests++;
        const text = await response.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          /* Only a safe status is reported below. */
        }
        const expected = Array.isArray(status) ? status : [status];
        if (!expected.includes(response.status))
          globalThis.console.error(
            `HTTP diagnostic ${JSON.stringify({ request: requests, endpoint, actor: Object.hasOwn(credentials, actor) ? actor : "UNKNOWN", kind: kinds.includes(body?.target?.owner?.kind) ? body.target.owner.kind : null, locale: SUPPORTED_LOCALES.includes(body?.target?.locale) ? body.target.locale : null, expected, actual: response.status, code: failureCode(json), operations })}`,
          );
        check(
          expected.includes(response.status),
          `${endpoint} returns expected HTTP status`,
        );
        check(
          response.headers.get("cache-control") === "private, no-store",
          "response is private no-store",
        );
        check(
          response.headers.get("x-robots-tag") === "noindex, nofollow",
          "response is noindex",
        );
        check(
          response.headers.get("referrer-policy") === "no-referrer",
          "response is no-referrer",
        );
        check(
          response.headers.get("access-control-allow-origin") === null,
          "response does not reflect CORS origin",
        );
        const secrets = [
          clientConfig.password,
          tokenPepper,
          ...Object.values(credentials).flatMap((value) => [
            value.token,
            value.csrf,
          ]),
        ];
        check(
          !secrets.some((secret) => text.includes(secret)),
          "response excludes credentials",
        );
        const schema =
          scope === authoringPrefix
            ? contentAuthoringResponseSchema
            : scope === extensionPrefix
              ? adminContentResponseSchema
              : scope === previewPrefix
                ? baseContentPreviewResponseSchema
                : baseContentResponseSchema;
        const parsed = schema.safeParse(json);
        check(parsed.success, "response matches frozen contract");
        if (
          parsed.data.outcome === "SUCCESS" &&
          parsed.data.kind === "PREVIEW_GRANT"
        )
          mintedTokens.push(parsed.data.token);
        else
          check(
            !mintedTokens.some((secret) => text.includes(secret)),
            "non-issuance response excludes preview tokens",
          );
        return parsed.data;
      }
      async function read(target, options = {}) {
        const result = await request(
          "/read",
          { schemaVersion: 1, target },
          options,
        );
        check(
          result.outcome === "SUCCESS" && result.kind === "REVIEW",
          "review read returns canonical localized content",
        );
        return result;
      }
      async function issue(target, { ttlSeconds = 300, ...options } = {}) {
        const result = await request(
          "/preview/issue",
          {
            schemaVersion: 1,
            target,
            ttlSeconds,
            reasonCode: "HTTP_BASE_PREVIEWED",
          },
          options,
        );
        check(
          result.outcome === "SUCCESS" && result.kind === "PREVIEW_GRANT",
          "scoped preview grants a token once",
        );
        return result;
      }
      const targetFor = (name, revisionId, locale = "ja") => ({
        owner: fixtures.targets[name],
        revisionId,
        locale,
      });
      const legacy = targetFor("idol", fixtures.approvedSourceRevisionIds.idol);
      const legacyRead = await read(legacy);
      await request("/submit", reviewBody(legacyRead.context), {
        status: 409,
        key: randomUUID(),
      });
      for (const [actor, status] of [
        ["denied", 403],
        ["no-mfa", 401],
        ["expired", 401],
        ["revoked", 401],
      ])
        await request(
          "/read",
          { schemaVersion: 1, target: legacy },
          { actor, status },
        );
      for (const [extraHeaders, status] of [
        [{ origin: null }, 403],
        [{ origin: "https://attacker.example.invalid" }, 403],
        [{ cookie: null }, 401],
        [{ "x-csrf-token": null }, 403],
        [{ "x-csrf-token": credentials.reviewer.csrf }, 403],
        [
          {
            cookie: `__Host-fan-admin-session=${credentials.editor.token}; __Host-fan-admin-session=${credentials.editor.token}`,
          },
          401,
        ],
      ])
        await request(
          "/read",
          { schemaVersion: 1, target: legacy },
          { extraHeaders, status },
        );
      for (const scope of [prefix, previewPrefix]) {
        await request("/read?token=URL_CANARY", {}, { scope, status: 400 });
        await request("/unknown", {}, { scope, status: 404 });
        await request("/read", "{broken", { scope, raw: true, status: 400 });
        await request("/read", "x".repeat(64 * 1024 + 1), {
          scope,
          raw: true,
          status: 413,
        });
      }
      for (const field of [
        "actorId",
        "requestId",
        "action",
        "sessionToken",
        "csrfToken",
        "createdAt",
      ])
        await request(
          "/read",
          {
            schemaVersion: 1,
            target: legacy,
            [field]: "CLIENT_AUTHORITY_CANARY",
          },
          { status: 400 },
        );
      const revisions = {};
      const previews = {};
      for (const name of names) {
        stage = `five-kind ${name}`;
        const content = globalThis.structuredClone(fixtures.content[name]);
        for (const translation of content.translations)
          translation.fields[primaryFields[content.kind]] =
            `${translation.locale} PRIVATE_BASE_${name.toUpperCase()}_CANARY`;
        const created = await request(
          "/create",
          {
            schemaVersion: 1,
            target: fixtures.targets[name],
            expectedVersion: fixtures.headVersions[name],
            reasonCode: "HTTP_BASE_AUTHORED",
            content,
          },
          { scope: authoringPrefix, key: randomUUID() },
        );
        check(
          created.outcome === "SUCCESS" && created.kind === "MUTATION",
          "authoring creates receipt-bound draft",
        );
        revisions[name] = created.resultId;
        const receipt = (
          await observer.query(
            `SELECT count(*)::int AS count FROM content_authoring_receipts WHERE ${revisionColumns[name]}=$1`,
            [created.resultId],
          )
        ).rows[0];
        check(
          receipt.count === 1,
          "HTTP draft has canonical authoring receipt",
        );
        for (const locale of SUPPORTED_LOCALES) {
          const target = targetFor(name, created.resultId, locale);
          const draft = await read(target);
          check(
            draft.context.audit.review.status === "DRAFT" &&
              draft.context.audit.reviewSequence === 1,
            "new translation starts in DRAFT sequence one",
          );
          check(
            draft.content.fields[primaryFields[content.kind]] ===
              `${locale} PRIVATE_BASE_${name.toUpperCase()}_CANARY`,
            "review returns selected locale",
          );
          check(
            draft.source.fields[primaryFields[content.kind]] ===
              `en PRIVATE_BASE_${name.toUpperCase()}_CANARY`,
            "review returns actual English source",
          );
          check(
            !Object.hasOwn(draft.content, "translations"),
            "review excludes other translation records",
          );
          if (locale === "ja") {
            const narrow = await read(target, { actor: "ja-reviewer" });
            check(
              narrow.source.kind === content.kind,
              "ja-only reviewer can compare actual English source",
            );
            await request(
              "/read",
              { schemaVersion: 1, target: { ...target, locale: "th" } },
              { actor: "ja-reviewer", status: 403 },
            );
            await request(
              "/read",
              {
                schemaVersion: 1,
                target: fixtures.targets[name],
                revisionId: created.resultId,
              },
              { scope: authoringPrefix, actor: "ja-reviewer", status: 403 },
            );
            await request(
              "/submit",
              { ...reviewBody(draft.context), expectedVersion: 9 },
              { key: randomUUID(), status: 409 },
            );
            await request(
              "/submit",
              {
                ...reviewBody(draft.context),
                expectedContentHash: "0".repeat(64),
              },
              { key: randomUUID(), status: 409 },
            );
            await request(
              "/submit",
              {
                ...reviewBody(draft.context),
                expectedSourceHash: "0".repeat(64),
              },
              { key: randomUUID(), status: 409 },
            );
          }
          const submitKey = randomUUID();
          await request("/submit", reviewBody(draft.context), {
            key: submitKey,
          });
          if (locale === "ja") {
            const replay = await request("/submit", reviewBody(draft.context), {
              key: submitKey,
            });
            check(
              replay.outcome === "SUCCESS" && replay.replayed,
              "review submission replays after state advances",
            );
            const conflict = await request(
              "/submit",
              {
                ...reviewBody(draft.context),
                reasonCode: "HTTP_BASE_DIFFERENT",
              },
              { key: submitKey, status: 409 },
            );
            check(
              conflict.code === "IDEMPOTENCY_CONFLICT",
              "different command under one key conflicts",
            );
          }
          const submitted = await read(target);
          check(
            submitted.context.audit.review.status === "IN_REVIEW" &&
              submitted.context.audit.reviewSequence === 2,
            "submit persists canonical sequence two",
          );
          if (locale === "ja") {
            const self = await request(
              "/approve",
              reviewBody(submitted.context),
              { key: randomUUID(), status: 403 },
            );
            check(
              self.code === "SELF_REVIEW",
              "translation and structure author cannot approve own draft",
            );
          }
          const approvalKey = randomUUID();
          await request("/approve", reviewBody(submitted.context), {
            actor: locale === "ja" ? "ja-reviewer" : "reviewer",
            key: approvalKey,
          });
          if (locale === "ja") {
            const replay = await request(
              "/approve",
              reviewBody(submitted.context),
              { actor: "ja-reviewer", key: approvalKey },
            );
            check(
              replay.outcome === "SUCCESS" && replay.replayed,
              "approval replay does not append duplicate review",
            );
          }
          const approved = await read(target);
          check(
            approved.context.audit.review.status === "APPROVED" &&
              approved.context.audit.reviewSequence === 3,
            "independent reviewer approves canonical sequence three",
          );
          const grant = await issue(target);
          const previewBody = { schemaVersion: 1, target, token: grant.token };
          const result = await request("/read", previewBody, {
            scope: previewPrefix,
          });
          check(
            result.outcome === "SUCCESS" &&
              result.content.kind === content.kind,
            "private preview preserves exact content kind",
          );
          check(
            result.content.fields[primaryFields[content.kind]] ===
              `${locale} PRIVATE_BASE_${name.toUpperCase()}_CANARY`,
            "preview contains only requested locale",
          );
          const serialized = JSON.stringify(result);
          for (const key of [
            "editorId",
            "structureEditorId",
            "reviewerId",
            "sourceHash",
            "translatedFromSourceHash",
            "objectKey",
            "sessionId",
            "translationAudits",
          ])
            check(
              !serialized.includes(`"${key}"`),
              "private preview excludes internal metadata",
            );
          if (locale === "ja") {
            previews[name] = previewBody;
            const wrongLocale = {
              ...previewBody,
              target: { ...target, locale: "th" },
            };
            const wrongRevision = {
              ...previewBody,
              target: { ...target, revisionId: randomUUID() },
            };
            const wrongOwner = unrelatedOwner(target.owner);
            for (const body of [
              wrongLocale,
              wrongRevision,
              { ...previewBody, target: { ...target, owner: wrongOwner } },
              { ...previewBody, token: randomBytes(32).toString("base64url") },
            ]) {
              const unavailable = await request("/read", body, {
                scope: previewPrefix,
                status: 404,
              });
              check(
                unavailable.code === "PREVIEW_UNAVAILABLE",
                "wrong token or target has indistinguishable failure",
              );
            }
            await request(
              "/preview/revoke",
              {
                schemaVersion: 1,
                grantId: grant.grantId,
                reasonCode: "HTTP_BASE_REVOKED",
              },
              { actor: "reviewer", key: randomUUID(), status: 404 },
            );
          }
        }
      }
      stage = "independent extension compatibility";
      const aliases = await request(
        "/drafts/read",
        {
          schemaVersion: 1,
          target: {
            schemaVersion: 1,
            kind: "IDOL_ALIASES",
            idolRevisionId: revisions.idol,
          },
        },
        { scope: extensionPrefix },
      );
      check(
        aliases.outcome === "SUCCESS" && aliases.kind === "DRAFT",
        "old extension read remains installed",
      );
      const extensionGrant = await request(
        "/preview/issue",
        {
          schemaVersion: 1,
          target: {
            kind: "IDOL_ALIASES",
            revisionId: revisions.idol,
            locale: "ja",
          },
          ttlSeconds: 300,
          reasonCode: "HTTP_EXTENSION_PREVIEW",
        },
        { scope: extensionPrefix },
      );
      await request(
        "/read",
        { ...previews.idol, token: extensionGrant.token },
        { scope: previewPrefix, status: 404 },
      );

      stage = "review fault rollback and concurrent approval";
      const snapshot = await request(
        "/read",
        {
          schemaVersion: 1,
          target: fixtures.targets.policy,
          revisionId: revisions.policy,
        },
        { scope: authoringPrefix },
      );
      const copied = await request(
        "/copy",
        {
          schemaVersion: 1,
          target: fixtures.targets.policy,
          sourceRevisionId: revisions.policy,
          expectedVersion: snapshot.snapshot.headVersion,
          expectedSourceHash: snapshot.snapshot.contentHash,
          reasonCode: "HTTP_BASE_COPY",
          changes: {
            kind: "POLICY",
            translations: [
              {
                locale: "ja",
                origin: "HUMAN",
                fields: {
                  ...fixtures.content.policy.translations.find(
                    (row) => row.locale === "ja",
                  ).fields,
                  title: "ja HTTP base review fault fixture",
                },
              },
            ],
          },
        },
        { scope: authoringPrefix, key: randomUUID() },
      );
      const atomicTarget = targetFor("policy", copied.resultId);
      const atomicRead = await read(atomicTarget);
      const atomicBody = reviewBody(atomicRead.context, "HTTP_BASE_ATOMICITY");
      const atomicKey = randomUUID();
      const before = await baseReviewCounts(observer);
      await installBaseReviewAuditFault(observer);
      try {
        const failed = await request("/submit", atomicBody, {
          key: atomicKey,
          status: 503,
        });
        check(
          failed.code === "CONTENT_UNAVAILABLE",
          "audit fault returns safe unavailable",
        );
        check(
          (await baseReviewCounts(observer)) === before,
          "failed HTTP review leaves no audit review receipt or idempotency partial rows",
        );
      } finally {
        await removeBaseReviewAuditFault(observer);
      }
      const recovered = await request("/submit", atomicBody, {
        key: atomicKey,
      });
      check(
        recovered.outcome === "SUCCESS" && !recovered.replayed,
        "same key commits after fault is removed",
      );
      const pending = await read(atomicTarget);
      const race = await Promise.allSettled(
        [randomUUID(), randomUUID()].map((key) =>
          request("/approve", reviewBody(pending.context), {
            actor: "reviewer",
            key,
            status: [200, 409],
          }),
        ),
      );
      check(
        race.every((value) => value.status === "fulfilled"),
        "both concurrent requests return safe expected responses",
      );
      const values = race.map((value) => value.value);
      check(
        values.filter((value) => value.outcome === "SUCCESS").length === 1 &&
          values.some(
            (value) =>
              value.outcome === "FAILURE" &&
              ["CONFLICT", "STALE_VERSION", "INVALID_REVIEW_STATE"].includes(
                value.code,
              ),
          ),
        "concurrent approval commits exactly one winner",
      );
      const raceRead = await read(atomicTarget);
      check(
        raceRead.context.audit.reviewSequence === 3 &&
          raceRead.context.audit.review.status === "APPROVED",
        "concurrent approval appends exactly one persisted event",
      );

      stage = "missing locale has no preview fallback";
      const mediaSnapshot = await request(
        "/read",
        {
          schemaVersion: 1,
          target: fixtures.targets.media,
          revisionId: revisions.media,
        },
        { scope: authoringPrefix },
      );
      const englishOnly = {
        ...fixtures.content.media,
        translations: fixtures.content.media.translations.filter(
          (row) => row.locale === "en",
        ),
      };
      const sparse = await request(
        "/create",
        {
          schemaVersion: 1,
          target: fixtures.targets.media,
          expectedVersion: mediaSnapshot.snapshot.headVersion,
          reasonCode: "HTTP_ENGLISH_ONLY",
          content: englishOnly,
        },
        { scope: authoringPrefix, key: randomUUID() },
      );
      const missingTarget = targetFor("media", sparse.resultId);
      await request(
        "/read",
        { schemaVersion: 1, target: missingTarget },
        { status: 404 },
      );
      await request(
        "/preview/issue",
        {
          schemaVersion: 1,
          target: missingTarget,
          ttlSeconds: 300,
          reasonCode: "HTTP_NO_FALLBACK",
        },
        { status: 404 },
      );
      const englishGrant = await issue({ ...missingTarget, locale: "en" });
      await request(
        "/read",
        { schemaVersion: 1, target: missingTarget, token: englishGrant.token },
        { scope: previewPrefix, status: 404 },
      );

      stage = "preview session lifetime clamp";
      credentials["short-lived"] = {
        token: randomBytes(32).toString("base64url"),
        csrf: randomBytes(32).toString("base64url"),
      };
      const shortSession = await seedShortBaseSession(observer, fixtures, {
        sessionTokenDigest: digest(
          "admin-session",
          credentials["short-lived"].token,
        ),
        csrfTokenDigest: digest("admin-csrf", credentials["short-lived"].csrf),
      });
      const subMillisecond = (
        await observer.query(
          "SELECT expires_at<>date_trunc('milliseconds',expires_at) AS precise FROM admin_sessions WHERE id=$1",
          [shortSession],
        )
      ).rows[0].precise;
      check(
        subMillisecond,
        "session expiry fixture deterministically includes nonzero microseconds",
      );
      const shortTarget = targetFor("media", revisions.media);
      const shortGrant = await issue(shortTarget, {
        actor: "short-lived",
        ttlSeconds: 60,
      });
      const clamped = (
        await observer.query(
          "SELECT g.expires_at=s.expires_at AS exact_bound,g.created_at>=s.created_at AS causal,g.expires_at<=g.created_at+interval '60 seconds' AS ttl_bound FROM base_content_preview_grants g JOIN admin_sessions s ON s.id=g.session_id WHERE g.id=$1",
          [shortGrant.grantId],
        )
      ).rows[0];
      check(
        clamped.exact_bound && clamped.causal && clamped.ttl_bound,
        "preview expires exactly at earlier session expiry without extending TTL",
      );
      const shortPreview = {
        schemaVersion: 1,
        target: shortTarget,
        token: shortGrant.token,
      };
      await request("/read", shortPreview, { scope: previewPrefix });
      let expired = false;
      for (let poll = 0; poll < 400; poll++) {
        expired = (
          await observer.query(
            "SELECT expires_at<=clock_timestamp() AS expired FROM admin_sessions WHERE id=$1",
            [shortSession],
          )
        ).rows[0].expired;
        if (expired) break;
        await setTimeout(100);
      }
      check(
        expired,
        "PostgreSQL clock confirms the real session expiry before assertion",
      );
      await request("/read", shortPreview, {
        scope: previewPrefix,
        status: 404,
      });

      stage = "exact-scope preview expiry and revocation";
      const target = targetFor("media", revisions.media);
      const grant = await issue(target);
      const requestBody = { schemaVersion: 1, target, token: grant.token };
      const revokeBody = {
        schemaVersion: 1,
        grantId: grant.grantId,
        reasonCode: "HTTP_BASE_REVOKED",
      };
      const revokeKey = randomUUID();
      await request("/preview/revoke", revokeBody, { key: revokeKey });
      const revokeReplay = await request("/preview/revoke", revokeBody, {
        key: revokeKey,
      });
      check(
        revokeReplay.outcome === "SUCCESS" && revokeReplay.replayed,
        "preview revocation replays",
      );
      const revokeAudit = (
        await observer.query(
          "SELECT g.revoked_at>=g.created_at AS causal,g.revoked_at=a.created_at AS exact FROM base_content_preview_grants g JOIN audit_logs a ON a.id=g.revoked_audit_log_id WHERE g.id=$1",
          [grant.grantId],
        )
      ).rows[0];
      check(
        revokeAudit.causal && revokeAudit.exact,
        "preview revoke preserves causal timestamp and exact audit",
      );
      await request("/read", requestBody, {
        scope: previewPrefix,
        status: 404,
      });
      const elapsedToken = randomBytes(32).toString("base64url");
      await seedElapsedBasePreview(observer, {
        sourceGrantId: grant.grantId,
        tokenDigest: digest("base-content-preview", elapsedToken),
      });
      mintedTokens.push(elapsedToken);
      await request(
        "/read",
        { ...requestBody, token: elapsedToken },
        { scope: previewPrefix, status: 404 },
      );
      const sessionGrant = await issue(target, { actor: "revocable" });
      await observer.query(
        "UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE id=$1",
        [fixtures.sessions.revocable],
      );
      await request(
        "/read",
        { ...requestBody, token: sessionGrant.token },
        { scope: previewPrefix, status: 404 },
      );
      const narrowGrant = await issue(target, { actor: "ja-reviewer" });
      await revokeAdminContentLocaleGrant(observer, {
        adminIdentityId: japaneseReviewer.identityId,
        locale: "ja",
        actorId: fixtures.editor,
      });
      await request(
        "/read",
        { ...requestBody, token: narrowGrant.token },
        { scope: previewPrefix, status: 404 },
      );
      const roleGrant = await issue(target, { actor: "reviewer" });
      await observer.query(
        "DELETE FROM admin_identity_roles WHERE admin_identity_id=$1",
        [fixtures.reviewer],
      );
      await request(
        "/read",
        { ...requestBody, token: roleGrant.token },
        { scope: previewPrefix, status: 404 },
      );
      await revokeAdminContentLocaleGrant(observer, {
        adminIdentityId: fixtures.editor,
        locale: "ja",
        actorId: fixtures.editor,
      });
      for (const name of names)
        await request("/read", previews[name], {
          scope: previewPrefix,
          status: 404,
        });
      stage = "public history and log privacy";
      check(
        (await publicationState()) === publishedBefore,
        "base review and private previews do not publish revisions",
      );
      const logged = logs.join("\n");
      const canaries = [
        tokenPepper,
        ...Object.values(credentials).flatMap((value) => [
          value.token,
          value.csrf,
        ]),
        ...mintedTokens,
        "URL_CANARY",
        "CLIENT_AUTHORITY_CANARY",
        ...names.map((name) => `PRIVATE_BASE_${name.toUpperCase()}_CANARY`),
      ];
      check(
        !canaries.some((value) => logged.includes(value)),
        "logs exclude credentials preview tokens and content canaries",
      );
      globalThis.console.log(
        `PASS base content PostgreSQL HTTP: ${assertions} assertions, ${requests} requests; five kinds, seven locales, scoped previews, audit rollback and concurrency; no publication or production login.`,
      );
    } finally {
      if (app) await app.close();
      await Promise.allSettled(compositions.map((runtime) => runtime.stop()));
      await observer.end();
    }
  });
} catch (error) {
  globalThis.console.error(
    `FAIL base content PostgreSQL HTTP ${JSON.stringify({ stage, assertion: failedAssertionLabel ?? null, ...(typeof error?.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code) ? { sqlstate: error.code } : {}) })}`,
  );
  process.exitCode = 1;
}
