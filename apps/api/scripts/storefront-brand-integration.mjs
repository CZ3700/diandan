import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
const { fetch } = globalThis;
import Fastify from "fastify";
import {
  createStorefrontBrandUseCases,
  createPublicStorefrontBrandUseCases,
  createResourceManagementUseCases,
  digestAdminContentToken,
} from "@fan-support/application";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "@fan-support/persistence-postgres";
import { createS3MediaStorageAdapter } from "@fan-support/media-s3";
import {
  createStorefrontLogoProcessor,
  createMediaSourceInspector,
} from "@fan-support/media-image";
import {
  registerStorefrontBrandRoute,
  registerPublicStorefrontBrandRoute,
} from "../dist/storefront-brand-route.js";
import { registerResourceManagementRoute } from "../dist/resource-management-route.js";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const requirePg = createRequire(
  new URL(
    "../../../packages/persistence-postgres/package.json",
    import.meta.url,
  ),
);
const { Client } = requirePg("pg");
const requireImage = createRequire(
  new URL("../../../packages/media-image/package.json", import.meta.url),
);
const sharp = requireImage("sharp");
let checks = 0,
  stage = "start";
const check = (value, label) => {
  stage = label;
  assert.ok(value, label);
  checks++;
};
if (!process.argv.includes("--child")) {
  await withEphemeralS3((options) =>
    runS3IntegrationChild({
      ...options,
      scriptUrl: import.meta.url,
      argument: "--child",
      timeoutMs: 180000,
    }),
  );
} else {
  const config = readEphemeralS3Config();
  await prepareEphemeralS3Buckets(config);
  const publicMediaBaseUrl = "https://media.example.test";
  const storage = createS3MediaStorageAdapter({
    schemaVersion: 1,
    sourceBucket: config.sourceBucket,
    derivativeBucket: config.derivativeBucket,
    publicMediaOrigin: publicMediaBaseUrl,
    maxUploadBytes: 25 * 1024 * 1024,
    region: "us-east-1",
    authentication: {
      mode: "static",
      endpoint: config.endpoint,
      presignEndpoint: config.endpoint,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      forcePathStyle: true,
    },
  });
  await withEphemeralPostgres(async (clientConfig) => {
    const client = new Client(clientConfig);
    await client.connect();
    let persistence, server;
    try {
      stage = "registered migration 0064";
      const migrate = (command) =>
        runMigrations({ clientConfig, workspaceRoot, command });
      await migrate({ direction: "up" });
      check(
        (await client.query("SELECT max(version) AS v FROM schema_migrations"))
          .rows[0].v === "0064",
        "registered chain 0001 through 0064",
      );
      await migrate({ direction: "down", confirmVersion: "0064" });
      check(
        (
          await client.query(
            "SELECT to_regclass('public.storefront_brand_heads') AS t",
          )
        ).rows[0].t === null,
        "empty brand rollback",
      );
      await migrate({ direction: "up" });
      const actorId = randomUUID(),
        roleId = randomUUID(),
        sessionId = randomUUID(),
        token = randomBytes(32).toString("base64url"),
        csrf = randomBytes(32).toString("base64url"),
        tokenPepper = randomBytes(32).toString("hex");
      await client.query(
        "INSERT INTO admin_identities(id,issuer,external_subject_hash,status) VALUES($1,'brand-test',$2,'ACTIVE')",
        [actorId, createHash("sha256").update(actorId).digest()],
      );
      await client.query(
        "INSERT INTO roles(id,role_key,description) VALUES($1,$2,'Brand integration')",
        [roleId, `brand:${roleId}`],
      );
      await client.query(
        "INSERT INTO admin_identity_roles(admin_identity_id,role_id,granted_by) VALUES($1,$2,$1)",
        [actorId, roleId],
      );
      for (const permission of [
        "content.read",
        "content.edit",
        "content.publish",
        "content.media.upload",
        "content.media.rights",
      ]) {
        const result = await client.query(
          "INSERT INTO permissions(id,permission_key,description) VALUES($1,$2,'Brand integration') ON CONFLICT(permission_key) DO UPDATE SET description=permissions.description RETURNING id",
          [randomUUID(), permission],
        );
        await client.query(
          "INSERT INTO role_permissions(role_id,permission_id,granted_by) VALUES($1,$2,$3)",
          [roleId, result.rows[0].id, actorId],
        );
      }
      await client.query(
        "INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,expires_at) VALUES($1,$2,$3,$4,true,clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 hour')",
        [
          sessionId,
          actorId,
          Buffer.from(
            digestAdminContentToken({
              tokenPepper,
              purpose: "admin-session",
              token,
            }),
            "hex",
          ),
          Buffer.from(
            digestAdminContentToken({
              tokenPepper,
              purpose: "admin-csrf",
              token: csrf,
            }),
            "hex",
          ),
        ],
      );
      stage = "create production adapters";
      persistence = createPostgresPersistence(clientConfig, {
        catalogPublicMediaBaseUrl: publicMediaBaseUrl,
      });
      const transactions = persistence.storefrontBrandTransactionManager;
      const actualProcessor = createStorefrontLogoProcessor({
        storage,
        now: () => new Date(),
      });
      let revokeAfterProcessing = false;
      const processor = {
        async process(command) {
          const result = await actualProcessor.process(command);
          if (revokeAfterProcessing)
            await client.query(
              "UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE id=$1",
              [sessionId],
            );
          return result;
        },
      };
      server = Fastify({ logger: false });
      const allowedOrigin = "https://admin.example.test";
      registerStorefrontBrandRoute(server, {
        allowedOrigin,
        useCases: createStorefrontBrandUseCases({
          transactions,
          tokenPepper,
          processor,
        }),
      });
      registerPublicStorefrontBrandRoute(server, {
        useCases: createPublicStorefrontBrandUseCases({ transactions }),
      });
      registerResourceManagementRoute(server, {
        allowedOrigin,
        useCases: createResourceManagementUseCases({
          transactions: persistence.resourceManagementTransactionManager,
          tokenPepper,
          storage,
          inspector: createMediaSourceInspector({
            storage,
            now: () => new Date(),
          }),
        }),
      });
      await server.listen({ host: "127.0.0.1", port: 0 });
      const base = server.listeningOrigin;
      const post = async (url, body, key = randomUUID(), headers = {}) => {
        const result = await fetch(`${base}${url}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: allowedOrigin,
            cookie: `__Host-fan-admin-session=${token}`,
            "x-csrf-token": csrf,
            "idempotency-key": key,
            ...headers,
          },
          body: JSON.stringify({ schemaVersion: 1, ...body }),
        });
        return { status: result.status, body: await result.json() };
      };
      const brand = (name, body = {}, key) =>
        post(`/api/v1/admin/storefront-brand/${name}`, body, key);
      const readPublic = async () => {
        const result = await fetch(
          `${base}/api/v1/storefront/storefront-brand`,
        );
        check(result.status === 200, "public brand HTTP success");
        return result.json();
      };
      check(
        (await readPublic()).source === "DEFAULT",
        "legacy site defaults without logos",
      );
      check(
        (
          await post("/api/v1/admin/storefront-brand/read", {}, randomUUID(), {
            origin: "https://foreign.example.test",
          })
        ).status === 403,
        "foreign origin denied",
      );
      const raw = Buffer.from([
        255, 0, 0, 0, 0, 0, 255, 127, 0, 255, 0, 255, 255, 255, 255, 255,
      ]);
      const bytes = await sharp(raw, {
        raw: { width: 4, height: 1, channels: 4 },
      })
        .png()
        .toBuffer();
      stage = "normal upload grant";
      const source = {
        expectedVersion: 0,
        reasonCode: "STOREFRONT_BRAND",
        checksumSha256: createHash("sha256").update(bytes).digest("hex"),
        mimeType: "image/png",
        byteSize: bytes.length,
        rightsReference: "STOREFRONT_BRAND",
      };
      const upload = await post(
        "/api/v1/admin/resources/uploads/begin",
        source,
      );
      check(
        upload.status === 200,
        `upload grant ${upload.status} ${upload.body.code ?? ""}`,
      );
      const transfer = await fetch(upload.body.grant.url, {
        method: "PUT",
        headers: upload.body.grant.headers,
        body: bytes,
      });
      check(transfer.ok, "real S3 signed source upload");
      const prepareKey = randomUUID();
      stage = "logo processing and persistence";
      const prepared = await brand(
        "prepare",
        { uploadId: upload.body.uploadId },
        prepareKey,
      );
      check(
        prepared.status === 200,
        `prepare ${prepared.status} ${prepared.body.code ?? ""}`,
      );
      const logo = prepared.body.logo;
      check(
        logo.width === 4 && logo.height === 1,
        "logo aspect and no upscaling",
      );
      const replay = await brand(
        "prepare",
        { uploadId: upload.body.uploadId },
        prepareKey,
      );
      check(
        replay.body.replayed && replay.body.logo.assetId === logo.assetId,
        "prepare idempotency",
      );
      check(
        (await brand("prepare", { uploadId: randomUUID() }, prepareKey)).body
          .code === "IDEMPOTENCY_CONFLICT",
        "prepare key binds source",
      );
      const asset = (
        await client.query(
          "SELECT * FROM storefront_brand_logo_assets WHERE id=$1",
          [logo.assetId],
        )
      ).rows[0];
      const download = await storage.createDownloadGrant({
        schemaVersion: 1,
        operation: "CREATE_DOWNLOAD_GRANT",
        storageClass: "DERIVATIVE",
        objectKey: asset.object_key,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
      check(download.outcome === "SUCCESS", "read processed object");
      const downloaded = await fetch(download.value.url, {
        headers: download.value.headers,
      });
      const output = Buffer.from(await downloaded.arrayBuffer());
      const decoded = await sharp(output).ensureAlpha().raw().toBuffer();
      check(
        decoded[3] === 0 && decoded[7] === 127,
        "transparent and translucent alpha preserved through S3",
      );
      const configBrand = {
        schemaVersion: 1,
        lightLogoAssetId: logo.assetId,
        darkLogoAssetId: null,
      };
      const saved = await brand("draft", {
        expectedVersion: 0,
        brand: configBrand,
      });
      check(
        saved.status === 200,
        `save draft ${saved.status} ${saved.body.code ?? ""}`,
      );
      check(
        (await readPublic()).brand.lightLogo === null,
        "draft asset never published automatically",
      );
      const first = await brand("publish", {
        expectedVersion: 1,
        draftRevisionId: saved.body.state.draft.revisionId.toUpperCase(),
      });
      check(
        first.status === 200,
        `publish ${first.status} ${first.body.code ?? ""}`,
      );
      const publicValue = await readPublic();
      check(
        publicValue.brand.lightLogo.assetId === logo.assetId &&
          publicValue.brand.darkLogo === null,
        "published exact slot only",
      );
      check(
        publicValue.brand.lightLogo.url.startsWith(
          `${publicMediaBaseUrl}/processed/v1/`,
        ),
        "configured CDN prefix maintained",
      );
      const publishId = first.body.state.published.publicationId;
      const empty = {
        schemaVersion: 1,
        lightLogoAssetId: null,
        darkLogoAssetId: null,
      };
      const concurrent = await Promise.all([
        brand("draft", { expectedVersion: 2, brand: empty }),
        brand("draft", { expectedVersion: 2, brand: configBrand }),
      ]);
      check(
        concurrent.filter((r) => r.status === 200).length === 1 &&
          concurrent.filter((r) => r.body.code === "STALE_VERSION").length ===
            1,
        "concurrent draft CAS has one winner",
      );
      const current = concurrent.find((r) => r.status === 200).body.state;
      const removedDraft = await brand("draft", {
        expectedVersion: 3,
        brand: empty,
      });
      check(removedDraft.status === 200, "save empty slots");
      const removed = await brand("publish", {
        expectedVersion: 4,
        draftRevisionId: removedDraft.body.state.draft.revisionId,
      });
      check(
        removed.status === 200 && (await readPublic()).brand.lightLogo === null,
        "published removal falls back to text",
      );
      const restored = await brand("restore", {
        expectedVersion: 5,
        publicationId: publishId.toUpperCase(),
      });
      check(
        restored.status === 200 &&
          (await readPublic()).brand.lightLogo.assetId === logo.assetId,
        "restore old ready asset",
      );
      const history = await brand("history", { page: 1, pageSize: 20 });
      check(history.body.entries.length === 3, "immutable publication history");
      check(
        (
          await brand("draft", {
            expectedVersion: 6,
            brand: { ...empty, lightLogoAssetId: randomUUID() },
          })
        ).body.outcome === "FAILURE",
        "unregistered logo rejected",
      );
      check(
        (await readPublic()).publicationId ===
          restored.body.state.published.publicationId,
        "invalid save preserves published logo",
      );
      // A forged audit may not be used to create a revision, even with valid media references.
      const forgedAudit = randomUUID(),
        forgedRevision = randomUUID(),
        forgedRequest = randomUUID();
      await client.query("BEGIN");
      try {
        await client.query(
          "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,request_id,correlation_id,outcome,created_at) VALUES($1,'ADMIN',$2,'STOREFRONT_BRAND_SAVE_DRAFT','STOREFRONT_BRAND',$3,$4,$4,'SUCCEEDED',transaction_timestamp())",
          [forgedAudit, actorId, randomUUID(), forgedRequest],
        );
        await client.query(
          "INSERT INTO storefront_brand_revisions(id,brand,actor_id,session_id,request_id,audit_log_id,created_at) VALUES($1,$2::jsonb,$3,$4,$5,$6,transaction_timestamp())",
          [
            forgedRevision,
            JSON.stringify(configBrand),
            actorId,
            sessionId,
            forgedRequest,
            forgedAudit,
          ],
        );
        await assert.rejects(
          client.query("SET CONSTRAINTS ALL IMMEDIATE"),
          /exact audit/u,
        );
        checks++;
      } finally {
        await client.query("ROLLBACK");
      }
      const freshUpload = await post(
        "/api/v1/admin/resources/uploads/begin",
        source,
      );
      check(
        freshUpload.status === 200,
        "new source reserved for authorization race",
      );
      const freshTransfer = await fetch(freshUpload.body.grant.url, {
        method: "PUT",
        headers: freshUpload.body.grant.headers,
        body: bytes,
      });
      check(freshTransfer.ok, "authorization race uses actual S3 bytes");
      revokeAfterProcessing = true;
      const revoked = await brand("prepare", {
        uploadId: freshUpload.body.uploadId,
      });
      check(
        revoked.status === 401,
        "session revoked during processing prevents ready registration",
      );
      check(
        (await readPublic()).publicationId ===
          restored.body.state.published.publicationId,
        "revoked preparation preserves public logo",
      );
      for (const table of [
        "storefront_brand_logo_assets",
        "storefront_brand_revisions",
        "storefront_brand_publications",
        "storefront_brand_receipts",
      ]) {
        await assert.rejects(client.query(`DELETE FROM ${table}`));
        checks++;
      }
      await assert.rejects(
        migrate({ direction: "down", confirmVersion: "0064" }),
        /migration 0064 down failed/u,
      );
      checks++;
      check(
        (await client.query("SELECT max(version) AS v FROM schema_migrations"))
          .rows[0].v === "0064",
        "history blocks downgrade without losing head",
      );
      check(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM storefront_brand_logo_assets",
          )
        ).rows[0].n === 1,
        "one immutable processed asset survives all revisions",
      );
      check(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM storefront_theme_revisions",
          )
        ).rows[0].n === 0,
        "old theme chain untouched",
      );
      console.log(
        JSON.stringify({
          outcome: "PASS",
          checks,
          migrationHead: "0064",
          storage: "actual S3 signed PUT and GET",
          transport: "HTTP",
          unusedDraftVersion: current.version,
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          outcome: "FAILURE",
          stage,
          errorName: error.name,
          message: error.message,
        }),
      );
      throw error;
    } finally {
      await server?.close();
      await persistence?.close();
      await client.end();
    }
  });
}
