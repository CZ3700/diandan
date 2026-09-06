#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { digestAdminContentToken } from "@fan-support/application";
import {
  SUPPORTED_LOCALES,
  adminContentFailureSchema,
  adminContentResponseSchema,
  adminResourceResponseSchema,
  baseContentResponseSchema,
  contentAuthoringResponseSchema,
  publicationPreflightResponseSchema,
} from "@fan-support/contracts";
import { createStructuredLogger } from "@fan-support/observability";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "@fan-support/persistence-postgres";
import { createApiApplication } from "../dist/bootstrap.js";
import { createTestPublicationPreflightComposition } from "../dist/publication-preflight-composition.js";
import { createTestContentAuthoringComposition } from "../dist/content-authoring-composition.js";
import { createTestBaseContentComposition } from "../dist/base-content-composition.js";
import { createTestAdminContentComposition } from "../dist/admin-content-composition.js";
import { createTestResourceManagementComposition } from "../dist/resource-management-composition.js";
import { seedPublicationPreflightFixtures } from "../../../packages/persistence-postgres/scripts/postgres-publication-preflight-fixtures.mjs";
import { revokeAdminContentLocaleGrant } from "../../../packages/persistence-postgres/scripts/postgres-admin-content-fixtures.mjs";
import { seedJapaneseReviewer } from "./base-content-http-fixtures.mjs";
import {
  preflightBusinessState,
  unrelatedPreflightOwner,
  preflightEnvironment,
  firstReferencedMediaAsset,
} from "./publication-preflight-http-fixtures.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const origin = "https://admin.example.invalid";
const endpoint = "/api/v1/admin/content/publication/preflight";
const authoring = "/api/v1/admin/content-authoring";
const review = "/api/v1/admin/content-review";
const extensions = "/api/v1/admin/content";
const resources = "/api/v1/admin/resources";
const names = ["idol", "gift", "media", "homepage", "policy"];
const primaryFields = {
  IDOL: "displayName",
  GIFT: "title",
  MEDIA_METADATA: "alt",
  HOMEPAGE: "heroTitle",
  POLICY: "title",
};
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
  requests = 0;
