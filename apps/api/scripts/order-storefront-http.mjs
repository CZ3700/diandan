#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
import { withOrderAccessFixture } from "./order-access-runtime.mjs";
import { createPaymentRuntimeNext } from "./payment-runtime-next.mjs";
import { createOrderStorefrontGateway } from "./order-storefront-gateway.mjs";
import { createOrderStorefrontOrders } from "./order-storefront-fixture.mjs";
import { verifyOrderStorefrontBrowser } from "./order-storefront-browser.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const safeFailure = (error) => ({
  kind: error?.name === "AssertionError" ? "ASSERTION" : "RUNTIME",
  name: /^[A-Za-z]{1,64}$/u.test(error?.name ?? "") ? error.name : null,
  code: /^[A-Z0-9_]{1,64}$/u.test(error?.code ?? "") ? error.code : null,
  strictLocator: error?.message?.includes("strict mode violation") === true,
  timeout: error?.name === "TimeoutError",
  callsites: [
    ...(error?.stack ?? "").matchAll(/order-storefront-[a-z-]+\.mjs:\d+:\d+/gu),
  ].map((match) => match[0]),
});

export async function runOrderStorefront(database, s3) {
  const output = path.join(
    workspaceRoot,
    "output/checks/p4-05-order-storefront",
    `run-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  await mkdir(output, { recursive: true });
  const save = (name, value) =>
    writeFile(path.join(output, name), JSON.stringify(value, null, 2) + "\n");
  let assertions = 0,
    stage = "seed",
    status = "FAIL",
    browserStarted = false;
  const check = (condition, label) => {
    assertions++;
    if (!condition) stage = label;
    assert.ok(condition, label);
  };
  const progress = (value) => {
    stage = value;
    console.log(`Order storefront: ${stage}`);
  };
  try {
    await withOrderAccessFixture({
      database,
      s3,
      workspaceRoot,
      output,
      check,
      progress,
      verify: async (context) => {
        await save("fixture-manifest.json", {
          ...context.manifest,
          profiles: context.profiles,
          paymentConfiguration: context.published,
          actualPspSandbox: false,
        });
        progress(
          "create genuine paid historical orders through normal TEST commerce",
        );
        const orders = await createOrderStorefrontOrders(context);
        const proxy = await createOrderStorefrontGateway({
          fallbackBase: context.proxy.origin,
          accessBase: context.accessBase,
        });
        context.own("order browser API gateway", () => proxy.close());
        const edge = await createOrderStorefrontGateway({
          fallbackBase: context.proxy.origin,
        });
        context.own("order browser response loss boundary", () => edge.close());
        const next = createPaymentRuntimeNext({
          ...context,
          proxy,
          storefront: {
            attach(base) {
              edge.attach(base);
              context.storefront.attach(edge.origin);
            },
          },
        });
        context.own("production Next order storefront", () => next.stop());
        progress(
          "compile and serve production Next for actual order browser matrix",
        );
        await next.start();
        const setupAssertions = assertions;
        browserStarted = true;
        const report = await verifyOrderStorefrontBrowser({
          ...context,
          ...orders,
          edge,
        });
        await save("protocol-results.json", {
          schemaVersion: 1,
          status: "PASS",
          setupAssertions,
          browserAssertions: assertions - setupAssertions,
          cases: report.cases.length,
          actualPspSandbox: false,
        });
        await save("gateway-observations.json", {
          api: proxy.observations(),
          next: edge.observations(),
        });
      },
    });
    status = "PASS";
    console.log(`PASS order storefront ${assertions} assertions; ${output}`);
  } catch (error) {
    await save("failure.json", {
      schemaVersion: 1,
      status: "FAIL",
      stage,
      assertions,
      ...safeFailure(error),
    });
    throw error;
  } finally {
    await save("run-result.json", {
      schemaVersion: 1,
      status,
      assertions,
      ownedFixtureCleanupAttempted: true,
      browserStarted,
      completedAt: new Date().toISOString(),
    });
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    assert.ok(
      process.argv.length === 2 ||
        (process.argv.length === 3 &&
          process.argv[2] === "--run-order-storefront"),
      "Unknown order storefront option",
    );
    if (process.argv[2] === "--run-order-storefront") {
      const s3 = readEphemeralS3Config();
      await prepareEphemeralS3Buckets(s3);
      await withEphemeralPostgres((database) =>
        runOrderStorefront(database, s3),
      );
    } else
      await withEphemeralS3((context) =>
        runS3IntegrationChild({
          ...context,
          scriptUrl: import.meta.url,
          argument: "--run-order-storefront",
          timeoutMs: 1_200_000,
        }),
      );
  } catch (error) {
    console.error(
      `FAIL order storefront ${JSON.stringify(safeFailure(error))}`,
    );
    process.exitCode = 1;
  }
}
