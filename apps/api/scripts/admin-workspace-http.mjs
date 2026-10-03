#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client, Pool } from "pg";
import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import * as contract from "@fan-support/contracts";
import {
  revokeAdminContentLocaleGrant,
  grantAdminContentLocale,
} from "../../../packages/persistence-postgres/scripts/postgres-admin-content-fixtures.mjs";
import {
  digestAdminContentToken,
  createPublicationPurgeUseCases,
} from "@fan-support/application";
import { createStructuredLogger } from "@fan-support/observability";
import {
  runMigrations,
  withEphemeralPostgres,
  createPostgresPersistence,
} from "@fan-support/persistence-postgres";
import { createApiApplication } from "../dist/bootstrap.js";
import {
  createTestAdminSessionComposition,
  createTestAdminWorkspaceComposition,
  createTestContentAuthoringComposition,
  createTestBaseContentComposition,
  createTestAdminContentComposition,
  createTestResourceManagementComposition,
  createTestPublicationPreflightComposition,
  createTestPublicationRuntimeComposition,
} from "../dist/testing/index.js";
import { createWorkerMediaProcessingComposition } from "../../worker/dist/media-processing-composition.js";
import { createMediaProcessingWorkerRuntime } from "../../worker/dist/media-processing-runtime.js";
import { createPublicationPurgeWorkerRuntime } from "../../worker/dist/publication-purge-runtime.js";
import { createPublicationHttpCache } from "./publication-runtime-http-cache.mjs";
import { publicationSessionDiagnostic } from "./publication-runtime-http-session-diagnostic.mjs";
import { createPostgresPersistenceWithPoolFactory } from "../../../packages/persistence-postgres/dist/postgres-persistence.js";
import {
  createPublicationMediaFixture,
  publicationMediaEnvironment,
} from "./publication-runtime-http-media.mjs";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
import {
  seedWorkspaceIdentities,
  workspaceTranslations,
  workspaceMediaContent,
  createWorkspaceImage,
} from "./admin-workspace-fixtures.mjs";
import { verifyAdminWorkspaceBrowser } from "./admin-workspace-browser.mjs";
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const credentials = Object.fromEntries(
  [
    "editor",
    "reviewer",
    "manager",
    "denied",
    "expired",
    "revoked",
    "no-mfa",
  ].map((name) => [
    name,
    {
      token: randomBytes(32).toString("base64url"),
      csrf: randomBytes(32).toString("base64url"),
    },
  ]),
);
const tokenPepper = randomBytes(32).toString("hex");
let stage = "initialization",
  assertions = 0,
  requests = 0,
  failedLabel;
