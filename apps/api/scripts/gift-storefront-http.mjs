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
} from "../dist/testing/index.js";
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
import { verifyGiftStorefrontProtocol } from "./gift-storefront-protocol.mjs";
import { verifyGiftStorefrontScoped } from "./gift-storefront-scoped.mjs";
import {
  createGiftStorefrontFaultGateway,
  createGiftStorefrontNext,
} from "./gift-storefront-next.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const output = path.join(
  workspaceRoot,
  "output/playwright/p3-05-gift-storefront",
);
// SQL diagnostics retain only stable error codes and known operation labels, never SQL or parameters.
const originalQuery = Client.prototype.query;
Client.prototype.query = function query(...arguments_) {
  const returned = originalQuery.apply(this, arguments_);
  if (!returned?.catch) return returned;
  return returned.catch((error) => {
    const query =
      typeof arguments_[0] === "string" ? arguments_[0] : arguments_[0]?.text;
    const operation =
      typeof query !== "string"
        ? "OTHER"
        : query.includes("array_agg(currency")
          ? "STOREFRONT_MARKETS"
          : query.includes("SELECT policy.policy_key")
            ? "STOREFRONT_POLICIES"
            : query.includes("witness_id")
              ? "STOREFRONT_VARIANT_FACTS"
              : query === "COMMIT"
                ? "COMMIT"
                : "OTHER";
    console.error(
      `Gift storefront PostgreSQL ${JSON.stringify({ operation, code: typeof error?.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code) ? error.code : "OMITTED", constraint: typeof error?.constraint === "string" && /^[a-z_]+$/u.test(error.constraint) ? error.constraint : "OMITTED" })}`,
    );
    throw error;
  });
};
let stage = "initialization";
function progress(value) {
  stage = value;
  console.log(`Gift storefront fixture: ${value}`);
}