let failedAssertionLabel;
let scenario = "initialization";
let lastIssues = [];
function check(condition, label) {
  assertions++;
  if (!condition) failedAssertionLabel = label;
  assert.ok(condition, label);
}
function safeFailure(value) {
  const parsed = adminContentFailureSchema.safeParse(value);
  return parsed.success ? parsed.data.code : "UNKNOWN_FAILURE";
}
function schemaFor(route) {
  if (route === endpoint || route.startsWith(endpoint + "?"))
    return publicationPreflightResponseSchema;
  if (route.startsWith(authoring + "/")) return contentAuthoringResponseSchema;
  if (route.startsWith(review + "/")) return baseContentResponseSchema;
  if (route.startsWith(resources + "/")) return adminResourceResponseSchema;
  return adminContentResponseSchema;
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
    const persistence = createPostgresPersistence(clientConfig);
    const runtimes = [],
      logs = [];
    let app,
      mediaCalls = 0;
    try {
      stage = "normal-trigger approved fixtures";
      const fixtures = await seedPublicationPreflightFixtures(
        observer,
        persistence,
        {
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
        },
      );
      await seedJapaneseReviewer(observer, fixtures, {
        sessionTokenDigest: digest(
          "admin-session",
          credentials["ja-reviewer"].token,
        ),
        csrfTokenDigest: digest("admin-csrf", credentials["ja-reviewer"].csrf),
      });
      await runMigrations({
        clientConfig,
        workspaceRoot,
        command: { direction: "up", targetVersion: "0018" },
      });
      const options = {
        environment: "TEST",
        database: clientConfig,
        tokenPepper,
        allowedOrigin: origin,
      };
      const unexpectedMedia = async () => {
        mediaCalls++;
        throw new Error("UNEXPECTED_MEDIA_OPERATION");
      };
      const compositions = [
        createTestPublicationPreflightComposition(options),
        createTestContentAuthoringComposition(options),
        createTestBaseContentComposition(options),
        createTestAdminContentComposition(options),
        createTestResourceManagementComposition({
          ...options,
          storage: {
            createUploadGrant: unexpectedMedia,
            inspectObject: unexpectedMedia,
            createDownloadGrant: unexpectedMedia,
            deleteObject: unexpectedMedia,
            resolvePublicUrl: unexpectedMedia,
          },
          inspector: { inspect: unexpectedMedia },
        }),
      ];
      for (const composition of compositions)
        for (const [key, runtime] of Object.entries(composition))
          if (key.endsWith("Runtime")) runtimes.push(runtime);
      app = await createApiApplication(preflightEnvironment(clientConfig), {
        ...Object.assign({}, ...compositions),
        logger: createStructuredLogger({
          service: "api",
          write: (line) => logs.push(line),
        }),
      });
      await app.listen(0, "127.0.0.1");
      const address = app.getHttpServer().address();
      check(
        address !== null && typeof address === "object",
        "preflight binds loopback",
      );
      const base = `http://127.0.0.1:${address.port}`;
      const secrets = [
        clientConfig.password,
        tokenPepper,
        ...Object.values(credentials).flatMap((value) => [
          value.token,
          value.csrf,
        ]),
      ];
      async function request(
        route,
        body,
        {
          actor = "editor",
          status = 200,
          key,
          extraHeaders = {},
          raw = false,
          method = "POST",
        } = {},
      ) {
        stage = `HTTP ${route.split("?")[0]}`;
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
        const response = await globalThis.fetch(base + route, {
          method,
          headers,
          ...(method === "POST"
            ? { body: raw ? body : JSON.stringify(body) }
            : {}),
          signal: globalThis.AbortSignal.timeout(30_000),
        });
        requests++;
        const text = await response.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          /* Allowlisted diagnostics only. */
        }
        if (response.status !== status)
          globalThis.console.error(
            `HTTP diagnostic ${JSON.stringify({ request: requests, expected: status, actual: response.status, code: safeFailure(json) })}`,
          );
        check(response.status === status, "expected HTTP status");
        check(
          response.headers.get("cache-control") === "private, no-store",
          "private no-store response",
        );
        check(
          response.headers.get("x-robots-tag") === "noindex, nofollow",
          "noindex response",
        );
        check(
          response.headers.get("referrer-policy") === "no-referrer",
          "no-referrer response",
        );
        check(
          response.headers.get("access-control-allow-origin") === null,
          "no reflected CORS authority",
        );
        check(
          !secrets.some((secret) => text.includes(secret)),
          "response omits all credentials",
        );
        const parsed = schemaFor(route).safeParse(json);
        check(parsed.success, "response conforms to strict schema");
        return parsed.data;
      }
      async function preflight(
        name,
        revisionId = fixtures.revisions[name],
        options = {},
      ) {
        const before = await preflightBusinessState(observer);
        const result = await request(
          endpoint,
          {
            schemaVersion: 1,
            target: { owner: fixtures.targets[name], revisionId },
            action: "PUBLISH",
            ...options.command,
          },
          options,
        );
        check(
          before === (await preflightBusinessState(observer)),
          "preflight preserves all heads, lifecycle, publications, outbox, reviews, audits and idempotency",
        );
        if (result.outcome === "SUCCESS") {
          lastIssues = result.issues
            .map(({ code, locale }) => ({
              code,
              ...(locale ? { locale } : {}),
            }))
            .slice(0, 24);
          check(
            result.kind === "PUBLICATION_PREFLIGHT",
            "canonical report kind",
          );
          check(
            result.target.revisionId === revisionId &&
              result.target.owner.kind === fixtures.targets[name].kind,
            "report binds selected revision",
          );
          check(
            result.headVersion === fixtures.publicationHeadVersions[name],
            "report has canonical publication head version",
          );
          check(
            result.ready ===
              !result.issues.some((issue) => issue.severity === "BLOCKER"),
            "readiness agrees with blockers",
          );
        }
        return result;
      }
      function blocked(result, code, locale) {
        check(
          result.outcome === "SUCCESS" && !result.ready,
          "invalid content returns a blocked report, not an infrastructure failure",
        );
        check(
          result.issues.some(
            (issue) =>
              issue.code === code &&
              (locale === undefined || issue.locale === locale),
          ),
          "report includes the expected blocker and locale",
        );
      }
      async function readSnapshot(name, revisionId = fixtures.revisions[name]) {
        const result = await request(authoring + "/read", {
          schemaVersion: 1,
          target: fixtures.targets[name],
          revisionId,
        });
        check(
          result.outcome === "SUCCESS" && result.kind === "REVISION",
          "authoring read returns canonical snapshot",
        );
        return result.snapshot;
      }
      async function copy(name, changes) {
        const source = await readSnapshot(name);
        const result = await request(
          authoring + "/copy",
          {
            schemaVersion: 1,
            target: fixtures.targets[name],
            expectedVersion: source.headVersion,
            sourceRevisionId: source.revisionId,
            expectedSourceHash: source.contentHash,
            changes,
            reasonCode: "HTTP_PREFLIGHT_COPY",
          },
          { key: randomUUID() },
        );
        check(
          result.outcome === "SUCCESS" && result.kind === "MUTATION",
          "HTTP COPY creates a new immutable draft",
        );
        return result.resultId;
      }
      async function reviewTarget(
        target,
        action,
        { actor = "editor", status = 200 } = {},
      ) {
        const read = await request(review + "/read", {
          schemaVersion: 1,
          target,
        });
        check(
          read.outcome === "SUCCESS" && read.kind === "REVIEW",
          "review endpoint loads canonical target",
        );
        return request(
          review + "/" + action,
          {
            schemaVersion: 1,
            target,
            expectedVersion: read.context.audit.reviewSequence,
            expectedContentHash: read.context.audit.sourceHash,
            expectedSourceHash: read.context.currentEnglishSourceHash,
            reasonCode: "HTTP_PREFLIGHT_REVIEW",
          },
          { key: randomUUID(), actor, status },
        );
      }

      const approved = {};
      const currentApproved = { ...fixtures.revisions };
      for (const name of names) {
        scenario = `approved-${name}`;
        stage = `approved ${name}`;
        approved[name] = await preflight(name);
        check(
          approved[name].outcome === "SUCCESS" && approved[name].ready,
          "all seven approved base and extension languages pass",
        );
        const snapshot = await readSnapshot(name);
        check(
          snapshot.translationAudits.length === SUPPORTED_LOCALES.length &&
            snapshot.translationAudits.every(
              (value) => value.review.status === "APPROVED",
            ),
          "approved fixture has exactly seven canonical human-reviewed translations",
        );
        const repeat = await preflight(name, undefined, {
          actor: "reviewer",
        });
        check(
          repeat.contentHash === approved[name].contentHash,
          "read-only reviewer receives the same content hash",
        );
        blocked(
          await preflight(name, undefined, { command: { action: "ROLLBACK" } }),
          "ROLLBACK_TARGET_INVALID",
        );
        for (const revisionId of [randomUUID(), fixtures.revisions[name]]) {
          const value = await request(
            endpoint,
            {
              schemaVersion: 1,
              action: "PUBLISH",
              target: {
                owner:
                  revisionId === fixtures.revisions[name]
                    ? unrelatedPreflightOwner(fixtures.targets[name])
                    : fixtures.targets[name],
                revisionId,
              },
            },
            { status: 404 },
          );
          check(
            value.code === "NOT_FOUND",
            "unknown or mismatched owner/revision is unavailable",
          );
        }
      }
      // CREATE accepts actual English plus 0-6 translations. Missing English is rejected before storage.
      for (const name of names) {
        const source = await readSnapshot(name);
        for (const locale of SUPPORTED_LOCALES) {
          scenario = `missing-${name}-${locale}`;
          const current = await readSnapshot(name);
          const content = {
            ...source.content,
            translations: source.content.translations.filter(
              (row) => row.locale !== locale,
            ),
          };
          const created = await request(
            authoring + "/create",
            {
              schemaVersion: 1,
              target: fixtures.targets[name],
              expectedVersion: current.headVersion,
              content,
              reasonCode: "HTTP_PREFLIGHT_MISSING",
            },
            { key: randomUUID(), status: locale === "en" ? 400 : 200 },
          );
          if (locale === "en") {
            check(
              created.code === "INVALID_COMMAND",
              "actual English cannot be omitted at authoring input",
            );
            continue;
          }
          blocked(
            await preflight(name, created.resultId),
            "TRANSLATION_MISSING",
            locale,
          );
        }
        const english = source.content.translations.find(
          (row) => row.locale === "en",
        );
        scenario = `stale-${name}`;
        const field = primaryFields[source.content.kind];
        const changedEnglish = {
          ...english,
          fields: { ...english.fields, [field]: "Revised fixture source" },
        };
        const staleId = await copy(name, {
          kind: source.content.kind,
          translations: [changedEnglish],
        });
        const stale = await preflight(name, staleId);
        for (const locale of SUPPORTED_LOCALES.filter(
          (value) => value !== "en",
        ))
          blocked(stale, "TRANSLATION_STALE", locale);
        const target = {
          owner: fixtures.targets[name],
          revisionId: staleId,
          locale: "en",
        };
        await reviewTarget(target, "submit");
        const selfReview = await reviewTarget(target, "approve", {
          status: 403,
        });
        check(
          selfReview.code === "SELF_REVIEW",
          "author cannot approve edited English",
        );
        check(
          !(await preflight(name, staleId)).ready,
          "rejected self review cannot make preflight ready",
        );
      }

      for (const name of ["idol", "gift"]) {
        scenario = `extensions-${name}`;
        const revisionId = await copy(name, {
          kind: fixtures.targets[name].kind,
        });
        blocked(await preflight(name, revisionId), "EXTENSION_NOT_APPROVED");
        const targets =
          name === "idol"
            ? [{ kind: "IDOL_ALIASES", revisionId }]
            : SUPPORTED_LOCALES.map((locale) => ({
                kind: "GIFT_DETAILS",
                revisionId,
                locale,
              }));
        for (const target of targets) {
          for (const action of ["submit", "approve"]) {
            const value = await request(extensions + "/reviews/read", {
              schemaVersion: 1,
              target,
            });
            check(
              value.outcome === "SUCCESS" && value.kind === "REVIEW",
              "extension review loads canonical independent evidence",
            );
            const body = {
              schemaVersion: 1,
              target,
              expectedVersion: value.context.sequence,
              expectedContentHash: value.context.contentHash,
              expectedSourceHash: value.context.sourceHash,
              reasonCode: "HTTP_PREFLIGHT_EXTENSION",
            };
            if (action === "approve") {
              const denied = await request(
                extensions + "/reviews/approve",
                body,
                { key: randomUUID(), status: 403 },
              );
              check(
                denied.code === "SELF_REVIEW",
                "extension structure author cannot approve the copied extension",
              );
            }
            await request(extensions + "/reviews/" + action, body, {
              key: randomUUID(),
              actor: action === "approve" ? "reviewer" : "editor",
            });
          }
        }
        check(
          (await preflight(name, revisionId)).ready,
          "independent approval makes only the copied extension eligible",
        );
        currentApproved[name] = revisionId;
      }
      for (const name of ["media", "homepage"]) {
        scenario = `inherited-${name}`;
        const revisionId = await copy(name, {
          kind: fixtures.targets[name].kind,
        });
        const result = await preflight(name, revisionId);
        check(
          result.ready,
          "exact unchanged COPY retains independently approved base evidence",
        );
        currentApproved[name] = revisionId;
      }

      for (const name of ["idol", "gift", "media", "homepage"]) {
        scenario = `rights-${name}`;
        const snapshot = await readSnapshot(name, currentApproved[name]);
        const assetId = firstReferencedMediaAsset(snapshot);
        const media = await request(resources + "/media/read", {
          schemaVersion: 1,
          assetId,
        });
        const body = {
          schemaVersion: 1,
          assetId,
          expectedVersion: media.media.rightsVersion,
          rightsStatus: "REJECTED",
          evidenceReference: "rights:preflight-fixture-revoked",
          reasonCode: "HTTP_PREFLIGHT_RIGHTS",
        };
        await request(resources + "/media/rights", body, {
          key: randomUUID(),
        });
        const invalid = await preflight(name, currentApproved[name]);
        check(
          !invalid.ready &&
            invalid.issues.some((issue) => issue.code.includes("RIGHTS")),
          "actual rights revocation blocks affected content",
        );
        await request(
          resources + "/media/rights",
          {
            ...body,
            expectedVersion: body.expectedVersion + 1,
            rightsStatus: "APPROVED",
            evidenceReference: "rights:preflight-fixture-restored",
          },
          { key: randomUUID() },
        );
        check(
          (await preflight(name, currentApproved[name])).ready,
          "restored independent rights allows the unchanged approved revision",
        );
      }

      scenario = "authorization";
      for (const [actor, status, code] of [
        ["denied", 403, "FORBIDDEN"],
        ["ja-reviewer", 403, "FORBIDDEN"],
        ["no-mfa", 401, "UNAUTHENTICATED"],
        ["expired", 401, "UNAUTHENTICATED"],
        ["revoked", 401, "UNAUTHENTICATED"],
      ]) {
        const result = await preflight("idol", undefined, { actor, status });
        check(
          result.code === code,
          "canonical session, MFA and all-locale permission required",
        );
      }
      for (const [extraHeaders, status] of [
        [{ origin: null }, 403],
        [{ origin: "https://wrong.example.invalid" }, 403],
        [{ "x-csrf-token": null }, 403],
        [{ "x-csrf-token": credentials.denied.csrf }, 403],
        [{ cookie: null }, 401],
        [
          {
            cookie: `__Host-fan-admin-session=${credentials.editor.token}; __Host-fan-admin-session=${credentials.editor.token}`,
          },
          401,
        ],
      ])
        await preflight("idol", undefined, { extraHeaders, status });
      const body = {
        schemaVersion: 1,
        target: {
          owner: fixtures.targets.idol,
          revisionId: fixtures.revisions.idol,
        },
        action: "PUBLISH",
      };
      for (const key of [
        "candidate",
        "actorId",
        "requestId",
        "evaluatedAt",
        "ready",
        "manifest",
        "idempotencyKey",
      ])
        await request(
          endpoint,
          { ...body, [key]: "FORGED_AUTHORITY_CANARY" },
          { status: 400 },
        );
      await request(endpoint + "?token=URL_CANARY", body, { status: 400 });
      await request(endpoint, "{broken", { raw: true, status: 400 });
      await request(endpoint, "x".repeat(64 * 1024 + 1), {
        raw: true,
        status: 413,
      });
      await request(endpoint, body, { method: "GET", status: 404 });
      await revokeAdminContentLocaleGrant(observer, {
        adminIdentityId: fixtures.reviewer,
        locale: "ja",
        actorId: fixtures.editor,
      });
      check(
        (
          await preflight("idol", undefined, {
            actor: "reviewer",
            status: 403,
          })
        ).code === "FORBIDDEN",
        "later locale revocation immediately invalidates a previously successful check",
      );
      await observer.query(
        "DELETE FROM admin_identity_roles WHERE admin_identity_id=$1",
        [fixtures.editor],
      );
      check(
        (await preflight("idol", undefined, { status: 403 })).code ===
          "FORBIDDEN",
        "later role revocation blocks the same preflight command",
      );
      check(
        mediaCalls === 0,
        "preflight and rights checks need no storage or image network calls",
      );
      check(
        !secrets.some((secret) => logs.join("\n").includes(secret)),
        "observability omits all live synthetic credentials",
      );
      check(
        ![
          "FORGED_AUTHORITY_CANARY",
          "URL_CANARY",
          "Revised fixture source",
        ].some((value) => logs.join("\n").includes(value)),
        "observability omits request contents and query values",
      );
      globalThis.console.log(
        `PASS publication preflight HTTP (${assertions} assertions, ${requests} requests); actual PostgreSQL, five kinds, all seven locales, immutable checks, independent review, extensions, rights and current authorization`,
      );
    } finally {
      if (app) await app.close();
      await Promise.allSettled(runtimes.map((runtime) => runtime.stop()));
      await persistence.close();
      await observer.end();
    }
  });
} catch {
  globalThis.console.error(
    `FAIL publication preflight HTTP at ${stage}; scenario=${scenario}${failedAssertionLabel ? `; assertion=${failedAssertionLabel}` : ""}; issues=${JSON.stringify(lastIssues)}`,
  );
  process.exitCode = 1;
}
