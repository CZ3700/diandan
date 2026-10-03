#!/usr/bin/env node
import {
  assertPublicGetCaching,
  verifyPublicGetConditional,
} from "./public-get-revalidation.mjs";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client, Pool } from "pg";
import {
  digestAdminContentToken,
  createPublicationPurgeUseCases,
} from "@fan-support/application";
import {
  SUPPORTED_LOCALES,
  publicationRuntimeResponseSchema,
  publishedContentResponseSchema,
  publicationPreflightResponseSchema,
  contentAuthoringResponseSchema,
  baseContentResponseSchema,
  adminContentResponseSchema,
  adminResourceResponseSchema,
  adminContentFailureSchema,
  persistenceTransactionFailureSchema,
} from "@fan-support/contracts";
import { compareBaseContentTime } from "../../../packages/application/dist/base-content-time.js";
import { createStructuredLogger } from "@fan-support/observability";
import {
  runMigrations,
  withEphemeralPostgres,
} from "@fan-support/persistence-postgres";
import { createPostgresPersistenceWithPoolFactory } from "../../../packages/persistence-postgres/dist/postgres-persistence.js";
import { createApiApplication } from "../dist/bootstrap.js";
import { createTestPublicationRuntimeComposition } from "../dist/testing/publication-runtime-composition.js";
import { createTestPublicationPreflightComposition } from "../dist/testing/publication-preflight-composition.js";
import { createTestContentAuthoringComposition } from "../dist/testing/content-authoring-composition.js";
import { createTestBaseContentComposition } from "../dist/testing/base-content-composition.js";
import { createTestAdminContentComposition } from "../dist/testing/admin-content-composition.js";
import { createPublicationPurgeWorkerRuntime } from "../../worker/dist/publication-purge-runtime.js";
import { seedPublicationRuntimeFixtures } from "../../../packages/persistence-postgres/scripts/postgres-publication-runtime-fixtures.mjs";
import {
  revokeAdminContentLocaleGrant,
  grantAdminContentLocale,
} from "../../../packages/persistence-postgres/scripts/postgres-admin-content-fixtures.mjs";
import {
  preflightEnvironment,
  preflightBusinessState,
} from "./publication-preflight-http-fixtures.mjs";
import { createTestResourceManagementComposition } from "../dist/testing/resource-management-composition.js";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
import {
  createPublicationMediaFixture,
  publicationMediaEnvironment,
  verifyPublicationMedia,
} from "./publication-runtime-http-media.mjs";
import { withIndependentPublicationMedia } from "./publication-runtime-http-fixtures.mjs";
import { createPublicationHttpCache } from "./publication-runtime-http-cache.mjs";
import { publicationSessionDiagnostic } from "./publication-runtime-http-session-diagnostic.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const origin = "https://admin.example.invalid";
const prefix = "/api/v1/admin/content/publication";
const authoring = "/api/v1/admin/content-authoring";
const review = "/api/v1/admin/content-review";
const extensions = "/api/v1/admin/content";
const names = ["media", "idol", "gift", "homepage", "policy"];
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
let stage = "initialization",
  assertions = 0,
  requests = 0,
  failedLabel;