async function verify(
  database,
  s3,
  { serve = false, ui = false, production = false } = {},
) {
  let assertions = 0;
  const check = (condition, label) => {
    assertions++;
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
  let app, worker, persistence, gateway, proxy, next;
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
    const logger = createStructuredLogger({
      service: "api",
      write: () => undefined,
    });
    const environment = {
      ...publicationMediaEnvironment(preflightEnvironment(database), s3),
      FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN: gateway.origin,
    };
    persistence = createPostgresPersistence(database, {
      catalogPublicMediaBaseUrl: gateway.origin,
    });
    const compositions = [
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
      "actual published directory, content, policy, price and stock protocol",
    );
    const protocol = await verifyGiftStorefrontProtocol({
      base,
      fixtures,
      gateway,
      check,
    });
    progress("actual scoped gift offers, recipients and commerce context");
    const scopedProtocol = await verifyGiftStorefrontScoped({
      base,
      fixtures,
      gateway,
      check,
    });
    const result = {
      schemaVersion: 1,
      status: "PASS",
      generatedAt: new Date().toISOString(),
      scope:
        "P3-05 real seed, published directory/content/policies, scoped offers and commerce context; browser verification is separate",
      environment:
        "Isolated TEST PostgreSQL / HTTP / TLS S3 / actual image worker; no Next or browser",
      assertions,
      setupApiRequests: content.requestCount(),
      durationMs: Math.round(globalThis.performance.now() - start),
      visibleGiftCount: fixtures.gifts.filter((gift) =>
        ["active", "paused"].includes(gift.status),
      ).length,
      artistCount: fixtures.artists.length,
      policyCount: fixtures.policies.length,
      actualPostgres: true,
      actualTlsS3: true,
      actualImageWorker: true,
      browserEvidence: false,
      physicalDeviceEvidence: false,
      productionReleaseEvidence: false,
      formalAssetApproval: false,
      syntheticMediaCompositions: provenance,
      servedDerivatives: gateway.evidence(),
      protocol,
      scopedProtocol,
    };
    await writeFile(
      path.join(output, "seed-protocol-results.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(
      `PASS gift storefront seed/public protocol (${assertions} assertions, ${content.requestCount()} setup API requests, ${result.durationMs} ms)`,
    );
    if (serve || ui || production) {
      const browserOutput = path.join(
        output,
        `run-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}`,
      );
      await mkdir(browserOutput, { recursive: true });
      proxy = await createGiftStorefrontFaultGateway(base);
      next = createGiftStorefrontNext({
        workspaceRoot,
        origin,
        proxy,
        gateway,
        output: browserOutput,
        production,
        check,
        secrets: [
          database.password,
          s3.secretAccessKey,
          s3.accessKeyId,
          identity.tokenPepper,
          ...Object.values(identity.credentials).flatMap((value) => [
            value.token,
            value.csrf,
          ]),
        ],
      });
      let attempt = 0,
        action = "run";
      while (action !== "stop") {
        if (action === "pause") {
          await next.stop();
          console.log(`GIFT_STOREFRONT_NEXT_PAUSED ownerPID=${process.pid}`);
        } else {
          try {
            assertions = result.assertions;
            const validateUi =
              action === "smoke" ? false : ui || action === "full";
            progress("starting actual owned Next storefront");
            await next.start();
            console.log(
              `LOCAL_GIFT_STOREFRONT_READY ${origin}/en/gifts ownerPID=${process.pid}`,
            );
            const module = await import(
              `./gift-storefront-browser.mjs?attempt=${++attempt}`
            );
            const browser = await module.verifyGiftStorefrontBrowser({
              origin,
              base,
              output: browserOutput,
              gateway,
              proxy,
              fixtures,
              check,
              ui: validateUi,
              attempt,
            });
            const evidence = {
              ...result,
              status: "PASS",
              scope: validateUi
                ? "P3-05 actual public protocol and real browser matrix"
                : "P3-05 actual public protocol and real browser smoke",
              environment: production
                ? "Production-compiled Next artifact under isolated TEST runtime"
                : "Local Next development runtime",
              browserEvidence: true,
              assertions,
              browser,
              servedDerivatives: gateway.evidence(),
              browserOutput,
              temporaryPreview: serve ? `${origin}/en/gifts` : null,
            };
            await writeFile(
              path.join(
                output,
                validateUi ? "results.json" : "smoke-results.json",
              ),
              JSON.stringify(evidence, null, 2) + "\n",
            );
            console.log(
              `PASS gift storefront ${validateUi ? "browser matrix" : "browser smoke"} (${assertions} assertions); ${browserOutput}`,
            );
          } catch (error) {
            if (!serve) throw error;
            console.error(
              `Gift storefront retained diagnostic ${JSON.stringify({ stage, name: error?.name, assertion: error?.name === "AssertionError" ? error.message : null })}`,
            );
          }
        }
        if (!serve) break;
        console.log(
          `GIFT_STOREFRONT_WAITING ${origin}/en/gifts ownerPID=${process.pid}; SIGUSR1 rebuilds owned Next and runs full browser matrix, SIGHUP rebuilds with smoke only, SIGUSR2 pauses owned Next, SIGTERM cleans up`,
        );
        action = await new Promise((resolve) => {
          const events = {
            SIGUSR1: "full",
            SIGHUP: "smoke",
            SIGUSR2: "pause",
            SIGTERM: "stop",
            SIGINT: "stop",
          };
          const handlers = Object.entries(events).map(([signal, value]) => [
            signal,
            () => {
              for (const [event, handler] of handlers)
                process.removeListener(event, handler);
              resolve(value);
            },
          ]);
          for (const [signal, handler] of handlers)
            process.once(signal, handler);
        });
      }
    }
    return result;
  } catch (error) {
    console.error(
      `Gift storefront inner failure ${JSON.stringify({
        stage,
        name: error?.name,
        code:
          typeof error?.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code)
            ? error.code
            : null,
        assertion: error?.name === "AssertionError" ? error.message : null,
        issues:
          error?.name === "ZodError"
            ? error.issues.map(({ code, path }) => ({ code, path }))
            : [],
        sourceFrames:
          typeof error?.stack === "string"
            ? [
                ...error.stack.matchAll(
                  /(?:gift-storefront-[\w-]+\.mjs|storefront-content-client\.mjs):\d+:\d+/gu,
                ),
              ].map(([frame]) => frame)
            : [],
      })}`,
    );
    throw error;
  } finally {
    await next?.stop();
    await worker?.stop();
    if (app) await app.close();
    else for (const runtime of runtimes) await runtime.stop();
    await gateway?.close();
    await proxy?.close();
    await persistence?.close();
    await client.end();
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const serve = process.argv.some((value) => value.includes("serve"));
    const ui = process.argv.some(
      (value) => value === "--ui" || value.includes("-ui"),
    );
    const production = process.argv.some((value) =>
      value.includes("production"),
    );
    if (
      process.argv.some((value) => value.startsWith("--run-gift-storefront"))
    ) {
      const s3 = readEphemeralS3Config();
      await prepareEphemeralS3Buckets(s3);
      await withEphemeralPostgres((database) =>
        verify(database, s3, { serve, ui, production }),
      );
    } else {
      await withEphemeralS3((context) =>
        runS3IntegrationChild({
          ...context,
          scriptUrl: import.meta.url,
          argument: `--run-gift-storefront${serve ? "-serve" : ""}${ui ? "-ui" : ""}${production ? "-production" : ""}`,
          timeoutMs: serve ? 6600000 : 1200000,
        }),
      );
    }
  } catch (error) {
    console.error(
      `FAIL gift storefront at ${stage}; name=${error?.name}; assertion=${error?.name === "AssertionError" ? error.message : "OMITTED"}; code=${typeof error?.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code) ? error.code : "NONE"}`,
    );
    process.exitCode = 1;
  }
}
