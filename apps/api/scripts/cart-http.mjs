#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { createStructuredLogger } from "@fan-support/observability";
import {
  createCatalogDirectoryUseCases,
  createPublishedGiftCommerceUseCases,
} from "@fan-support/application";
import {
  createPostgresPersistence,
  withEphemeralPostgres,
  runMigrations,
} from "@fan-support/persistence-postgres";
import { createApiApplication } from "../dist/bootstrap.js";
import {
  createTestAdminWorkspaceComposition,
  createTestContentAuthoringComposition,
  createTestBaseContentComposition,
  createTestAdminContentComposition,
  createTestResourceManagementComposition,
  createTestPublicationPreflightComposition,
  createTestPublicationRuntimeComposition,
  createTestGiftCommerceComposition,
} from "../dist/index.js";
import { createWorkerMediaProcessingComposition } from "../../worker/dist/media-processing-composition.js";
import { createMediaProcessingWorkerRuntime } from "../../worker/dist/media-processing-runtime.js";
import {
  publicationMediaEnvironment,
  createPublicationMediaFixture,
} from "./publication-runtime-http-media.mjs";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";
import { giftCommerceExtension } from "./gift-commerce-http-fixtures.mjs";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
import {
  createStorefrontFixtureIdentity,
  createStorefrontContentClient,
} from "./storefront-content-client.mjs";
import {
  createStorefrontMediaGateway,
  createStorefrontMediaPublisher,
} from "./storefront-media-fixtures.mjs";
import { seedGiftStorefront } from "./gift-storefront-fixtures.mjs";
import { createTestCartRuntimeComposition } from "../dist/cart-composition.js";
import { createCartHttpTestKms } from "./cart-http-kms.mjs";
import { verifyCartRuntimeRollbackProtection } from "../../../packages/persistence-postgres/scripts/cart-runtime-rollback-proof.mjs";
import { verifyCartHttpDaily } from "./cart-http-daily.mjs";
import { verifyCartHttpProtocol } from "./cart-http-protocol.mjs";
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const output = path.join(
  workspaceRoot,
  "output/checks/p4-01-cart",
  `http-${new Date().toISOString().replaceAll(":", "-")}`,
);
const originalQuery = Client.prototype.query;
const pendingCartClients = new WeakSet();
const cartCommitProbe = `SELECT count(*)::int AS new_items,
  bool_and(intent.id IS NOT NULL) AS intent_exists,
  bool_and(event.id IS NOT NULL) AS event_exists,
  bool_and(event.aggregate_version=cart.version) AS event_version_matches,
  bool_and(event.locale=cart.presentation_locale) AS event_locale_matches,
  bool_and(event.occurred_at=item.created_at) AS event_time_matches,
  bool_and(event.request_id=item.request_id AND event.correlation_id=item.correlation_id) AS event_request_matches,
  bool_and(intent.display_mode=item.display_mode AND (intent.fan_message_ciphertext IS NOT NULL)=item.has_fan_message) AS privacy_matches,
  bool_and(intent.moderation_status='PENDING' AND intent.moderation_decision_kind IS NULL) AS pending_without_decision,
  bool_and(EXISTS(SELECT 1 FROM public.gift_variant_idol_eligibility eligibility WHERE eligibility.gift_variant_id=item.gift_variant_id AND eligibility.idol_id=intent.idol_id)
    OR EXISTS(SELECT 1 FROM public.gift_variant_recipient_rules rule WHERE rule.gift_variant_id=item.gift_variant_id AND rule.rule='ALL_ACTIVE_ARTISTS')) AS recipient_rule_matches
  FROM public.cart_items item JOIN public.carts cart ON cart.id=item.cart_id
  LEFT JOIN public.support_intents intent ON intent.cart_item_id=item.id
  LEFT JOIN public.outbox_events event ON event.event_type='CART_ITEM_ADDED' AND event.aggregate_id=cart.id AND event.secondary_subject_id=item.id
  WHERE item.created_at=transaction_timestamp()`;
