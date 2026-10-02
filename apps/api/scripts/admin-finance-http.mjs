#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
import { withOrderAccessFixture } from "./order-access-runtime.mjs";
import { createOrderPaymentProtocolClient } from "./order-payment-client.mjs";
import { createAdminFinanceFixture } from "./admin-finance-fixture.mjs";
import { verifyAdminFinanceProtocol } from "./admin-finance-protocol.mjs";
import { observeFinancePostgres } from "./admin-finance-diagnostics.mjs";
import { withFinanceTestDatabase } from "./admin-finance-test-database.mjs";
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
    "output/checks/p5-03-finance",
    `integration-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  await mkdir(output, { recursive: true, mode: 0o700 });
  let assertions = 0,
    stage = "seed",
    status = "FAIL",
    setupAssertions = 0;
  const check = (condition, label) => {
    assertions++;
    if (!condition) stage = label;
    assert.ok(condition, label);
  };
  const progress = (value) => {
    stage = value;
    console.log(`Admin finance: ${value}`);
  };
  const save = (name, value) =>
    writeFile(path.join(output, name), JSON.stringify(value, null, 2) + "\n");
  await save("postgres-environment.json", postgresEnvironment);
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
        progress("real OIDC and financial API composition");
        const payment = createOrderPaymentProtocolClient(context),
          runtime = await createAdminFinanceFixture(context, payment);
        if (process.argv[2] === "--run-admin-finance-auth") {
          progress("focused authentication reproduction");
          await runtime.startBrowser();
          const { verifyFinanceAuthentication } =
            await import("./admin-finance-auth-stress.mjs");
          await verifyFinanceAuthentication({ ...runtime, output, check });
          await runtime.assertPrivacy();
          return;
        }
        const protocol = await verifyAdminFinanceProtocol(
          context,
          runtime,
          payment,
        );
        await save("protocol.json", {
          schemaVersion: 1,
          status: "PASS",
          ...protocol,
          manager: undefined,
          assertions: assertions - setupAssertions,
        });
        const { verifySupportCertificateFinance } =
          await import("./support-certificate-finance-fixture.mjs");
        const certificates = await verifySupportCertificateFinance(context, {
          payment,
          runtime,
        });
        await save("certificate-finance.json", certificates);
        let browser;
        if (ui) {
          progress("seven-language management browser");
          const fixture = await runtime.createBrowserFixtures(
            protocol.manager,
            protocol.disputedOrderId,
          );
          await runtime.startBrowser();
          const { verifyAdminFinanceBrowser } =
            await import("./admin-finance-browser.mjs");
          browser = await verifyAdminFinanceBrowser({
            ...runtime,
            output,
            check,
            fixture,
          });
          await save("browser.json", browser);
        }
        await runtime.assertPrivacy();
        check(
          payment.canaries.every(
            (value) => !context.logLines.some((line) => line.includes(value)),
          ),
          "shared API and worker logs exclude personal message, nickname and email",
        );
        await save("scope.json", {
          schemaVersion: 1,
          actualPostgres: true,
          postgresEnvironment,
          actualTlsOidc: true,
          actualTlsS3: true,
          independentPersistentTestPsp: true,
          actualPspSandbox: false,
          realMoney: false,
          browser: Boolean(browser),
          setupAssertions,
          scenarioAssertions: assertions - setupAssertions,
        });
      },
    });
    status = "PASS";
    console.log(`PASS admin finance ${assertions}; ${output}`);
  } catch (error) {
    await save("failure.json", { stage, assertions, ...safeError(error) });
    console.error(
      `Admin finance failure ${JSON.stringify({ stage, ...safeError(error) })}`,
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
  if (process.argv[2]?.startsWith("--run-admin-finance")) {
    if (process.argv[2].endsWith("-ui") || process.argv[2].endsWith("-auth"))
      await import("./admin-access-test-dns.mjs");
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    await withFinanceTestDatabase((database, metadata) =>
      run(database, s3, process.argv[2].endsWith("-ui"), metadata),
    );
  } else
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: process.argv.includes("--auth-stress")
          ? "--run-admin-finance-auth"
          : process.argv.includes("--ui")
            ? "--run-admin-finance-ui"
            : "--run-admin-finance",
        timeoutMs: 1200000,
      }),
    );
} catch (error) {
  console.error(`FAIL admin finance ${JSON.stringify(safeError(error))}`);
  process.exitCode = 1;
}
