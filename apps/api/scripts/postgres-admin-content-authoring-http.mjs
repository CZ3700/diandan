#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { digestAdminContentToken } from "@fan-support/application";
import {
  adminContentFailureSchema,
  adminContentResponseSchema,
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
import { seedContentAuthoringFixtures } from "../../../packages/persistence-postgres/scripts/postgres-content-authoring-fixtures.mjs";
import { revokeAdminContentLocaleGrant } from "../../../packages/persistence-postgres/scripts/postgres-admin-content-fixtures.mjs";

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
const kinds = ["IDOL", "GIFT", "MEDIA_METADATA", "HOMEPAGE", "POLICY"];
const names = ["idol", "gift", "media", "homepage", "policy"];
const fields = {
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
function check(value, label) {
  assertions++;
  if (!value) failedAssertionLabel = label;
  assert.ok(value, label);
}
function failureCode(value) {
  const parsed = adminContentFailureSchema.safeParse(value);
  if (parsed.success) return parsed.data.code;
  const transaction = persistenceTransactionFailureSchema.safeParse(value);
  if (transaction.success) return transaction.data.error.code;
  const port = persistencePortResponseSchema.safeParse(value);
  if (port.success && port.data.outcome === "FAILURE")
    return port.data.error.code;
  return "UNKNOWN_FAILURE";
}
function diagnosticPersistence(config) {
  const persistence = createPostgresPersistence(config);
  return {
    close: () => persistence.close(),
    contentAuthoringTransactionManager: {
      runInContentAuthoringTransaction: (work) =>
        persistence.contentAuthoringTransactionManager.runInContentAuthoringTransaction(
          async (repositories) => {
            const wrapped = {};
            for (const [port, methods] of Object.entries({
              authorization: ["authorize"],
              contentAuthoring: ["read", "write"],
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
function mutationBody(target, expectedVersion, content) {
  return {
    schemaVersion: 1,
    target,
    expectedVersion,
    reasonCode: "HTTP_AUTHORING_CREATED",
    content,
  };
}
function copyBody(
  snapshot,
  expectedVersion,
  changes = { kind: snapshot.target.kind },
) {
  return {
    schemaVersion: 1,
    target: snapshot.target,
    expectedVersion,
    reasonCode: "HTTP_AUTHORING_COPIED",
    sourceRevisionId: snapshot.revisionId,
    expectedSourceHash: snapshot.contentHash,
    changes,
  };
}
function changedTranslation(snapshot, locale) {
  const original = snapshot.content.translations.find(
    (row) => row.locale === locale,
  );
  check(original !== undefined, "fixture has selected translation");
  return {
    kind: snapshot.target.kind,
    translations: [
      {
        ...original,
        origin: "HUMAN",
        fields: {
          ...original.fields,
          [fields[snapshot.target.kind]]: `${locale} HTTP edit`,
        },
      },
    ],
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
    let extensions;
    const logs = [];
    try {
      stage = "normal-trigger five-kind fixture";
      const fixtures = await seedContentAuthoringFixtures(observer, {
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
        command: { direction: "up", targetVersion: "0018" },
      });
      const publishedBefore = JSON.stringify(
        (
          await observer.query(
            "SELECT jsonb_agg(to_jsonb(p) ORDER BY id) AS value FROM content_publications p",
          )
        ).rows[0].value,
      );
      stage = "real API composition";
      const options = {
        environment: "TEST",
        database: clientConfig,
        tokenPepper,
        allowedOrigin: origin,
      };
      composition = createTestContentAuthoringComposition(options, {
        createPersistence: diagnosticPersistence,
      });
      extensions = createTestAdminContentComposition(options);
      app = await createApiApplication(environment(clientConfig), {
        logger: createStructuredLogger({
          service: "api",
          write: (line) => logs.push(line),
        }),
        ...composition,
        ...extensions,
      });
      await app.listen(0, "127.0.0.1");
      const address = app.getHttpServer().address();
      check(
        address !== null && typeof address === "object",
        "authoring HTTP listener binds loopback",
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
          prefix = "/api/v1/admin/content-authoring",
        } = {},
      ) {
        stage = `HTTP ${endpoint}`;
        operations.length = 0;
        const identity = credentials[actor];
        const headers = {
          origin,
          "content-type": "application/json",
          cookie: `__Host-fan-admin-session=${identity.token}`,
          "x-csrf-token": identity.csrf,
          ...(key ? { "idempotency-key": key } : {}),
          ...extraHeaders,
        };
        for (const [name, value] of Object.entries(headers))
          if (value === null) delete headers[name];
        const response = await globalThis.fetch(`${base}${prefix}${endpoint}`, {
          method: "POST",
          headers,
          body: raw ? body : JSON.stringify(body),
          signal: globalThis.AbortSignal.timeout(30_000),
        });
        requests++;
        const text = await response.text();
        const expectedStatuses = Array.isArray(status) ? status : [status];
        if (!expectedStatuses.includes(response.status)) {
          let code = "INVALID_RESPONSE";
          try {
            code = failureCode(JSON.parse(text));
          } catch {
            /* Only allowlisted diagnostics are emitted. */
          }
          globalThis.console.error(
            `HTTP diagnostic ${JSON.stringify({ request: requests, endpoint, actor: Object.hasOwn(credentials, actor) ? actor : "UNKNOWN", kind: kinds.includes(body?.target?.kind) ? body.target.kind : null, expectedStatuses, actualStatus: response.status, code, operations })}`,
          );
        }
        check(
          expectedStatuses.includes(response.status),
          `${endpoint} returned expected HTTP status`,
        );
        check(
          response.headers.get("cache-control") === "private, no-store",
          "authoring response is private no-store",
        );
        check(
          response.headers.get("x-robots-tag") === "noindex, nofollow",
          "authoring response is noindex",
        );
        check(
          response.headers.get("referrer-policy") === "no-referrer",
          "authoring response is no-referrer",
        );
        check(
          response.headers.get("access-control-allow-origin") === null,
          "authoring response does not reflect CORS origin",
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
          "authoring response excludes credentials",
        );
        const parsed = (
          prefix === "/api/v1/admin/content"
            ? adminContentResponseSchema
            : contentAuthoringResponseSchema
        ).safeParse(JSON.parse(text));
        check(parsed.success, "authoring response matches frozen contract");
        return parsed.data;
      }
      async function readSnapshot(target, revisionId, options = {}) {
        const response = await request(
          "/read",
          { schemaVersion: 1, target, revisionId },
          options,
        );
        check(
          response.outcome === "SUCCESS" && response.kind === "REVISION",
          "READ returns a canonical revision",
        );
        return response.snapshot;
      }
      const initialRead = {
        schemaVersion: 1,
        target: fixtures.targets.idol,
        revisionId: fixtures.approvedSourceRevisionIds.idol,
      };
      for (const [actor, status] of [
        ["denied", 403],
        ["no-mfa", 401],
        ["expired", 401],
        ["revoked", 401],
      ])
        await request("/read", initialRead, { actor, status });
      for (const [extraHeaders, status] of [
        [{ cookie: null }, 401],
        [{ origin: null }, 403],
        [{ origin: "https://attacker.example.invalid" }, 403],
        [{ "x-csrf-token": credentials.reviewer.csrf }, 403],
      ])
        await request("/read", initialRead, { extraHeaders, status });
      await request(
        "/read",
        { ...initialRead, actorId: fixtures.reviewer },
        { status: 400 },
      );
      await request("/read?token=AUTHORING_URL_CANARY", initialRead, {
        status: 400,
      });
      await request("/read", "{", { status: 400, raw: true });
      await request("/unknown", {}, { status: 404 });
      await request(
        "/unknown",
        {},
        { status: 404, prefix: "/api/v1/admin/content" },
      );
      await request(
        "/read",
        { ...initialRead, revisionId: randomUUID() },
        { status: 404 },
      );

      const current = {};
      const created = {};
      const approvedSources = {};
      for (const name of names) {
        stage = `five-kind ${name}`;
        const target = fixtures.targets[name];
        const approved = await readSnapshot(
          target,
          fixtures.approvedSourceRevisionIds[name],
        );
        approvedSources[name] = approved;
        check(
          approved.translationAudits.length === SUPPORTED_LOCALES.length &&
            approved.translationAudits.every(
              (row) => row.review.status === "APPROVED",
            ),
          "source fixture contains seven approved translations",
        );
        const copied = await request(
          "/copy",
          copyBody(approved, fixtures.headVersions[name]),
          { key: randomUUID() },
        );
        check(
          copied.outcome === "SUCCESS" && copied.kind === "MUTATION",
          "unchanged COPY returns reference",
        );
        const inherited = await readSnapshot(target, copied.resultId);
        check(
          inherited.lifecycle.status === "DRAFT" &&
            inherited.revisionNumber === fixtures.headVersions[name] + 1,
          "copy appends new draft at next revision",
        );
        check(
          inherited.translationAudits.every(
            (row) =>
              row.review.status === "APPROVED" &&
              row.inheritedFrom?.revisionId === approved.revisionId,
          ),
          "unchanged human approvals retain exact inherited proof",
        );
        const translated = await request(
          "/copy",
          copyBody(
            inherited,
            inherited.headVersion,
            changedTranslation(inherited, "ja"),
          ),
          { key: randomUUID() },
        );
        const japanese = await readSnapshot(target, translated.resultId);
        check(
          japanese.translationAudits.find((row) => row.locale === "ja")?.review
            .status === "DRAFT",
          "edited Japanese translation loses approval",
        );
        check(
          japanese.translationAudits
            .filter((row) => row.locale !== "ja")
            .every((row) => row.review.status === "APPROVED"),
          "other unchanged approvals remain inherited",
        );
        const englishEdited = await request(
          "/copy",
          copyBody(
            japanese,
            japanese.headVersion,
            changedTranslation(japanese, "en"),
          ),
          { key: randomUUID() },
        );
        const english = await readSnapshot(target, englishEdited.resultId);
        check(
          english.translationAudits.every(
            (row) => row.review.status === "DRAFT",
          ),
          "changed English source invalidates every inherited approval",
        );
        const body = mutationBody(
          target,
          english.headVersion,
          fixtures.content[name],
        );
        const key = randomUUID();
        const result = await request("/create", body, { key });
        const snapshot = await readSnapshot(target, result.resultId);
        check(
          snapshot.translationAudits.length === 7 &&
            snapshot.translationAudits.every(
              (row) => row.review.status === "DRAFT",
            ),
          "CREATE records all supplied locales as drafts",
        );
        check(
          snapshot.createdBy === fixtures.editor &&
            snapshot.translationAudits.every(
              (row) => row.editorId === fixtures.editor,
            ),
          "actor is canonical session identity",
        );
        const replay = await request("/create", body, { key });
        check(
          replay.outcome === "SUCCESS" &&
            replay.replayed &&
            replay.resultId === result.resultId,
          "same mutation key replays original result",
        );
        await request(
          "/create",
          { ...body, reasonCode: "HTTP_CHANGED_BODY" },
          { key, status: 409 },
        );
        await request("/copy", copyBody(snapshot, snapshot.headVersion - 1), {
          key: randomUUID(),
          status: 409,
        });
        await request(
          "/copy",
          {
            ...copyBody(snapshot, snapshot.headVersion),
            expectedSourceHash: "0".repeat(64),
          },
          { key: randomUUID(), status: 409 },
        );
        created[name] = snapshot;
        current[name] = snapshot;
      }

      stage = "copy structured extension content";
      for (const name of ["idol", "gift"]) {
        const original = current[name];
        const draftTarget =
          name === "idol"
            ? {
                schemaVersion: 1,
                kind: "IDOL_ALIASES",
                idolRevisionId: original.revisionId,
              }
            : {
                schemaVersion: 1,
                kind: "GIFT_DETAILS",
                giftRevisionId: original.revisionId,
              };
        const prefix = "/api/v1/admin/content";
        const draftRead = { schemaVersion: 1, target: draftTarget };
        const reviewBody = (context) => ({
          schemaVersion: 1,
          target: context.target,
          expectedVersion: context.sequence,
          expectedContentHash: context.contentHash,
          expectedSourceHash: context.sourceHash,
          reasonCode: "HTTP_EXTENSION_REVIEWED",
        });
        const drafts = await request("/drafts/read", draftRead, { prefix });
        check(
          drafts.outcome === "SUCCESS" && drafts.kind === "DRAFT",
          "authoring extensions are available through existing review API",
        );
        for (const context of drafts.reviews)
          await request("/reviews/submit", reviewBody(context), {
            prefix,
            key: randomUUID(),
          });
        const submitted = await request("/drafts/read", draftRead, { prefix });
        for (const context of submitted.reviews)
          await request("/reviews/approve", reviewBody(context), {
            prefix,
            actor: "reviewer",
            key: randomUUID(),
          });
        const source = await readSnapshot(original.target, original.revisionId);
        const result = await request(
          "/copy",
          copyBody(source, source.headVersion),
          { key: randomUUID() },
        );
        const snapshot = await readSnapshot(source.target, result.resultId);
        if (name === "idol") {
          check(
            source.extensions.aliases !== undefined &&
              snapshot.extensions.aliases !== undefined,
            "alias extension copied with idol authoring revision",
          );
          check(
            source.extensions.aliases.id !== snapshot.extensions.aliases.id &&
              snapshot.extensions.aliases.idolRevisionId ===
                snapshot.revisionId,
            "alias copy creates exact new revision binding",
          );
          check(
            JSON.stringify(snapshot.content.aliases) ===
              JSON.stringify(source.content.aliases),
            "alias content survives copy",
          );
          check(
            source.extensions.aliases.review.status === "APPROVED" &&
              snapshot.extensions.aliases.review.status === "DRAFT",
            "copied aliases reset approval while preserving approved source",
          );
          check(
            snapshot.extensions.aliases.editorId === fixtures.editor,
            "copied alias editor is current actor",
          );
        } else {
          check(
            source.extensions.details !== undefined &&
              snapshot.extensions.details !== undefined,
            "gift detail extension copied with gift revision",
          );
          check(
            source.extensions.details.document.id !==
              snapshot.extensions.details.document.id &&
              snapshot.extensions.details.document.giftRevisionId ===
                snapshot.revisionId,
            "detail copy creates exact new revision binding",
          );
          check(
            JSON.stringify(snapshot.content.details) ===
              JSON.stringify(source.content.details),
            "gift detail blocks and all languages survive copy",
          );
          check(
            source.extensions.details.translations.every(
              (row) => row.review.status === "APPROVED",
            ) &&
              snapshot.extensions.details.translations.every(
                (row) =>
                  row.review.status === "DRAFT" &&
                  row.editorId === fixtures.editor,
              ),
            "copied gift details reset every approval and bind current editor",
          );
        }
        current[name] = snapshot;
      }

      stage = "deterministic complete authoring rollback";
      const atomicSource = approvedSources.policy;
      const atomicBody = {
        ...copyBody(atomicSource, current.policy.headVersion),
        reasonCode: "HTTP_AUTHORING_ATOMICITY",
      };
      const atomicKey = randomUUID();
      async function atomicCounts() {
        return (
          await observer.query(`SELECT
          (SELECT count(*) FROM policy_revisions)::int AS revisions,
          (SELECT count(*) FROM policy_revision_translations)::int AS translations,
          (SELECT count(*) FROM policy_translation_reviews)::int AS reviews,
          (SELECT count(*) FROM policy_translation_copy_evidence)::int AS evidence,
          (SELECT count(*) FROM content_authoring_receipts)::int AS receipts,
          (SELECT count(*) FROM audit_logs)::int AS audits,
          (SELECT count(*) FROM idempotency_records)::int AS reservations`)
        ).rows[0];
      }
      const beforeFailure = JSON.stringify(await atomicCounts());
      await observer.query(
        "CREATE FUNCTION public.reject_http_authoring_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason_code='HTTP_AUTHORING_ATOMICITY' THEN RAISE EXCEPTION 'fixture authoring audit unavailable' USING ERRCODE='P0001'; END IF; RETURN NEW; END; $$",
      );
      await observer.query(
        "CREATE TRIGGER reject_http_authoring_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.reject_http_authoring_audit()",
      );
      try {
        const failed = await request("/copy", atomicBody, {
          key: atomicKey,
          status: 503,
        });
        check(
          failed.outcome === "FAILURE" && failed.code === "CONTENT_UNAVAILABLE",
          "audit failure becomes safe HTTP unavailable",
        );
        check(
          JSON.stringify(await atomicCounts()) === beforeFailure,
          "failed authoring command leaves no revision, translation, review, copy evidence, receipt, audit or idempotency rows",
        );
      } finally {
        await observer.query(
          "DROP TRIGGER reject_http_authoring_audit ON public.audit_logs",
        );
        await observer.query(
          "DROP FUNCTION public.reject_http_authoring_audit()",
        );
      }
      const recovered = await request("/copy", atomicBody, { key: atomicKey });
      check(
        recovered.outcome === "SUCCESS" && !recovered.replayed,
        "same idempotency key succeeds after audit service recovers",
      );
      current.policy = await readSnapshot(
        atomicSource.target,
        recovered.resultId,
      );

      stage = "concurrent owner version lock";
      const raceSource = current.media;
      const beforeRace = (
        await observer.query(
          "SELECT count(*)::int AS count FROM media_metadata_revisions WHERE media_asset_id=$1",
          [raceSource.target.mediaAssetId],
        )
      ).rows[0].count;
      const raceResults = await Promise.allSettled(
        [randomUUID(), randomUUID()].map((key) =>
          request("/copy", copyBody(raceSource, raceSource.headVersion), {
            key,
            status: [200, 409],
          }),
        ),
      );
      check(
        raceResults.every((result) => result.status === "fulfilled"),
        "all concurrent copy requests return safe expected statuses",
      );
      const race = raceResults.map((result) => result.value);
      check(
        race.filter((result) => result.outcome === "SUCCESS").length === 1 &&
          race.some(
            (result) =>
              result.outcome === "FAILURE" &&
              ["STALE_VERSION", "CONFLICT"].includes(result.code),
          ),
        "concurrent copies commit exactly one new owner version",
      );
      const afterRace = (
        await observer.query(
          "SELECT count(*)::int AS count FROM media_metadata_revisions WHERE media_asset_id=$1",
          [raceSource.target.mediaAssetId],
        )
      ).rows[0].count;
      check(
        afterRace === beforeRace + 1,
        "concurrent HTTP conflict leaves exactly one persisted revision",
      );

      stage = "locale and role authorization";
      await request(
        "/create",
        mutationBody(
          current.policy.target,
          current.policy.headVersion,
          fixtures.content.policy,
        ),
        { key: randomUUID(), actor: "reviewer", status: 403 },
      );
      await revokeAdminContentLocaleGrant(observer, {
        adminIdentityId: fixtures.editor,
        actorId: fixtures.editor,
        locale: "ja",
      });
      await request(
        "/read",
        {
          schemaVersion: 1,
          target: current.idol.target,
          revisionId: current.idol.revisionId,
        },
        { status: 403 },
      );
      await request("/copy", copyBody(current.idol, current.idol.headVersion), {
        key: randomUUID(),
        status: 403,
      });
      await readSnapshot(current.policy.target, current.policy.revisionId, {
        actor: "reviewer",
      });
      stage = "public history and diagnostic privacy";
      const publishedAfter = JSON.stringify(
        (
          await observer.query(
            "SELECT jsonb_agg(to_jsonb(p) ORDER BY id) AS value FROM content_publications p",
          )
        ).rows[0].value,
      );
      check(
        publishedAfter === publishedBefore,
        "draft authoring never changes public publication history",
      );
      const logged = logs.join("\n");
      check(
        ![
          tokenPepper,
          clientConfig.password,
          "AUTHORING_URL_CANARY",
          ...Object.values(credentials).flatMap((value) => [
            value.token,
            value.csrf,
          ]),
          ...Object.values(created).flatMap((snapshot) =>
            snapshot.content.translations.map(
              (row) => row.fields[fields[snapshot.target.kind]],
            ),
          ),
        ].some((secret) => logged.includes(secret)),
        "structured logs exclude credentials and authoring content",
      );
      globalThis.console.log(
        `PASS content authoring HTTP: ${assertions} assertions, ${requests} real requests`,
      );
    } finally {
      if (app) await app.close();
      else {
        await composition?.contentAuthoringRuntime.stop();
        await extensions?.adminContentRuntime.stop();
      }
      await observer.end();
    }
  });
} catch (error) {
  globalThis.console.error(
    `FAIL content authoring HTTP at ${stage}; ${error instanceof assert.AssertionError ? (failedAssertionLabel ?? "safe assertion failed") : "safe integration failure"}`,
  );
  process.exitCode = 1;
}
