#!/usr/bin/env node
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { createStructuredLogger } from "@fan-support/observability";
import {
  createCatalogDirectoryUseCases,
  createStorefrontHomepageUseCases,
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
import { seedStorefrontCatalog } from "./storefront-catalog-fixtures.mjs";
import { createStorefrontBrowserVerifier } from "./storefront-browser.mjs";
import { verifyStorefrontProtocol } from "./storefront-protocol.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const output = path.join(workspaceRoot, "output/playwright/p3-04-storefront");
const originalQuery = Client.prototype.query;
Client.prototype.query = function query(...arguments_) {
  const result = originalQuery.apply(this, arguments_);
  if (!result?.catch) return result;
  return result.catch((error) => {
    const messages = new Map([
      [
        "management operation requires current active MFA session and causal time",
        "CATALOG_SESSION_TIME",
      ],
      [
        "management operation requires its current permission",
        "CATALOG_PERMISSION",
      ],
      [
        "management operation requires current locale scopes",
        "CATALOG_LOCALES",
      ],
    ]);
    console.error(
      `Storefront TEST PostgreSQL ${JSON.stringify({
        code:
          typeof error?.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code)
            ? error.code
            : "OMITTED",
        constraint:
          typeof error?.constraint === "string" &&
          /^[a-z_]+$/u.test(error.constraint)
            ? error.constraint
            : "OMITTED",
        knownGuard: messages.get(error?.message) ?? "OTHER",
        phase: arguments_[0] === "COMMIT" ? "COMMIT" : "STATEMENT",
      })}`,
    );
    throw error;
  });
};
let stage = "initialization";
function progress(value) {
  stage = value;
  console.log(`Storefront fixture: ${value}`);
}
async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}
async function closeServer(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

/** Faults are actual HTTP transport failures, never fabricated business data. */
async function createApiFaultGateway(base) {
  let failPath = null;
  const observed = [];
  const server = createServer(async (request, response) => {
    const parsed = new globalThis.URL(request.url, base);
    observed.push({
      path: parsed.pathname,
      q: parsed.searchParams.get("q"),
      anchor: parsed.searchParams.get("anchorId"),
      after: parsed.searchParams.has("after"),
    });
    if (failPath && parsed.pathname.startsWith(failPath)) {
      response.writeHead(503, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(
        JSON.stringify({
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "UNAVAILABLE",
        }),
      );
      return;
    }
    try {
      const upstream = await globalThis.fetch(parsed, {
        signal: globalThis.AbortSignal.timeout(30_000),
        redirect: "manual",
      });
      response.writeHead(
        upstream.status,
        Object.fromEntries(upstream.headers.entries()),
      );
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      response.writeHead(503, { "cache-control": "no-store" }).end();
    }
  });
  const port = await listen(server);
  return {
    origin: `http://127.0.0.1:${port}`,
    setFailure: (value) => {
      failPath = value;
    },
    observed,
    close: () => closeServer(server),
  };
}

export async function verifyStorefrontScenario(
  database,
  s3,
  { serve = false, ui = false, production = false } = {},
) {
  let assertions = 0;
  const check = (condition, label) => {
    assertions++;
    assert.ok(condition, label);
  };
  const provenance = [];
  const browserMode = serve || ui || production;
  await mkdir(output, { recursive: true });
  await runMigrations({
    clientConfig: database,
    workspaceRoot,
    command: { direction: "up" },
  });
  const client = new Client(database);
  client.on("error", () => undefined);
  await client.connect();
  let app, worker, next, browser, gateway, proxy, persistence;
  const runtimes = [];
  try {
    const reserved = createServer();
    const sitePort = await listen(reserved);
    await closeServer(reserved);
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
          storefrontHomepageRoute: {
            useCases: createStorefrontHomepageUseCases({
              transactions: persistence.storefrontHomepageTransactionManager,
            }),
          },
        },
        ...compositions,
      ),
    );
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    proxy = await createApiFaultGateway(base);
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
    if (browserMode) {
      progress("starting actual Next storefront");
      const nextEnvironment = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !key.startsWith("FAN_SUPPORT_"),
        ),
      );
      Object.assign(nextEnvironment, {
        NODE_ENV: production ? "test" : "development",
        FAN_SUPPORT_DEPLOYMENT_ENV: production ? "test" : "development",
        FAN_SUPPORT_SITE_ORIGIN: origin,
        FAN_SUPPORT_INTERNAL_API_ORIGIN: proxy.origin,
        FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN: gateway.origin,
        FAN_SUPPORT_STOREFRONT_NAME: "FAN SUPPORT",
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_OPTIONS: `${nextEnvironment.NODE_OPTIONS ?? ""} --import=${new globalThis.URL("./storefront-test-dns.mjs", import.meta.url).href}`,
      });
      const nextBinary = path.join(
        workspaceRoot,
        "apps/storefront/node_modules/next/dist/bin/next",
      );
      if (production) {
        progress("building production artifact for isolated TEST runtime");
        const build = spawn(process.execPath, [nextBinary, "build"], {
          cwd: path.join(workspaceRoot, "apps/storefront"),
          env: {
            ...nextEnvironment,
            NODE_ENV: "production",
            FAN_SUPPORT_DEPLOYMENT_ENV: "preview",
            FAN_SUPPORT_SITE_ORIGIN: "https://localhost:3443",
            FAN_SUPPORT_INTERNAL_API_ORIGIN: "http://api:3002",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        const buildLog = path.join(output, "next-production-build.log");
        await writeFile(buildLog, "");
        const buildOutput = (chunk) =>
          void appendFile(buildLog, chunk.toString());
        build.stdout.on("data", buildOutput);
        build.stderr.on("data", buildOutput);
        const [buildExitCode] = await once(build, "exit");
        check(
          buildExitCode === 0,
          "Next production artifact builds with strict preview configuration",
        );
      }
      next = spawn(
        process.execPath,
        [
          nextBinary,
          production ? "start" : "dev",
          "--hostname",
          "localhost",
          "--port",
          String(sitePort),
        ],
        {
          cwd: path.join(workspaceRoot, "apps/storefront"),
          env: nextEnvironment,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const nextLog = path.join(output, "next-local.log");
      await writeFile(nextLog, "");
      const secrets = [
        database.password,
        s3.secretAccessKey,
        s3.accessKeyId,
        identity.tokenPepper,
        ...Object.values(identity.credentials).flatMap((value) => [
          value.token,
          value.csrf,
        ]),
      ].filter(Boolean);
      const log = (chunk) => {
        let value = chunk.toString();
        for (const secret of secrets)
          value = value.replaceAll(secret, "[REDACTED_SECRET]");
        void appendFile(nextLog, value);
      };
      next.stdout.on("data", log);
      next.stderr.on("data", log);
      let ready = false;
      const deadline = globalThis.performance.now() + 90_000;
      while (
        globalThis.performance.now() < deadline &&
        next.exitCode === null
      ) {
        try {
          const response = await globalThis.fetch(`${origin}/healthz`, {
            signal: globalThis.AbortSignal.timeout(2000),
          });
          await response.body?.cancel();
          if (response.ok) {
            ready = true;
            break;
          }
        } catch {
          /* Actual Next health route is still compiling. */
        }
        await delay(200);
      }
      check(ready, "actual Next storefront starts");
      browser = await createStorefrontBrowserVerifier({
        origin,
        base,
        output,
        check,
        configPath: process.env.FAN_SUPPORT_MEDIA_S3_TEST_CONFIG,
        serve,
        ui,
        production,
        proxy,
        gateway,
      });
      await browser.verifyEmpty();
    }
    const publishMedia = createStorefrontMediaPublisher({
      content,
      workerRuntime,
      client,
      gateway,
      check,
      provenance,
    });
    const fixtures = await seedStorefrontCatalog({
      workspaceRoot,
      content,
      publishMedia,
      client,
      check,
      progress,
    });
    progress("actual public storefront protocol");
    const protocol = await verifyStorefrontProtocol({
      base,
      fixtures,
      content,
      gateway,
      check,
      mutate: !browserMode,
    });
    if (!browserMode) {
      const evidence = {
        schemaVersion: 1,
        status: "PASS",
        generatedAt: new Date().toISOString(),
        environment:
          "Isolated PostgreSQL / HTTP / TLS S3 / worker; no Next or browser",
        assertions,
        setupApiRequests: content.requestCount(),
        seededPublishedArtistCount: fixtures.artists.length,
        actualPostgres: true,
        actualTlsS3: true,
        actualImageWorker: true,
        browserEvidence: false,
        productionReleaseEvidence: false,
        formalAssetApproval: false,
        syntheticMediaCompositions: provenance,
        servedDerivatives: gateway.evidence(),
        protocol,
      };
      await writeFile(
        path.join(output, "http-results.json"),
        JSON.stringify(evidence, null, 2) + "\n",
      );
      console.log(
        `PASS storefront HTTP/PG/TLS S3 (${assertions} assertions, ${content.requestCount()} setup API requests, ${fixtures.artists.length} actual published artist fixtures)`,
      );
      return evidence;
    }
    if (serve)
      console.log(
        `LOCAL_STOREFRONT_READY ${origin}/en ownerPID=${process.pid}`,
      );
    progress("seven-language real storefront browsing");
    let attempts = 0;
    const setupAssertions = assertions;
    while (true) {
      try {
        await browser.verifyPublished(fixtures, content);
        break;
      } catch (error) {
        if (!serve) throw error;
        assertions = setupAssertions;
        console.log(
          `LOCAL_STOREFRONT_DIAGNOSTIC ${origin}/en ownerPID=${process.pid}; send SIGUSR1 to retry only the browser with current fixture source`,
        );
        const action = await new Promise((resolve) => {
          const retry = () => {
            process.removeListener("SIGTERM", stop);
            resolve("retry");
          };
          const stop = () => {
            process.removeListener("SIGUSR1", retry);
            resolve("stop");
          };
          process.once("SIGUSR1", retry);
          process.once("SIGTERM", stop);
        });
        if (action === "stop") throw error;
        await browser.close();
        const module = await import(
          `./storefront-browser.mjs?attempt=${++attempts}`
        );
        browser = await module.createStorefrontBrowserVerifier({
          origin,
          base,
          output,
          check,
          serve,
          ui,
          production,
          proxy,
          gateway,
        });
      }
    }
    const evidence = {
      schemaVersion: 1,
      status: "PASS",
      generatedAt: new Date().toISOString(),
      environment: production
        ? "Next production-compiled artifact under TEST runtime on local TEST services"
        : "Next development server on local TEST services",
      assertions,
      setupApiRequests: content.requestCount(),
      publishedArtistCount: fixtures.artists.length,
      actualPostgres: true,
      actualTlsS3: true,
      actualImageWorker: true,
      publicMediaGateway:
        "TEST loopback HTTPS proxy; exact known published derivative keys; S3 bytes and PostgreSQL checksums verified",
      physicalDeviceEvidence: false,
      productionReleaseEvidence: false,
      formalAssetApproval: false,
      syntheticMediaCompositions: provenance,
      servedDerivatives: gateway.evidence(),
      browser: browser.evidence(),
      protocol,
    };
    await writeFile(
      path.join(output, "results.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    console.log(
      `PASS storefront HTTP/PG/TLS S3/Next/Chrome (${assertions} assertions, ${content.requestCount()} setup API requests, ${fixtures.artists.length} real published artists)`,
    );
    if (serve) {
      console.log(`LOCAL_STOREFRONT_READY ${origin}/en`);
      await new Promise((resolve) => {
        process.once("SIGTERM", resolve);
        process.once("SIGINT", resolve);
      });
    }
    return evidence;
  } catch (error) {
    console.error(
      `Storefront scenario diagnostic ${JSON.stringify({ stage, name: error?.name, message: error?.name === "AssertionError" ? error.message : "OMITTED", code: typeof error?.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code) ? error.code : "NONE" })}`,
    );
    throw error;
  } finally {
    await browser?.close();
    if (next) {
      next.kill("SIGTERM");
      await Promise.race([once(next, "exit"), delay(5000)]);
      if (next.exitCode === null) next.kill("SIGKILL");
    }
    await worker?.stop();
    if (app) await app.close();
    else for (const runtime of runtimes) await runtime.stop();
    await proxy?.close();
    await gateway?.close();
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
    if (process.argv.some((value) => value.startsWith("--run-storefront"))) {
      const s3 = readEphemeralS3Config();
      await prepareEphemeralS3Buckets(s3);
      await withEphemeralPostgres((database) =>
        verifyStorefrontScenario(database, s3, { serve, ui, production }),
      );
    } else
      await withEphemeralS3((context) =>
        runS3IntegrationChild({
          ...context,
          scriptUrl: import.meta.url,
          argument: `--run-storefront${serve ? "-serve" : ""}${ui ? "-ui" : ""}${production ? "-production" : ""}`,
          timeoutMs: serve ? 3_600_000 : 1_800_000,
        }),
      );
  } catch (error) {
    console.error(
      `FAIL storefront at ${stage}; assertion=${error?.name === "AssertionError" ? error.message : "UNAVAILABLE"}; code=${typeof error?.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code) ? error.code : "UNAVAILABLE"}`,
    );
    process.exitCode = 1;
  }
}