const check = (value, label) => {
  assertions++;
  if (!value) failedLabel = label;
  assert.ok(value, label);
};
async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function schemaFor(route) {
  if (route.includes("/gift-commerce/"))
    return contract.giftCommerceResponseSchema;
  if (route.includes("/session/")) return contract.adminSessionResponseSchema;
  if (route.includes("/catalog/")) return contract.adminCatalogResponseSchema;
  if (route.includes("/translation-workspace/"))
    return contract.translationWorkspaceResponseSchema;
  if (route.includes("/translation-transfer/"))
    return contract.translationTransferResponseSchema;
  if (route.includes("/admin-preview-media/"))
    return contract.adminPreviewMediaResponseSchema;
  if (route.includes("/content-authoring/"))
    return contract.contentAuthoringResponseSchema;
  if (route.includes("/content-review/"))
    return contract.baseContentResponseSchema;
  if (route.includes("/resources/"))
    return contract.adminResourceResponseSchema;
  if (route.endsWith("/preflight"))
    return contract.publicationPreflightResponseSchema;
  if (route.includes("/publication/"))
    return contract.publicationRuntimeResponseSchema;
  return contract.adminContentResponseSchema;
}
// Failure-only test diagnostics preserve the actual SQL, parameters and transaction behavior.
function observedPublicationPersistence(database, options) {
  return createPostgresPersistenceWithPoolFactory(
    database,
    options,
    (config) => {
      const pool = new Pool(config);
      return {
        async connect() {
          const connection = await pool.connect();
          let receiptId, sessionDiagnostic;
          return {
            async query(statement, values) {
              const sql =
                typeof statement === "string" ? statement : statement.text;
              try {
                if (sql === "COMMIT" && receiptId)
                  sessionDiagnostic = await publicationSessionDiagnostic(
                    connection,
                    receiptId,
                  );
                const result = await connection.query(statement, values);
                if (
                  sql.startsWith(
                    "INSERT INTO public.content_publication_receipts(",
                  )
                )
                  receiptId = (values ?? statement.values)?.[0];
                if (
                  sql.startsWith("BEGIN") ||
                  sql === "COMMIT" ||
                  sql === "ROLLBACK"
                ) {
                  receiptId = undefined;
                  sessionDiagnostic = undefined;
                }
                return result;
              } catch (error) {
                console.error(
                  `Workspace publication diagnostic ${JSON.stringify({
                    phase: sql === "COMMIT" ? "COMMIT" : "SQL",
                    sqlstate:
                      typeof error?.code === "string" &&
                      /^[A-Z0-9]{5}$/u.test(error.code)
                        ? error.code
                        : "NONE",
                    guard:
                      error?.message ===
                      "publication action requires its current active MFA session"
                        ? "PUBLICATION_SESSION_TIME"
                        : "UNCLASSIFIED",
                    ...(sessionDiagnostic ?? {}),
                  })}`,
                );
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
    },
  );
}
export async function verifyAdminWorkspaceScenario(
  database,
  s3,
  { serve, ui, extension },
) {
  await runMigrations({
    clientConfig: database,
    workspaceRoot,
    command: { direction: "up" },
  });
  const client = new Client(database);
  let connectionFailure = false;
  client.on("error", () => {
    connectionFailure = true;
  });
  await client.connect();
  try {
    stage = "synthetic identity fixtures";
    const identities = await seedWorkspaceIdentities(
      client,
      Object.entries(credentials).map(([name, value]) => ({
        name,
        actor: ["expired", "revoked", "no-mfa"].includes(name)
          ? "editor"
          : name,
        sessionTokenDigest: digestAdminContentToken({
          tokenPepper,
          purpose: "admin-session",
          token: value.token,
        }),
        csrfTokenDigest: digestAdminContentToken({
          tokenPepper,
          purpose: "admin-csrf",
          token: value.csrf,
        }),
        expiresInSeconds: name === "expired" ? -60 : 3600,
        revoked: name === "revoked",
        authenticatedWithMfa: name !== "no-mfa",
      })),
    );
    await extension?.seed?.({ client, identities, check });
    const sitePort = await unusedPort(),
      origin = `http://localhost:${sitePort}`;
    const logger = createStructuredLogger({
      service: "api",
      write: () => undefined,
    });
    const media = createPublicationMediaFixture(s3),
      common = {
        environment: "TEST",
        database,
        tokenPepper,
        allowedOrigin: origin,
      };
    const environment = publicationMediaEnvironment(
      preflightEnvironment(database),
      s3,
    );
    const persistence = createPostgresPersistence(database, {
      catalogPublicMediaBaseUrl: "https://media.example.invalid",
    });
    let app, worker, workerRuntime, cache, purge, next, browser;
    const runtimes = [];
    try {
      stage = "explicit compositions";
      const compositions = [
        createTestAdminSessionComposition(common),
        createTestAdminWorkspaceComposition({
          ...common,
          publicMediaBaseUrl: "https://media.example.invalid",
          storage: media.storage,
        }),
        createTestContentAuthoringComposition(common),
        createTestBaseContentComposition(common),
        createTestAdminContentComposition(common),
        createTestResourceManagementComposition({ ...common, ...media }),
        createTestPublicationPreflightComposition(common),
        createTestPublicationRuntimeComposition(
          {
            ...common,
            publicMediaBaseUrl: "https://media.example.invalid",
          },
          { createPersistence: observedPublicationPersistence },
        ),
      ];
      compositions.push(
        ...((await extension?.compositions?.({
          common,
          persistence,
          environment,
          logger,
        })) ?? []),
      );
      for (const composition of compositions)
        for (const [key, value] of Object.entries(composition))
          if (key.endsWith("Runtime") || key.endsWith("Lifecycle"))
            runtimes.push(value);
      app = await createApiApplication(
        environment,
        Object.assign({ logger }, ...compositions),
      );
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();
      async function request(
        route,
        body,
        { actor = "editor", key, status = 200, headers = {} } = {},
      ) {
        requests++;
        const identity = credentials[actor];
        const response = await globalThis.fetch(base + route, {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/json",
            cookie: `__Host-fan-admin-session=${identity.token}`,
            "x-csrf-token": identity.csrf,
            ...(key ? { "idempotency-key": key } : {}),
            ...headers,
          },
          body: JSON.stringify(body),
          signal: globalThis.AbortSignal.timeout(30_000),
        });
        const parsed = schemaFor(route).safeParse(await response.json());
        if (response.status !== status)
          console.error(
            `Workspace HTTP diagnostic ${JSON.stringify({ route, ordinal: requests, status: response.status, code: parsed.success && parsed.data.outcome === "FAILURE" ? parsed.data.code : "INVALID_RESPONSE" })}`,
          );
        check(
          response.status === status,
          "HTTP status matches command outcome",
        );
        check(parsed.success, "HTTP result matches strict DTO");
        check(
          response.headers.get("cache-control") === "private, no-store",
          "HTTP response is private",
        );
        return parsed.data;
      }
      stage = "current session HTTP";
      for (const actor of ["editor", "reviewer", "manager", "denied"]) {
        const session = await request(
          "/api/v1/admin/session/read",
          { schemaVersion: 1 },
          { actor },
        );
        check(
          session.actorId === identities.identities[actor],
          "session reports canonical current actor",
        );
        check(
          !JSON.stringify(session).includes(credentials[actor].token),
          "session response excludes raw session",
        );
      }
      for (const actor of ["expired", "revoked", "no-mfa"])
        await request(
          "/api/v1/admin/session/read",
          { schemaVersion: 1 },
          { actor, status: 401 },
        );
      await request(
        "/api/v1/admin/session/read",
        { schemaVersion: 1 },
        { status: 403, headers: { "x-csrf-token": "a".repeat(42) + "A" } },
      );
      stage = "current session privilege changes";
      await revokeAdminContentLocaleGrant(client, {
        adminIdentityId: identities.identities.reviewer,
        locale: "ja",
        actorId: identities.identities.manager,
      });
      const afterLocaleRevocation = await request(
        "/api/v1/admin/session/read",
        { schemaVersion: 1 },
        { actor: "reviewer" },
      );
      check(
        afterLocaleRevocation.localeScopes.length === 6 &&
          !afterLocaleRevocation.localeScopes.includes("ja"),
        "same canonical session immediately reflects locale withdrawal",
      );
      await grantAdminContentLocale(client, {
        adminIdentityId: identities.identities.reviewer,
        locale: "ja",
        actorId: identities.identities.manager,
      });
      const rolePermission = (
        await client.query(
          "DELETE FROM role_permissions WHERE role_id IN (SELECT role_id FROM admin_identity_roles WHERE admin_identity_id=$1) AND permission_id IN (SELECT id FROM permissions WHERE permission_key='content.read') RETURNING role_id,permission_id,granted_by",
          [identities.identities.reviewer],
        )
      ).rows[0];
      check(
        Boolean(rolePermission),
        "controlled fixture removes one current permission grant",
      );
      const afterPermissionRevocation = await request(
        "/api/v1/admin/session/read",
        { schemaVersion: 1 },
        { actor: "reviewer" },
      );
      check(
        !afterPermissionRevocation.permissions.includes("content.read"),
        "same session immediately reflects permission withdrawal",
      );
      await request(
        "/api/v1/admin/catalog/owners/list",
        { schemaVersion: 1, kind: "IDOL", locale: "en", page: 1, pageSize: 10 },
        { actor: "reviewer", status: 403 },
      );
      await client.query(
        "INSERT INTO role_permissions(role_id,permission_id,granted_by,granted_at) VALUES($1,$2,$3,clock_timestamp()-interval '5 minutes')",
        [
          rolePermission.role_id,
          rolePermission.permission_id,
          rolePermission.granted_by,
        ],
      );
      worker = await createWorkerMediaProcessingComposition(environment, {
        logger,
        factories: {
          createRuntime(options) {
            workerRuntime = createMediaProcessingWorkerRuntime({
              ...options,
              schedule: () => ({ cancel() {} }),
            });
            return workerRuntime;
          },
        },
      });
      await worker.start();
      cache = await createPublicationHttpCache({
        base,
        routes: { homepage: "/api/v1/homepage" },
      });
      purge = createPublicationPurgeWorkerRuntime({
        schemaVersion: 1,
        useCases: createPublicationPurgeUseCases({
          transactions: persistence.publicationPurgeTransactionManager,
          cachePurge: cache.port,
        }),
        pollIntervalMs: 1000,
      });
      await purge.start();
      const write = (route, body, actor = "editor") =>
        request(
          route,
          { schemaVersion: 1, ...body, reasonCode: "WORKSPACE_FIXTURE" },
          { actor, key: randomUUID() },
        );
      async function author(owner, content) {
        return (
          await write("/api/v1/admin/content-authoring/create", {
            target: owner,
            content,
            expectedVersion: 0,
          })
        ).resultId;
      }
      async function approve(owner, revisionId) {
        for (const locale of contract.SUPPORTED_LOCALES)
          for (const action of ["submit", "approve"]) {
            const target = { owner, revisionId, locale };
            const value = await request("/api/v1/admin/content-review/read", {
              schemaVersion: 1,
              target,
            });
            await write(
              `/api/v1/admin/content-review/${action}`,
              {
                target,
                expectedVersion: value.context.audit.reviewSequence,
                expectedContentHash: value.context.audit.sourceHash,
                expectedSourceHash: value.context.currentEnglishSourceHash,
              },
              action === "approve" ? "reviewer" : "editor",
            );
          }
      }
      async function publish(owner, revisionId) {
        const target = { owner, revisionId };
        const value = await request(
          "/api/v1/admin/content/publication/preflight",
          { schemaVersion: 1, target, action: "PUBLISH" },
          { actor: "manager" },
        );
        if (!value.ready)
          console.error(
            `Workspace preflight ${JSON.stringify({ kind: owner.kind, codes: value.issues.map((issue) => issue.code) })}`,
          );
        check(value.ready, "fixture passes actual complete publication gate");
        const validated = await write(
          "/api/v1/admin/content/publication/validate",
          {
            target,
            expectedVersion: value.headVersion,
            expectedContentHash: value.contentHash,
          },
          "manager",
        );
        return write(
          "/api/v1/admin/content/publication/publish",
          {
            target,
            expectedVersion: validated.headVersion,
            expectedContentHash: validated.contentHash,
          },
          "manager",
        );
      }
      async function createMediaAsset(name, width, height, hue, role) {
        stage = `actual image ${name}`;
        const bytes = await createWorkspaceImage(width, height, hue);
        const grant = await write("/api/v1/admin/resources/uploads/begin", {
          checksumSha256: createHash("sha256").update(bytes).digest("hex"),
          byteSize: bytes.length,
          mimeType: "image/jpeg",
          rightsReference: "rights:original-workspace-fixture",
          expectedVersion: 0,
        });
        const uploaded = await globalThis.fetch(grant.grant.url, {
          method: "PUT",
          headers: grant.grant.headers,
          body: bytes,
          signal: globalThis.AbortSignal.timeout(30_000),
        });
        check(uploaded.status === 200, "strict TLS stores real source bytes");
        await uploaded.body?.cancel();
        const sourceId = (
          await write("/api/v1/admin/resources/uploads/complete", {
            uploadId: grant.uploadId,
            expectedVersion: 1,
          })
        ).resultId;
        const sourceOwner = { kind: "MEDIA_METADATA", mediaAssetId: sourceId },
          sourceRevision = await author(
            sourceOwner,
            workspaceMediaContent(`Source ${name}`),
          );
        await approve(sourceOwner, sourceRevision);
        await write("/api/v1/admin/resources/media/rights", {
          assetId: sourceId,
          expectedVersion: 0,
          rightsStatus: "APPROVED",
          evidenceReference: "rights:original-workspace-fixture",
        });
        const job = await write("/api/v1/admin/resources/processing/enqueue", {
          sourceAssetId: sourceId,
          metadataRevisionId: sourceRevision,
          role,
          fit: "COVER",
          expectedVersion: 0,
        });
        await workerRuntime.runOnce();
        const processed = await request(
          "/api/v1/admin/resources/processing/read",
          { schemaVersion: 1, jobId: job.resultId },
        );
        check(
          processed.job.snapshot.status === "SUCCEEDED",
          "real image worker produces responsive variants",
        );
        const assetId = processed.job.snapshot.outputAssetId;
        await write("/api/v1/admin/resources/media/rights", {
          assetId,
          expectedVersion: 0,
          rightsStatus: "APPROVED",
          evidenceReference: "rights:original-workspace-fixture",
        });
        const owner = { kind: "MEDIA_METADATA", mediaAssetId: assetId },
          revisionId = await author(owner, workspaceMediaContent(name));
        await approve(owner, revisionId);
        await publish(owner, revisionId);
        return { assetId, revisionId };
      }
      const mediaFixtures = [];
      for (const descriptor of [
        ["Portrait", 1600, 2000, 205, "PORTRAIT"],
        ["Desktop", 2400, 1350, 28, "HERO_DESKTOP"],
        ["Mobile", 1080, 1350, 305, "HERO_MOBILE"],
      ])
        mediaFixtures.push(await createMediaAsset(...descriptor));
      stage = "real catalog and editorial fixtures";
      const main = await write("/api/v1/admin/catalog/idols/create", {
        handle: "luna-mira",
        expectedBaseVersion: 0,
      });
      const owner = { kind: "IDOL", idolId: main.idolId };
      const idolContent = {
        kind: "IDOL",
        structure: {
          themeAccent: "#CCAE7F",
          heroTextTone: "light",
          displayOrder: 0,
        },
        media: ["PORTRAIT", "HERO_DESKTOP", "HERO_MOBILE"].map(
          (role, index) => ({
            role,
            mediaAssetId: mediaFixtures[index].assetId,
            mediaMetadataRevisionId: mediaFixtures[index].revisionId,
            sortOrder: index,
          }),
        ),
        translations: workspaceTranslations((locale) => ({
          displayName: "Luna Mira",
          shortBio: `An independent artist · ${locale}`,
          fullBio:
            "<p>A synthetic artist profile for local editorial verification.</p>",
          seoTitle: "Luna Mira",
          seoDescription: `Discover Luna Mira · ${locale}`,
        })),
      };
      const revisionId = await author(owner, idolContent);
      await approve(owner, revisionId);
      await publish(owner, revisionId);
      const currentOwner = await request("/api/v1/admin/catalog/owners/read", {
        schemaVersion: 1,
        target: owner,
        locale: "en",
      });
      await write("/api/v1/admin/catalog/idols/status", {
        idolId: main.idolId,
        status: "active",
        acceptingGifts: true,
        expectedBaseVersion: currentOwner.owner.baseVersion,
      });
      const original = await request("/api/v1/admin/content-authoring/read", {
        schemaVersion: 1,
        target: owner,
        revisionId,
      });
      const copied = await write("/api/v1/admin/content-authoring/copy", {
        target: owner,
        sourceRevisionId: revisionId,
        expectedSourceHash: original.snapshot.contentHash,
        expectedVersion: 1,
        changes: { kind: "IDOL" },
      });
      const home = { kind: "HOMEPAGE" };
      const homeRevision = await author(home, {
        kind: "HOMEPAGE",
        structure: {
          slots: [
            {
              slotKey: "hero",
              kind: "HERO_IDOL",
              idolId: main.idolId,
              desktopMediaAssetId: mediaFixtures[1].assetId,
              desktopMediaMetadataRevisionId: mediaFixtures[1].revisionId,
              mobileMediaAssetId: mediaFixtures[2].assetId,
              mobileMediaMetadataRevisionId: mediaFixtures[2].revisionId,
              sortOrder: 0,
            },
          ],
        },
        translations: workspaceTranslations((locale) => ({
          heroTitle: "Bring your support closer",
          heroSubtitle: `Create a thoughtful moment for your artist · ${locale}`,
          ctaLabel: "Explore gifts",
          slotLabels: [{ slotKey: "hero", label: "Luna Mira" }],
          seoTitle: "Artist support",
          seoDescription: `Thoughtful support across the world · ${locale}`,
        })),
      });
      await approve(home, homeRevision);
      for (let index = 1; index <= 13; index++) {
        const created = await write("/api/v1/admin/catalog/idols/create", {
          handle: `studio-artist-${index}`,
          expectedBaseVersion: 0,
        });
        await author(
          { kind: "IDOL", idolId: created.idolId },
          {
            ...idolContent,
            media: [],
            translations: [
              {
                locale: "en",
                origin: "HUMAN",
                fields: {
                  ...idolContent.translations[0].fields,
                  displayName: `Studio Artist ${String(index).padStart(2, "0")}`,
                },
              },
            ],
          },
        );
      }
      await write("/api/v1/admin/resources/policies/register", {
        policyKey: "delivery",
        kind: "DELIVERY",
        expectedVersion: 0,
      });
      const effectiveAt = new Date(Date.now() + 2000).toISOString();
      const policyRevision = await author(
        { kind: "POLICY", policyKey: "delivery" },
        {
          kind: "POLICY",
          structure: { kind: "DELIVERY", effectiveAt },
          translations: workspaceTranslations((locale) => ({
            title: "Delivery and care",
            summary: `Preparing each gift with care · ${locale}`,
            body: "<p>Every support order is prepared and delivered with care.</p>",
          })),
        },
      );
      const fixtures = {
        ...identities,
        media: mediaFixtures,
        idol: {
          owner,
          revisionId: copied.resultId,
          publishedRevisionId: revisionId,
        },
        homepage: { owner: home, revisionId: homeRevision },
        policy: {
          owner: { kind: "POLICY", policyKey: "delivery" },
          revisionId: policyRevision,
        },
      };
      await extension?.prepare?.({
        fixtures,
        request,
        write,
        author,
        approve,
        publish,
        createMediaAsset,
        client,
        credentials,
        persistence,
        base,
        origin,
        check,
      });
      stage = "Next development server";
      const s3Client = new S3Client({
        region: "us-east-1",
        endpoint: s3.endpoint,
        forcePathStyle: true,
        credentials: {
          accessKeyId: s3.accessKeyId,
          secretAccessKey: s3.secretAccessKey,
        },
      });
      try {
        await s3Client.send(
          new PutBucketCorsCommand({
            Bucket: s3.sourceBucket,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedOrigins: [origin],
                  AllowedMethods: ["PUT", "GET", "HEAD"],
                  AllowedHeaders: ["*"],
                  ExposeHeaders: ["ETag", "x-amz-checksum-sha256"],
                  MaxAgeSeconds: 60,
                },
              ],
            },
          }),
        );
        await s3Client.send(
          new PutBucketCorsCommand({
            Bucket: s3.derivativeBucket,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedOrigins: [origin],
                  AllowedMethods: ["GET", "HEAD"],
                  AllowedHeaders: ["*"],
                  MaxAgeSeconds: 60,
                },
              ],
            },
          }),
        );
      } finally {
        s3Client.destroy();
      }
      const nextEnvironment = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !key.startsWith("FAN_SUPPORT_"),
        ),
      );
      Object.assign(nextEnvironment, {
        NODE_ENV: "development",
        FAN_SUPPORT_DEPLOYMENT_ENV: "development",
        FAN_SUPPORT_SITE_ORIGIN: origin,
        FAN_SUPPORT_INTERNAL_API_ORIGIN: base,
        FAN_SUPPORT_ADMIN_MODE: "TEST",
        NEXT_TELEMETRY_DISABLED: "1",
      });
      next = spawn(
        process.execPath,
        [
          path.join(
            workspaceRoot,
            "apps/admin/node_modules/next/dist/bin/next",
          ),
          "dev",
          "--hostname",
          "localhost",
          "--port",
          String(sitePort),
        ],
        {
          cwd: path.join(workspaceRoot, "apps/admin"),
          env: nextEnvironment,
          stdio: "ignore",
        },
      );
      let ready = false;
      const deadline = globalThis.performance.now() + 60_000;
      while (globalThis.performance.now() < deadline) {
        if (next.exitCode !== null) break;
        try {
          const response = await globalThis.fetch(`${origin}/healthz`, {
            signal: globalThis.AbortSignal.timeout(2000),
          });
          await response.body?.cancel();
          if (response.status === 200) {
            ready = true;
            break;
          }
        } catch {
          /* Next may still be compiling its health route. */
        }
        await delay(200);
      }
      check(ready, "Next development server becomes reachable");
      check(!connectionFailure, "observer connection remains healthy");
      stage = "real browser BFF";
      browser = await (extension?.verifyBrowser ?? verifyAdminWorkspaceBrowser)(
        {
          origin,
          base,
          credentials,
          fixtures,
          request,
          client,
          check,
          configPath: process.env.FAN_SUPPORT_MEDIA_S3_TEST_CONFIG,
          serve,
          ui,
        },
      );
      console.log(
        `PASS ${extension?.name ?? "admin workspace"} HTTP/PG/S3/Next browser (${assertions} assertions, ${requests} setup API requests; ${ui ? "full UI" : "protocol"} mode); local TEST identities, secure HttpOnly cookies, actual source processing and canonical current authorization`,
      );
      if (serve) {
        console.log(`LOCAL_ADMIN_WORKSPACE_READY ${origin}/en`);
        await new Promise((resolve) => {
          process.once("SIGTERM", resolve);
          process.once("SIGINT", resolve);
        });
      }
      return { assertions, requests };
    } finally {
      await browser?.close();
      if (next) {
        next.kill("SIGTERM");
        await Promise.race([once(next, "exit"), delay(5000)]);
        if (next.exitCode === null) next.kill("SIGKILL");
      }
      await purge?.stop();
      await cache?.close();
      await worker?.stop();
      if (app) await app.close();
      else for (const runtime of runtimes) await runtime.stop();
      await persistence.close();
    }
  } catch (error) {
    console.error(
      `Workspace diagnostic ${JSON.stringify({ stage, assertion: failedLabel ?? "NONE", sqlstate: typeof error?.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code) ? error.code : null, name: ["TypeError", "Error", "AssertionError"].includes(error?.name) ? error.name : "UNAVAILABLE" })}`,
    );
    throw error;
  } finally {
    await client.end();
  }
}
if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  try {
    const serve =
      process.argv.includes("--serve") ||
      process.argv.includes("--serve-admin-workspace");
    const ui =
      process.argv.includes("--ui") ||
      process.argv.includes("--run-admin-workspace-ui");
    if (
      process.argv.includes("--run-admin-workspace-ui") ||
      process.argv.includes("--run-admin-workspace") ||
      process.argv.includes("--serve-admin-workspace")
    ) {
      const s3 = readEphemeralS3Config();
      await prepareEphemeralS3Buckets(s3);
      await withEphemeralPostgres((database) =>
        verifyAdminWorkspaceScenario(database, s3, { serve, ui }),
      );
    } else
      await withEphemeralS3((context) =>
        runS3IntegrationChild({
          ...context,
          scriptUrl: import.meta.url,
          argument: serve
            ? "--serve-admin-workspace"
            : ui
              ? "--run-admin-workspace-ui"
              : "--run-admin-workspace",
          timeoutMs: serve ? 3_600_000 : 420_000,
        }),
      );
  } catch (error) {
    console.error(
      `FAIL admin workspace at ${stage}; assertion=${failedLabel ?? "NONE"}; code=${typeof error?.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code) ? error.code : "UNAVAILABLE"}`,
    );
    process.exitCode = 1;
  }
