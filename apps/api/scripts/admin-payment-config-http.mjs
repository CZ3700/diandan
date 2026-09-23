#!/usr/bin/env node
import assert from "node:assert/strict";
import process from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
import { withOrderAccessFixture } from "./order-access-runtime.mjs";
import { createOrderPaymentProtocolClient } from "./order-payment-client.mjs";
import { createAdminPaymentConfigurationFixture } from "./admin-payment-config-fixture.mjs";
import { verifyAdminPaymentConfigurationProtocol } from "./admin-payment-config-protocol.mjs";
import { observeFinancePostgres } from "./admin-finance-diagnostics.mjs";
import { withNativeFinancePostgres } from "./admin-finance-native-postgres.mjs";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const safeError = (error) => ({
  name: /^[A-Za-z]{1,64}$/u.test(error?.name ?? "") ? error.name : null,
  code: /^[A-Z0-9_]{1,64}$/u.test(error?.code ?? "") ? error.code : null,
  frames: String(error?.stack ?? "")
    .split("\n")
    .slice(1, 8)
    .map(
      (line) =>
        /\/(?:apps|packages)\/[A-Za-z0-9_./-]+:\d+:\d+/u.exec(line)?.[0],
    )
    .filter(Boolean),
});
async function run(database, s3, ui, postgresEnvironment) {
  const restoreDiagnostics = observeFinancePostgres();
  const output = path.join(
    workspaceRoot,
    "output/checks/p5-05-payment-configuration",
    `integration-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  await mkdir(output, { recursive: true, mode: 0o700 });
  let assertions = 0,
    setupAssertions = 0,
    status = "FAIL",
    stage = "seed";
  const check = (condition, label) => {
    assertions++;
    if (!condition) stage = label;
    assert.ok(condition, label);
  };
  const progress = (value) => {
    stage = value;
    console.log(`Admin payment configuration: ${value}`);
  };
  const save = (name, value) =>
    writeFile(path.join(output, name), JSON.stringify(value, null, 2) + "\n");
  try {
    await withOrderAccessFixture({
      database,
      s3,
      workspaceRoot,
      output,
      check,
      progress,
      verify: async (original) => {
        const context = { ...original, workspaceRoot };
        setupAssertions = assertions;
        progress(
          "actual OIDC, deployed connectors and two independent API processes",
        );
        const payment = createOrderPaymentProtocolClient(context),
          runtime = await createAdminPaymentConfigurationFixture(context);
        payment.canaries.forEach(runtime.registerSecret);
        progress("versioned configuration HTTP publication and rollback");
        const start = assertions,
          protocol = await verifyAdminPaymentConfigurationProtocol(
            context,
            runtime,
            payment,
          );
        await save("protocol.json", {
          schemaVersion: 1,
          status: "PASS",
          ...protocol,
          manager: undefined,
          assertions: assertions - start,
        });
        let browser;
        if (ui) {
          progress("seven-language payment configuration browser");
          await runtime.startBrowser();
          const { verifyAdminPaymentConfigurationBrowser } =
            await import("./admin-payment-config-browser.mjs");
          browser = await verifyAdminPaymentConfigurationBrowser({
            ...runtime,
            output,
            check,
            fixture: {
              configuration: runtime.configurationDocument(),
              accountId: runtime.normalizedAccountId,
              legacyAccountId: runtime.legacyAccountId,
            },
            observePublication: runtime.waitForGeneration,
          });
          await save("browser.json", browser);
        }
        await runtime.assertPrivacy();
        check(
          payment.canaries.every(
            (value) => !context.logLines.some((line) => line.includes(value)),
          ),
          "all process logs exclude private fan data",
        );
        await save("scope.json", {
          schemaVersion: 1,
          postgresEnvironment,
          actualPostgres: true,
          actualTlsOidc: true,
          actualTlsS3: true,
          independentApiProcesses: 2,
          realGatewayAdapter: true,
          independentPersistentTestPsp: true,
          actualPspSandbox: false,
          realMoney: false,
          browser: Boolean(browser),
        });
      },
    });
    status = "PASS";
    console.log(`PASS admin payment configuration ${assertions}; ${output}`);
  } catch (error) {
    await save("failure.json", { stage, assertions, ...safeError(error) });
    console.error(
      `Admin payment configuration failure ${JSON.stringify({ stage, ...safeError(error) })}`,
    );
    throw error;
  } finally {
    restoreDiagnostics();
    await save("run-result.json", {
      status,
      assertions,
      setupAssertions,
      scenarioAssertions: assertions - setupAssertions,
      stage,
      completedAt: new Date().toISOString(),
    });
  }
}
try {
  if (process.argv[2]?.startsWith("--run-admin-payment-config")) {
    const ui = process.argv[2].endsWith("-ui");
    if (ui) await import("./admin-access-test-dns.mjs");
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    const nativeBin = process.env.ADMIN_PAYMENT_CONFIG_TEST_POSTGRES_BIN;
    if (nativeBin)
      await withNativeFinancePostgres(
        (database, metadata) =>
          run(database, s3, ui, {
            kind: "NATIVE_ISOLATED_TEST",
            serverVersion: metadata.serverVersion,
            configuredBy: "ADMIN_PAYMENT_CONFIG_TEST_POSTGRES_BIN",
          }),
        { binDirectory: nativeBin },
      );
    else
      await withEphemeralPostgres((database, metadata) =>
        run(database, s3, ui, metadata),
      );
  } else
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: process.argv.includes("--ui")
          ? "--run-admin-payment-config-ui"
          : "--run-admin-payment-config",
        timeoutMs: 1200000,
      }),
    );
} catch (error) {
  console.error(
    `FAIL admin payment configuration ${JSON.stringify(safeError(error))}`,
  );
  process.exitCode = 1;
}