Client.prototype.query = function (...arguments_) {
  const sql =
    typeof arguments_[0] === "string" ? arguments_[0] : arguments_[0]?.text;
  if (
    typeof sql === "string" &&
    /^\s*INSERT INTO public\.cart_items\(/iu.test(sql)
  )
    pendingCartClients.add(this);
  if (sql === "ROLLBACK") pendingCartClients.delete(this);
  let matrix;
  const result =
    sql === "COMMIT" && pendingCartClients.has(this)
      ? (async () => {
          pendingCartClients.delete(this);
          matrix = (await originalQuery.call(this, cartCommitProbe)).rows[0];
          const result = await originalQuery.apply(this, arguments_);
          console.log(`Cart HTTP committed matrix ${JSON.stringify(matrix)}`);
          return result;
        })()
      : originalQuery.apply(this, arguments_);
  if (!result?.catch) return result;
  return result.catch((error) => {
    console.error(
      `Cart HTTP PostgreSQL ${JSON.stringify({ operation: sql === "COMMIT" ? "COMMIT" : "STATEMENT", guard: error?.message === "cart item and outbox record must commit together" ? "CART_OUTBOX" : error?.message === "outbox event has no exact authoritative source" ? "OUTBOX_SOURCE" : error?.message === "cart item and support intent privacy projection diverge" ? "CART_PRIVACY" : error?.message === "automated moderation must bind exact immutable evidence" ? "MODERATION_EVIDENCE" : "OTHER", code: typeof error?.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code) ? error.code : "OTHER", constraint: typeof error?.constraint === "string" && /^[a-z_]{1,128}$/u.test(error.constraint) ? error.constraint : null, ...(matrix ? { matrix } : {}) })}`,
    );
    throw error;
  });
};
let stage = "initialization";
function progress(value) {
  stage = value;
  console.log(`Cart HTTP fixture: ${value}`);
}
async function verify(database, s3) {
  let assertions = 0;
  const check = (condition, label) => {
    assertions++;
    if (!condition) stage = label;
    assert.ok(condition, label);
  };
  const start = globalThis.performance.now();
  await mkdir(output, { recursive: true });
  await runMigrations({
    clientConfig: database,
    workspaceRoot,
    command: { direction: "up" },
  });
  const client = new Client(database);
  client.on("error", () => undefined);
  await client.connect();
  let app, worker, persistence, gateway;
  const kms = createCartHttpTestKms();
  const runtimes = [];
  try {
    const reserved = createServer();
    await new Promise((resolve) => reserved.listen(0, "127.0.0.1", resolve));
    const sitePort = reserved.address().port;
    await new Promise((resolve, reject) =>
      reserved.close((error) => (error ? reject(error) : resolve())),
    );
    const origin = `http://localhost:${sitePort}`;
    const identity = await createStorefrontFixtureIdentity(client);
    await giftCommerceExtension.seed({
      client,
      identities: identity.identities,
      check,
    });
    gateway = await createStorefrontMediaGateway({
      s3,
      configPath: process.env.FAN_SUPPORT_MEDIA_S3_TEST_CONFIG,
    });
    const media = createPublicationMediaFixture(s3);
    const common = {
      environment: "TEST",
      database,
      tokenPepper: identity.tokenPepper,
      allowedOrigin: origin,
    };
    const logLines = [];
    const logger = createStructuredLogger({
      service: "api",
      write: (value) => logLines.push(value),
    });
    const environment = {
      ...publicationMediaEnvironment(preflightEnvironment(database), s3),
      FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN: gateway.origin,
    };
    persistence = createPostgresPersistence(database, {
      catalogPublicMediaBaseUrl: gateway.origin,
    });
    const compositions = [
      createTestCartRuntimeComposition({
        environment: "TEST",
        database,
        allowedOrigin: origin,
        publicMediaBaseUrl: gateway.origin,
        keyManagement: kms.adapter,
        activePepperVersion: "test-mac",
        pepperVersions: ["test-mac"],
      }),
      createTestAdminWorkspaceComposition({
        ...common,
        publicMediaBaseUrl: gateway.origin,
        storage: media.storage,
      }),
      createTestContentAuthoringComposition(common),
      createTestBaseContentComposition(common),
      createTestAdminContentComposition(common),
      createTestResourceManagementComposition({ ...common, ...media }),
      createTestPublicationPreflightComposition(common),
      createTestPublicationRuntimeComposition({
        ...common,
        publicMediaBaseUrl: gateway.origin,
      }),
      createTestGiftCommerceComposition({
        ...common,
        publicMediaBaseUrl: gateway.origin,
      }),
    ];
    for (const composition of compositions)
      for (const [key, value] of Object.entries(composition))
        if (key.endsWith("Runtime") || key.endsWith("Lifecycle"))
          runtimes.push(value);
    app = await createApiApplication(
      environment,
      Object.assign(
        {
          logger,
          catalogDirectoryRoute: createCatalogDirectoryUseCases({
            transactions: persistence.contentReadTransactionManager,
          }),
          publishedGiftCommerceRoute: {
            useCases: createPublishedGiftCommerceUseCases({
              transactions: persistence.publishedGiftCommerceTransactionManager,
            }),
          },
        },
        ...compositions,
      ),
    );
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    let workerRuntime;
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
    const content = createStorefrontContentClient({
      base,
      origin,
      credentials: identity.credentials,
      check,
    });
    const provenance = [];
    const publishMedia = createStorefrontMediaPublisher({
      content,
      workerRuntime,
      client,
      gateway,
      check,
      provenance,
    });
    const fixtures = await seedGiftStorefront({
      workspaceRoot,
      content,
      publishMedia,
      client,
      check,
      progress,
    });
    progress(
      "real cart initialization, encrypted add and stable-session replay",
    );
    const protocol = await verifyCartHttpProtocol({
      base,
      origin,
      fixtures,
      client,
      gateway,
      kms,
      logLines,
      check,
    });
    await writeFile(
      path.join(output, "protocol-results.json"),
      JSON.stringify({ schemaVersion: 1, status: "PASS", protocol }, null, 2) +
        "\n",
    );
    progress("existing pending intents reject unsafe moderation rollback");
    const pendingRollback = await verifyCartRuntimeRollbackProtection({
      clientConfig: database,
      workspaceRoot,
      mode: "PENDING",
    });
    await writeFile(
      path.join(output, "pending-rollback-results.json"),
      JSON.stringify(pendingRollback, null, 2) + "\n",
    );
    progress("normal daily publisher and unsafe migration rollback protection");
    const daily = await verifyCartHttpDaily({
      output,
      persistence,
      base,
      origin,
      database,
      client,
      identity,
      media,
      gateway,
      workspaceRoot,
      content,
      fixtures,
      check,
    });
    const result = {
      daily,
      pendingRollback,
      schemaVersion: 1,
      status: "PASS",
      scope:
        "Real PostgreSQL, HTTP, normal published catalog and TLS S3; actual KMS adapter with TEST-local remote KMS boundary; no browser, AWS KMS or production acceptance",
      assertions,
      setupApiRequests: content.requestCount(),
      durationMs: Math.round(globalThis.performance.now() - start),
      protocol,
      mediaProvenance: provenance,
      servedDerivatives: gateway.evidence(),
    };
    await writeFile(
      path.join(output, "results.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(
      `PASS cart HTTP (${assertions} assertions, ${result.setupApiRequests} setup requests)`,
    );
  } catch (error) {
    await writeFile(
      path.join(output, "failure.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          status: "FAIL",
          stage,
          kind: error?.name === "AssertionError" ? "ASSERTION" : "RUNTIME",
          code:
            typeof error?.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code)
              ? error.code
              : null,
        },
        null,
        2,
      ) + "\n",
    );
    throw error;
  } finally {
    const cleanup = [
      () => worker?.stop(),
      () =>
        app
          ? app.close()
          : Promise.all(runtimes.map((runtime) => runtime.stop())),
      () => gateway?.close(),
      () => persistence?.close(),
      () => client.end(),
      () => kms.close(),
    ];
    const failures = [];
    for (const close of cleanup) {
      try {
        await close();
      } catch {
        failures.push("OWNED_RESOURCE_CLOSE_FAILED");
      }
    }
    if (failures.length)
      await Promise.reject(new Error("Cart HTTP cleanup failed"));
  }
}
try {
  if (process.argv.includes("--run-cart-http")) {
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    await withEphemeralPostgres((database) => verify(database, s3));
  } else if (process.argv.length === 2) {
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: "--run-cart-http",
        timeoutMs: 1200000,
      }),
    );
  } else throw new TypeError("Unsupported cart HTTP option");
} catch (error) {
  console.error(
    `FAIL cart HTTP at ${stage}; kind=${error?.name === "AssertionError" ? "ASSERTION" : "RUNTIME"}`,
  );
  process.exitCode = 1;
}