function check(value, label) {
  assertions++;
  if (!value) failedLabel = label;
  assert.ok(value, label);
}
function schemaFor(route) {
  if (route === prefix + "/preflight")
    return publicationPreflightResponseSchema;
  if (route.startsWith(prefix + "/")) return publicationRuntimeResponseSchema;
  if (route.startsWith(authoring + "/")) return contentAuthoringResponseSchema;
  if (route.startsWith(review + "/")) return baseContentResponseSchema;
  if (route.startsWith("/api/v1/admin/resources/"))
    return adminResourceResponseSchema;
  if (route.startsWith(extensions + "/")) return adminContentResponseSchema;
  return publishedContentResponseSchema;
}
async function verify(clientConfig, s3) {
  await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up", targetVersion: "0017" },
  });
  const observer = new Client(clientConfig);
  await observer.connect();
  // Failure-only diagnostics retain fixed phases and codes, never SQL, parameters or provider data.
  const purgeDiagnostics = [];
  const probePurgeClock = process.env.PUBLICATION_PURGE_CLOCK_PROBE === "1";
  let purgeClockProbeQueries = 0;
  const notePurge = (value) => {
    purgeDiagnostics.push(value);
    if (purgeDiagnostics.length > 12) purgeDiagnostics.shift();
  };
  const guardCodes = new Map([
    [
      "purge identity is immutable and transitions require one causal version",
      "CAUSAL_VERSION",
    ],
    ["purge claims require a due job and bounded fresh lease", "CLAIM_WINDOW"],
    ["purge results require a current unexpired claim", "RESULT_LEASE"],
    [
      "purge completion requires the same provider reference",
      "PROVIDER_REFERENCE",
    ],
    ["pending provider work must remain submitted", "PENDING_STATE"],
    [
      "publication action requires its current active MFA session",
      "PUBLICATION_SESSION_TIME",
    ],
    [
      "publication action requires current publish permission",
      "PUBLICATION_PERMISSION",
    ],
    [
      "publication action requires all seven current locale scopes",
      "PUBLICATION_LOCALES",
    ],
  ]);
  const createObservedPersistence = (database, options) =>
    createPostgresPersistenceWithPoolFactory(database, options, (config) => {
      const pool = new Pool(config);
      return {
        async connect() {
          const connection = await pool.connect();
          let pendingPublicationReceipt;
          return {
            async query(sql, values) {
              const sqlText = typeof sql === "string" ? sql : sql.text;
              // Test-only earlier clock observation: the following UPDATE and all actual guards
              // still use the unchanged database clock. This never alters a system clock or lease.
              const priorClockObservation =
                (probePurgeClock || purgeClockProbeQueries < 2) &&
                sqlText.startsWith(
                  "SELECT gen_random_uuid() AS id,gen_random_uuid() AS token,",
                ) &&
                sqlText.includes(" AS expired");
              const statementText = priorClockObservation
                ? sqlText.replace(
                    "GREATEST(clock_timestamp(),",
                    "GREATEST((clock_timestamp()+interval '2 seconds'),",
                  )
                : sqlText;
              const statement =
                statementText === sqlText
                  ? sql
                  : typeof sql === "string"
                    ? statementText
                    : { ...sql, text: statementText };
              if (priorClockObservation) purgeClockProbeQueries++;
              try {
                if (sqlText === "COMMIT" && pendingPublicationReceipt)
                  notePurge({
                    phase: "PUBLICATION_SESSION_BEFORE_COMMIT",
                    ...(await publicationSessionDiagnostic(
                      connection,
                      pendingPublicationReceipt,
                    )),
                  });
                const result = await connection.query(statement, values);
                if (
                  sqlText.startsWith(
                    "INSERT INTO public.content_publication_receipts(",
                  )
                )
                  pendingPublicationReceipt = (values ?? sql.values)?.[0];
                if (
                  sqlText.startsWith("BEGIN") ||
                  sqlText === "COMMIT" ||
                  sqlText === "ROLLBACK"
                )
                  pendingPublicationReceipt = undefined;
                return result;
              } catch (error) {
                const phase = sqlText.includes("content_purge_jobs")
                  ? "JOB_SQL"
                  : sqlText.includes("content_purge_attempts")
                    ? "ATTEMPT_SQL"
                    : sqlText === "COMMIT"
                      ? "COMMIT"
                      : "OTHER_SQL";
                notePurge({
                  phase,
                  sqlstate:
                    typeof error?.code === "string" &&
                    /^[A-Z0-9]{5}$/u.test(error.code)
                      ? error.code
                      : "NONE",
                  guard: guardCodes.get(error?.message) ?? "UNCLASSIFIED",
                });
                throw error;
              }
            },
            release: (destroy) => connection.release(destroy),
          };
        },
        end: () => pool.end(),
        on: (event, listener) => pool.on(event, listener),
        off: (event, listener) => pool.off(event, listener),
      };
    });
  const persistence = createObservedPersistence(clientConfig, {
    catalogPublicMediaBaseUrl: "https://media.example.invalid",
  });
  const createObservedRuntimePersistence = (database, options) => {
    const runtimePersistence = createObservedPersistence(database, options);
    return {
      ...runtimePersistence,
      publicationRuntimeTransactionManager: {
        async runInPublicationRuntimeTransaction(work) {
          let phase = "BEGIN";
          try {
            return await runtimePersistence.publicationRuntimeTransactionManager.runInPublicationRuntimeTransaction(
              (repositories) => {
                let authority;
                return work(
                  Object.fromEntries(
                    Object.entries(repositories).map(([name, repository]) => [
                      name,
                      Object.fromEntries(
                        Object.entries(repository).map(([method, call]) => [
                          method,
                          async (command) => {
                            phase = `${name}.${method}`;
                            const result = await call(command);
                            const diagnostic = {
                              phase,
                              outcome: result.outcome,
                            };
                            if (result.outcome === "FAILURE")
                              diagnostic.code =
                                result.code ?? result.error?.code;
                            if (
                              name === "authorization" &&
                              result.outcome === "SUCCESS"
                            )
                              authority = result.principal;
                            if (
                              name === "publicationRuntime" &&
                              method === "load" &&
                              result.outcome === "SUCCESS" &&
                              authority
                            ) {
                              diagnostic.evaluationAfterAuthorization =
                                compareBaseContentTime(
                                  result.context.preflight.evaluatedAt,
                                  authority.authorizedAt,
                                ) >= 0;
                              diagnostic.evaluationBeforeExpiry =
                                compareBaseContentTime(
                                  result.context.preflight.evaluatedAt,
                                  authority.expiresAt,
                                ) < 0;
                            }
                            notePurge(diagnostic);
                            return result;
                          },
                        ]),
                      ),
                    ]),
                  ),
                );
              },
            );
          } catch (error) {
            const application = adminContentFailureSchema.safeParse(
              error?.failure,
            );
            const transaction = persistenceTransactionFailureSchema.safeParse(
              error?.failure,
            );
            notePurge({
              phase,
              outcome: "THREW",
              code: application.success
                ? application.data.code
                : transaction.success
                  ? transaction.data.error.code
                  : "OTHER",
              schemaFailure: Array.isArray(error?.issues),
            });
            throw error;
          }
        },
      },
    };
  };
  let app, cache, worker;
  const runtimes = [],
    logs = [];
  try {
    stage = "normal-trigger historical fixtures";
    const resourceCreatedAt = (
      await observer.query(
        "SELECT to_char((clock_timestamp()-interval '10 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at",
      )
    ).rows[0].at;
    let fixtures = await seedPublicationRuntimeFixtures(observer, persistence, {
      resourceCreatedAt,
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
    fixtures = await withIndependentPublicationMedia(
      observer,
      persistence,
      fixtures,
    );
    stage = "upgrade publication constraints";
    await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up" },
    });
    const unrelatedEvents = (
      await observer.query(
        "SELECT id FROM public.outbox_events WHERE event_type <> 'CONTENT_PUBLICATION_CHANGED' ORDER BY id",
      )
    ).rows.map((row) => row.id);
    check(
      unrelatedEvents.length > 0,
      "fixture contains normal unrelated price-book outbox events",
    );
    const unrelatedState = async () =>
      JSON.stringify(
        (
          await observer.query(
            "SELECT (SELECT md5(jsonb_agg(to_jsonb(event) ORDER BY id)::text) FROM public.outbox_events event WHERE id=ANY($1::uuid[])) AS events,(SELECT count(*) FROM public.outbox_dispatch_attempts WHERE outbox_event_id=ANY($1::uuid[])) AS dispatch_attempts",
            [unrelatedEvents],
          )
        ).rows,
      );
    const unrelatedBefore = await unrelatedState();
    const options = {
      environment: "TEST",
      database: clientConfig,
      tokenPepper,
      allowedOrigin: origin,
      publicMediaBaseUrl: "https://media.example.invalid",
    };
    const media = createPublicationMediaFixture(s3);
    const runtimeEnvironment = publicationMediaEnvironment(
      preflightEnvironment(clientConfig),
      s3,
    );
    const compositions = [
      createTestResourceManagementComposition({ ...options, ...media }),
      createTestPublicationRuntimeComposition(options, {
        createPersistence: createObservedRuntimePersistence,
      }),
      createTestPublicationPreflightComposition(options),
      createTestContentAuthoringComposition(options),
      createTestBaseContentComposition(options),
      createTestAdminContentComposition(options),
    ];
    for (const composition of compositions)
      for (const [key, runtime] of Object.entries(composition))
        if (key.endsWith("Runtime") || key.endsWith("Lifecycle"))
          runtimes.push(runtime);
    app = await createApiApplication(runtimeEnvironment, {
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
      "API binds loopback",
    );
    const base = `http://127.0.0.1:${address.port}`;
    const secrets = [
      clientConfig.password,
      s3.secretAccessKey,
      tokenPepper,
      ...Object.values(credentials).flatMap((value) => [
        value.token,
        value.csrf,
      ]),
    ].filter(Boolean);
    const verifiedCacheScopes = new Set();
    async function request(
      route,
      body,
      {
        actor = "editor",
        status = 200,
        key,
        extraHeaders = {},
        method = "POST",
        raw = false,
      } = {},
    ) {
      stage = `HTTP ${route.split("?")[0]}`;
      const privateRoute = route.includes("/admin/");
      const headers = privateRoute
        ? {
            origin,
            "content-type": "application/json",
            cookie: `__Host-fan-admin-session=${credentials[actor].token}`,
            "x-csrf-token": credentials[actor].csrf,
            ...(key ? { "idempotency-key": key } : {}),
            ...extraHeaders,
          }
        : extraHeaders;
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
        /* Safe status only. */
      }
      const parsed = schemaFor(route.split("?")[0]).safeParse(json);
      const expected = Array.isArray(status) ? status : [status];
      if (!expected.includes(response.status)) {
        console.error(
          `HTTP publication diagnostic ${JSON.stringify({ request: requests, expected, actual: response.status, code: parsed.success && parsed.data.outcome === "FAILURE" ? parsed.data.code : "UNKNOWN", issues: parsed.success && parsed.data.code === "PUBLICATION_BLOCKED" ? parsed.data.issues.map(({ code }) => code) : [] })}`,
        );
        console.error(
          `PUBLICATION_SQL_DIAGNOSTIC ${JSON.stringify(purgeDiagnostics)}`,
        );
      }
      check(expected.includes(response.status), "expected HTTP status");
      const publicGet = method === "GET" && !privateRoute;
      const hasCredentials = Object.keys(headers).some((name) =>
        ["cookie", "authorization"].includes(name.toLowerCase()),
      );
      if (publicGet && !hasCredentials && parsed.success) {
        assertPublicGetCaching(response, parsed.data, check);
        const resource = route.split("?")[0].split("/").slice(0, 4).join("/");
        if (
          response.status === 200 &&
          parsed.data.outcome === "SUCCESS" &&
          !verifiedCacheScopes.has(resource)
        ) {
          await verifyPublicGetConditional({
            base,
            route,
            response,
            schema: schemaFor(route.split("?")[0]),
            check,
          });
          requests += 3;
          verifiedCacheScopes.add(resource);
        }
      } else {
        check(
          response.headers.get("cache-control") ===
            (privateRoute || (publicGet && hasCredentials)
              ? "private, no-store"
              : "no-store"),
          "non-public, credential-bearing and failed responses retain exact no-store policy",
        );
        check(
          response.headers.get("etag") === null,
          "non-public and credential-bearing responses never receive ETags",
        );
      }
      check(
        response.headers.get("x-robots-tag") === "noindex, nofollow",
        "noindex response",
      );
      check(
        response.headers.get("referrer-policy") === "no-referrer",
        "no-referrer response",
      );
      check(response.headers.get("set-cookie") === null, "no session issuance");
      check(
        !secrets.some((secret) => text.includes(secret)),
        "responses omit credentials",
      );
      check(parsed.success, "strict response contract");
      return { ...parsed.data, httpStatus: response.status };
    }
    const targets = Object.fromEntries(
      names.map((name) => [
        name,
        { owner: fixtures.targets[name], revisionId: fixtures.revisions[name] },
      ]),
    );
    const handles = (
      await observer.query(
        "SELECT (SELECT handle FROM public.idols WHERE id=$1) AS idol,(SELECT handle FROM public.gifts WHERE id=$2) AS gift",
        [fixtures.targets.idol.idolId, fixtures.targets.gift.giftId],
      )
    ).rows[0];
    const routes = {
      idol: `/api/v1/idols/${handles.idol}`,
      gift: `/api/v1/gifts/${handles.gift}`,
      media: `/api/v1/media/${fixtures.targets.media.mediaAssetId}`,
      homepage: "/api/v1/homepage",
      policy: `/api/v1/policies/${fixtures.targets.policy.policyKey}`,
    };
    async function preflight(target, action = "PUBLISH") {
      return request(prefix + "/preflight", {
        schemaVersion: 1,
        target,
        action,
      });
    }
    async function readSnapshot(target) {
      const value = await request(authoring + "/read", {
        schemaVersion: 1,
        target: target.owner,
        revisionId: target.revisionId,
      });
      check(value.kind === "REVISION", "authoring canonical snapshot");
      return value.snapshot;
    }
    async function status(publicationId, options) {
      return request(
        prefix + "/status",
        { schemaVersion: 1, publicationId },
        options,
      );
    }
    const mutationReplays = [];
    async function publish(target, reasonCode = "HTTP_PUBLICATION") {
      const readiness = await preflight(target);
      check(readiness.ready, "canonical seven-language preflight ready");
      const command = {
        schemaVersion: 1,
        target,
        expectedVersion: readiness.headVersion,
        expectedContentHash: readiness.contentHash,
        reasonCode,
      };
      const validated = await request(prefix + "/validate", command, {
        key: randomUUID(),
      });
      check(
        validated.action === "VALIDATE" &&
          validated.publicationId === null &&
          validated.headVersion === command.expectedVersion,
        "validate changes lifecycle without publication or head advance",
      );
      const validatedRead = await preflight(target);
      check(
        validatedRead.contentHash === validated.contentHash,
        "VALIDATE result hash exactly matches the canonical persisted snapshot",
      );
      const publishBody = {
        ...command,
        expectedContentHash: validated.contentHash,
      };
      let key = randomUUID();
      if (reasonCode === "HTTP_PUBLICATION_ATOMICITY") {
        const businessState = async () =>
          (await preflightBusinessState(observer)) +
          JSON.stringify(
            (
              await observer.query(
                "SELECT (SELECT count(*) FROM content_publication_manifests) AS manifests,(SELECT count(*) FROM content_publication_receipts) AS receipts,(SELECT count(*) FROM content_purge_jobs) AS jobs,(SELECT count(*) FROM content_purge_attempts) AS attempts",
              )
            ).rows,
          );
        const before = await businessState();
        await observer.query(
          "CREATE FUNCTION http_publication_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason_code='HTTP_PUBLICATION_ATOMICITY' THEN RAISE EXCEPTION 'synthetic publication audit fault' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$",
        );
        await observer.query(
          "CREATE TRIGGER http_publication_audit_fault BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION http_publication_audit_fault()",
        );
        try {
          const failed = await request(prefix + "/publish", publishBody, {
            key,
            status: 503,
          });
          check(
            failed.code === "CONTENT_UNAVAILABLE",
            "publication audit fault returns safe unavailable",
          );
          check(
            before === (await businessState()),
            "publication audit failure rolls back head, lifecycle, manifest, receipt, search, outbox and idempotency",
          );
        } finally {
          await observer.query(
            "DROP TRIGGER http_publication_audit_fault ON audit_logs",
          );
          await observer.query("DROP FUNCTION http_publication_audit_fault()");
        }
      }
      let result;
      if (reasonCode === "HTTP_PUBLICATION_RACE") {
        const keys = [key, randomUUID()];
        const outcomes = await Promise.all(
          keys.map((candidate) =>
            request(prefix + "/publish", publishBody, {
              key: candidate,
              status: [200, 409],
            }),
          ),
        );
        if (outcomes.filter((value) => value.httpStatus === 200).length !== 1)
          console.error(
            `Publication race diagnostic ${JSON.stringify(outcomes.map((value) => ({ status: value.httpStatus, code: value.outcome === "FAILURE" ? value.code : "SUCCESS", issues: value.code === "PUBLICATION_BLOCKED" ? value.issues.map(({ code }) => code) : [] })))}`,
          );
        check(
          outcomes.filter((value) => value.httpStatus === 200).length === 1 &&
            outcomes.filter((value) => value.httpStatus === 409).length === 1,
          "concurrent publishers commit exactly one head and reject the other with conflict",
        );
        const winner = outcomes.findIndex((value) => value.httpStatus === 200);
        key = keys[winner];
        result = outcomes[winner];
      } else result = await request(prefix + "/publish", publishBody, { key });
      check(
        result.action === "PUBLISH" &&
          result.headVersion === command.expectedVersion + 1,
        "publish advances exactly one current head",
      );
      const replay = await request(prefix + "/publish", publishBody, { key });
      check(
        replay.replayed &&
          replay.resultId === result.resultId &&
          replay.publicationId === result.publicationId,
        "same key replays immutable publication receipt",
      );
      await request(
        prefix + "/publish",
        { ...publishBody, reasonCode: "HTTP_DIFFERENT_BODY" },
        { key, status: 409 },
      );
      await request(prefix + "/publish", publishBody, {
        key: randomUUID(),
        status: 409,
      });
      const current = await status(result.publicationId);
      check(
        current.isCurrent &&
          current.jobs.length === 7 &&
          SUPPORTED_LOCALES.every(
            (locale) =>
              current.jobs.filter(
                (job) => job.locale === locale && job.generation === 1,
              ).length === 1,
          ),
        "publication exposes exactly seven initial locale purge jobs",
      );
      const purgePlans = (
        await observer.query(
          "SELECT locale,paths FROM public.content_purge_jobs WHERE publication_id=$1",
          [result.publicationId],
        )
      ).rows;
      check(
        purgePlans.length === 7 &&
          purgePlans.every(
            (plan) =>
              plan.paths.includes(`/${plan.locale}/sitemap.xml`) &&
              plan.paths.includes(`/${plan.locale}/sitemap.xml*`) &&
              plan.paths.includes("/sitemap.xml*") &&
              plan.paths.includes("/api/v1/storefront-seo/*") &&
              plan.paths.every(
                (path) =>
                  path === "/sitemap.xml*" ||
                  path === "/api/v1/storefront-seo/*" ||
                  path === `/${plan.locale}` ||
                  path.startsWith(`/${plan.locale}/`),
              ),
          ),
        "every initial purge plan requires both sitemap variants and global SEO paths; all remaining paths stay within its assigned locale namespace",
      );
      const ledger = await observer.query(
        "SELECT proof_version FROM public.content_publications WHERE id=$1",
        [result.publicationId],
      );
      check(
        ledger.rows[0]?.proof_version === 2,
        "new publication stores proof version two",
      );
      mutationReplays.push({
        body: publishBody,
        key,
        resultId: result.resultId,
      });
      return result;
    }
    async function readPublic(name, expectedPublication) {
      for (const locale of SUPPORTED_LOCALES) {
        const value = await request(
          routes[name] + `?locale=${locale}`,
          undefined,
          { method: "GET" },
        );
        check(
          value.kind === "PUBLISHED_CONTENT" &&
            value.publication.id === expectedPublication,
          "public GET reads current publication only",
        );
        const context =
          value.content.kind === "MEDIA_METADATA"
            ? value.content.localeContext
            : value.content.view.localeContext;
        check(
          context.requestedLocale === locale &&
            context.resolvedLocale === locale &&
            !context.fallbackUsed,
          "public read binds exact locale without fallback",
        );
      }
    }
    stage = "legacy public heads are not promoted implicitly";
    for (const route of Object.values(routes))
      await request(route + "?locale=en", undefined, {
        method: "GET",
        status: 404,
      });
    const initial = await preflight(targets.idol);
    const authBody = {
      schemaVersion: 1,
      target: targets.idol,
      expectedVersion: initial.headVersion,
      expectedContentHash: initial.contentHash,
      reasonCode: "HTTP_AUTHORITY",
    };
    const unchanged = await preflightBusinessState(observer);
    for (const [actor, expected] of [
      ["reviewer", 403],
      ["denied", 403],
      ["no-mfa", 401],
      ["expired", 401],
      ["revoked", 401],
    ])
      await request(prefix + "/validate", authBody, {
        actor,
        key: randomUUID(),
        status: expected,
      });
    for (const extraHeaders of [
      { origin: "https://untrusted.example.invalid" },
      { "x-csrf-token": credentials.reviewer.csrf },
      { cookie: null },
    ])
      await request(prefix + "/validate", authBody, {
        key: randomUUID(),
        extraHeaders,
        status: extraHeaders.cookie === null ? 401 : 403,
      });
    check(
      unchanged === (await preflightBusinessState(observer)),
      "failed authority leaves all publication business state unchanged",
    );
    async function approveExtensions(snapshot) {
      const targets = [
        ...(snapshot.extensions.aliases
          ? [{ kind: "IDOL_ALIASES", revisionId: snapshot.revisionId }]
          : []),
        ...(snapshot.extensions.details
          ? SUPPORTED_LOCALES.map((locale) => ({
              kind: "GIFT_DETAILS",
              revisionId: snapshot.revisionId,
              locale,
            }))
          : []),
      ];
      for (const target of targets)
        for (const action of ["submit", "approve"]) {
          const read = await request(extensions + "/reviews/read", {
            schemaVersion: 1,
            target,
          });
          await request(
            extensions + "/reviews/" + action,
            {
              schemaVersion: 1,
              target,
              expectedVersion: read.context.sequence,
              expectedContentHash: read.context.contentHash,
              expectedSourceHash: read.context.sourceHash,
              reasonCode: "HTTP_PUBLICATION_EXTENSION",
            },
            {
              actor: action === "approve" ? "reviewer" : "editor",
              key: randomUUID(),
            },
          );
        }
    }
    async function copyTarget(target) {
      const source = await readSnapshot(target);
      let changes = { kind: target.owner.kind };
      if (target.owner.kind === "POLICY") {
        const clock = (
          await observer.query(
            "SELECT to_char((clock_timestamp()+interval '2 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at",
          )
        ).rows[0].at;
        changes = {
          ...changes,
          structure: { ...source.content.structure, effectiveAt: clock },
        };
      }
      const result = await request(
        authoring + "/copy",
        {
          schemaVersion: 1,
          target: target.owner,
          sourceRevisionId: source.revisionId,
          expectedSourceHash: source.contentHash,
          expectedVersion: source.headVersion,
          changes,
          reasonCode: "HTTP_PUBLICATION_COPY",
        },
        { key: randomUUID() },
      );
      const copied = { owner: target.owner, revisionId: result.resultId };
      if (target.owner.kind === "POLICY") {
        const deadline = globalThis.performance.now() + 6000;
        while (
          !(
            await observer.query(
              "SELECT clock_timestamp()>=effective_at AS effective FROM public.policy_revisions WHERE id=$1",
              [copied.revisionId],
            )
          ).rows[0].effective
        ) {
          check(
            globalThis.performance.now() < deadline,
            "copied policy becomes causally effective",
          );
          await delay(20);
        }
      }
      await approveExtensions(await readSnapshot(copied));
      return copied;
    }
    const first = {};
    const publicationReasons = {
      policy: "HTTP_PUBLICATION_ATOMICITY",
      media: "HTTP_PUBLICATION_RACE",
    };
    for (const name of names) {
      first[name] = await publish(
        targets[name],
        publicationReasons[name] ?? "HTTP_PUBLICATION",
      );
      await readPublic(name, first[name].publicationId);
    }
    cache = await createPublicationHttpCache({ base, routes });
    const results = [];
    let purgeTick = 0,
      purgeDrain = 0;
    const purgeTransactions = {
      async runInPublicationPurgeTransaction(work) {
        let phase = "BEGIN";
        try {
          return await persistence.publicationPurgeTransactionManager.runInPublicationPurgeTransaction(
            (repositories) =>
              work({
                publicationPurge: Object.fromEntries(
                  ["claim", "record"].map((method) => [
                    method,
                    async (command) => {
                      phase = method === "claim" ? "CLAIM" : "RECORD";
                      const result =
                        await repositories.publicationPurge[method](command);
                      notePurge({
                        phase,
                        outcome: result.outcome,
                        code:
                          result.outcome === "FAILURE" ? result.code : "NONE",
                      });
                      return result;
                    },
                  ]),
                ),
              }),
          );
        } catch (error) {
          const code = error?.failure?.error?.code;
          notePurge({
            phase,
            outcome: "THREW",
            code: [
              "TRANSACTION_ABORTED",
              "INTEGRITY_VIOLATION",
              "TRANSACTION_OUTCOME_UNKNOWN",
              "TEMPORARY_UNAVAILABLE",
              "CONFIGURATION_ERROR",
            ].includes(code)
              ? code
              : "OTHER",
          });
          throw error;
        }
      },
    };
    const createPurgeWorker = () =>
      createPublicationPurgeWorkerRuntime({
        schemaVersion: 1,
        pollIntervalMs: 1000,
        useCases: createPublicationPurgeUseCases({
          transactions: purgeTransactions,
          cachePurge: cache.port,
        }),
        onResult: (result) => {
          results.push(result);
          purgeTick++;
          if (result.outcome === "UNAVAILABLE")
            console.error(
              `PURGE_DIAGNOSTIC ${JSON.stringify({ tick: purgeTick, drain: purgeDrain, trace: purgeDiagnostics })}`,
            );
          if (result.outcome === "UNAVAILABLE" && probePurgeClock)
            console.error(
              `PURGE_CLOCK_PROBE ${JSON.stringify({ queries: purgeClockProbeQueries, seconds: 2 })}`,
            );
        },
      });
    worker = createPurgeWorker();
    async function drain(publicationIds) {
      purgeDrain++;
      const deadline = globalThis.performance.now() + 60_000;
      await worker.start();
      for (;;) {
        check(
          !results.some((result) => result.outcome === "UNAVAILABLE"),
          "purge worker records safe durable outcomes",
        );
        const values = await Promise.all(
          publicationIds.map((id) => status(id)),
        );
        if (
          values.every((value) =>
            SUPPORTED_LOCALES.every(
              (locale) =>
                value.jobs
                  .filter((job) => job.locale === locale)
                  .sort((a, b) => b.generation - a.generation)[0]?.status ===
                "COMPLETED",
            ),
          )
        )
          break;
        check(
          globalThis.performance.now() < deadline,
          "all locale cache purges complete within sixty seconds",
        );
        await delay(100);
      }
      await worker.stop();
      worker = createPurgeWorker();
    }
    await worker.start();
    await worker.runOnce();
    check(
      results.at(-1)?.outcome === "RECORDED" &&
        results.at(-1)?.status === "SUBMITTED",
      "provider pending is durably recorded before process restart",
    );
    check(
      purgeClockProbeQueries === 2,
      "first claim and record preserve causality across an earlier clock observation while expiry and leases use the actual clock",
    );
    await worker.stop();
    worker = createPurgeWorker();
    await drain(Object.values(first).map((value) => value.publicationId));
    check(
      cache.submissions.length === 35,
      "restarted worker polls stored provider reference without resubmitting any of the thirty-five jobs",
    );
    stage = "HTTP cache old representation";
    for (const name of names)
      for (const locale of SUPPORTED_LOCALES)
        check(
          (await cache.read(name, locale)).publication.id ===
            first[name].publicationId,
          "local HTTP edge stores original published representation",
        );
    const second = {},
      nextTargets = {},
      committedAt = globalThis.performance.now();
    for (const name of names) {
      nextTargets[name] = await copyTarget(targets[name]);
      second[name] = await publish(nextTargets[name]);
      await readPublic(name, second[name].publicationId);
      check(
        !(await status(first[name].publicationId)).isCurrent,
        "previous publication remains readable history but is no longer current",
      );
      for (const locale of SUPPORTED_LOCALES)
        check(
          (await cache.read(name, locale)).publication.id ===
            first[name].publicationId,
          "edge remains old until actual HTTP purge completion",
        );
    }
    await drain(Object.values(second).map((value) => value.publicationId));
    check(
      globalThis.performance.now() - committedAt < 60_000,
      "publication to seven-language edge visibility stays within sixty seconds",
    );
    for (const name of names)
      for (const locale of SUPPORTED_LOCALES)
        check(
          (await cache.read(name, locale)).publication.id ===
            second[name].publicationId,
          "completed purge refreshes each actual HTTP cached representation",
        );
    check(
      cache.submissions.length === 70 &&
        cache.submissions.every(
          (item) =>
            item.paths.length > 0 &&
            !item.paths.some((path) => path === "/*" || path.includes("?")),
        ),
      "two five-kind publications submit exact locale jobs without global or query wildcard",
    );
    const supersedingMedia = await publish(fixtures.referencedMediaTarget);
    await readPublic("idol", second.idol.publicationId);
    const staleDependencyTarget = await copyTarget(nextTargets.idol);
    const staleDependency = await preflight(staleDependencyTarget);
    check(
      !staleDependency.ready,
      "new parent draft cannot newly publish a superseded media dependency",
    );
    const rejectedDependency = await request(
      prefix + "/validate",
      {
        schemaVersion: 1,
        target: staleDependencyTarget,
        expectedVersion: staleDependency.headVersion,
        expectedContentHash: staleDependency.contentHash,
        reasonCode: "HTTP_SUPERSEDED_MEDIA",
      },
      { key: randomUUID(), status: 409 },
    );
    check(
      rejectedDependency.code === "PUBLICATION_BLOCKED",
      "new publication keeps strict media lifecycle gate",
    );
    await drain([supersedingMedia.publicationId]);
    for (const name of names) {
      const readiness = await preflight(targets[name], "ROLLBACK");
      check(
        readiness.ready,
        "historical published revision can be re-evaluated for rollback",
      );
      const body = {
          schemaVersion: 1,
          target: targets[name],
          expectedVersion: readiness.headVersion,
          expectedContentHash: readiness.contentHash,
          reasonCode: "HTTP_PUBLICATION_ROLLBACK",
        },
        key = randomUUID();
      const rollback = await request(prefix + "/rollback", body, { key });
      const replay = await request(prefix + "/rollback", body, { key });
      check(
        rollback.action === "ROLLBACK" &&
          replay.replayed &&
          replay.resultId === rollback.resultId &&
          rollback.publicationId !== first[name].publicationId,
        "rollback creates a new immutable publication and replays once",
      );
      await readPublic(name, rollback.publicationId);
      second[name] = rollback;
    }
    cache.configure("FAIL");
    const failDeadline = globalThis.performance.now() + 60_000;
    await worker.start();
    for (;;) {
      const states = await Promise.all(
        Object.values(second).map((value) => status(value.publicationId)),
      );
      if (
        states.every((value) =>
          value.jobs.every((job) => job.status === "FAILED"),
        )
      )
        break;
      check(
        globalThis.performance.now() < failDeadline,
        "provider denial becomes durable failed status",
      );
      await delay(100);
    }
    await worker.stop();
    worker = createPurgeWorker();
    cache.configure("COMPLETE");
    for (const name of names) {
      const state = await status(second[name].publicationId);
      check(
        state.isCurrent,
        "purge failure does not undo committed publication",
      );
      for (const job of state.jobs) {
        const body = {
            schemaVersion: 1,
            publicationId: state.publicationId,
            purgeJobId: job.id,
            expectedVersion: job.version,
            reasonCode: "HTTP_PURGE_RETRY",
          },
          key = randomUUID();
        await request(prefix + "/retry", body, {
          actor: "reviewer",
          key,
          status: 403,
        });
        const retried = await request(prefix + "/retry", body, { key });
        const replay = await request(prefix + "/retry", body, { key });
        check(
          retried.generation === 2 &&
            replay.replayed &&
            replay.purgeJobId === retried.purgeJobId,
          "manual retry creates one durable new generation with idempotent replay",
        );
      }
    }
    await drain(Object.values(second).map((value) => value.publicationId));
    for (const name of names) {
      const state = await status(second[name].publicationId, {
        actor: "reviewer",
      });
      check(
        state.jobs.length === 14 &&
          state.jobs.filter(
            (job) => job.generation === 1 && job.status === "FAILED",
          ).length === 7 &&
          state.jobs.filter(
            (job) => job.generation === 2 && job.status === "COMPLETED",
          ).length === 7,
        "status retains failed history and seven completed retry generations",
      );
      for (const locale of SUPPORTED_LOCALES)
        check(
          (await cache.read(name, locale)).publication.id ===
            second[name].publicationId,
          "retried purge exposes rolled-back content in every locale",
        );
    }
    await revokeAdminContentLocaleGrant(observer, {
      adminIdentityId: fixtures.editor,
      locale: "ja",
      actorId: fixtures.editor,
    });
    await status(second.idol.publicationId, { status: 403 });
    const originalMutation = mutationReplays.at(-1);
    await request(prefix + "/publish", originalMutation.body, {
      key: originalMutation.key,
      status: 403,
    });
    await grantAdminContentLocale(observer, {
      adminIdentityId: fixtures.editor,
      locale: "ja",
      actorId: fixtures.editor,
    });
    await status(second.idol.publicationId);
    const authorizedReplay = await request(
      prefix + "/publish",
      originalMutation.body,
      { key: originalMutation.key },
    );
    check(
      authorizedReplay.replayed &&
        authorizedReplay.resultId === originalMutation.resultId,
      "restored current scope permits the original immutable idempotency receipt",
    );
    stage = "actual resource upload to published metadata";
    const mediaPublication = await verifyPublicationMedia({
      request,
      publish,
      check,
      fixtures,
      observer,
      storage: media.storage,
      environment: runtimeEnvironment,
      logger: createStructuredLogger({
        service: "worker",
        write: (line) => logs.push(line),
      }),
      secrets,
    });
    await drain([mediaPublication]);
    check(
      unrelatedBefore === (await unrelatedState()),
      "publication purge worker leaves unrelated ready commerce events and dispatch attempts untouched",
    );
    check(
      !secrets.some((secret) => logs.join("\n").includes(secret)),
      "logs omit session credentials",
    );
    console.log(
      `PASS publication runtime HTTP (${assertions} assertions, ${requests} HTTP requests); five kinds, seven locales, normal-trigger migration, authorization, version/idempotency, actual local HTTP purge`,
    );
    if (probePurgeClock)
      console.log(
        `PURGE_CLOCK_PROBE ${JSON.stringify({ queries: purgeClockProbeQueries, seconds: 2 })}`,
      );
  } finally {
    await worker?.stop();
    await cache?.close();
    if (app) await app.close();
    else for (const runtime of runtimes) await runtime.stop();
    await persistence.close();
    await observer.end();
  }
}
try {
  const runnerArgument = "--run-publication-runtime-http";
  if (process.argv.includes(runnerArgument)) {
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    await withEphemeralPostgres((database) => verify(database, s3));
  } else
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: runnerArgument,
        timeoutMs: 300000,
      }),
    );
} catch (error) {
  console.error(
    `FAIL publication runtime HTTP at ${stage}; assertion=${failedLabel ?? "NONE"}; sqlstate=${typeof error?.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code) ? error.code : "NONE"}`,
  );
  process.exitCode = 1;
}
