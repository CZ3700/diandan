#!/usr/bin/env node
import assert from "node:assert/strict";
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
import { createAdminExceptionsFixture } from "./admin-exceptions-fixture.mjs";
import {
  verifyAdminExceptionsProtocol,
  exceptionEconomicCounts,
} from "./admin-exceptions-protocol.mjs";
import { observeFinancePostgres } from "./admin-finance-diagnostics.mjs";
import { withNativeFinancePostgres } from "./admin-finance-native-postgres.mjs";
import { verifyAdminExceptionsStorage } from "../../../packages/persistence-postgres/scripts/admin-exceptions-storage-cases.mjs";
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
    "output/checks/p5-06-exception-operations",
    `integration-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  await mkdir(output, { recursive: true, mode: 0o700 });
  let assertions = 0,
    setupAssertions = 0,
    protocolAssertions = 0,
    storageAssertions = 0,
    browserAssertions = 0,
    stage = "seed",
    status = "FAIL";
  const check = (condition, label) => {
    assertions++;
    if (!condition) stage = label;
    assert.ok(condition, label);
  };
  const progress = (value) => {
    stage = value;
    console.log(`Admin exceptions: ${value}`);
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
        const payment = createOrderPaymentProtocolClient(context),
          runtime = await createAdminExceptionsFixture(context, payment);
        const protocol = await verifyAdminExceptionsProtocol(context, runtime);
        protocolAssertions = assertions - setupAssertions;
        await save("protocol.json", {
          schemaVersion: 1,
          status: "PASS",
          ...protocol,
          manager: undefined,
          fixture: undefined,
          assertions: protocolAssertions,
        });
        progress("actual four-source storage authority and rollback guards");
        const startStorageAssertions = assertions;
        const storage = await verifyAdminExceptionsStorage({
          client: context.client,
          check,
          runtime,
          manager: protocol.manager,
          fixture: protocol.fixture,
        });
        storageAssertions = assertions - startStorageAssertions;
        await save("storage-cases.json", {
          ...storage,
          assertions: storageAssertions,
        });
        let browser;
        if (ui) {
          progress("fresh authentic sources for seven-language browser");
          const fixture = await runtime.createSources(protocol.manager);
          await runtime.exhaustQueue(fixture);
          const before = await runtime.facts();
          const assertEffects = async () => {
            await runtime.recover();
            const actual = await runtime.facts();
            check(
              JSON.stringify(exceptionEconomicCounts(actual.psp)) ===
                JSON.stringify(exceptionEconomicCounts(before.psp)),
              "browser exception commands cannot create a second payment or refund",
            );
            check(
              actual.delivered === before.delivered,
              "browser recovery cannot deliver a gift",
            );
            check(
              actual.refunds <= before.refunds + 1 &&
                actual.fulfillment_events === before.fulfillment_events,
              "browser recovery applies at most one original refund without repeating fulfillment events",
            );
            check(
              actual.notifications <= before.notifications + 2 &&
                actual.resends <= before.resends + 1 &&
                actual.receiverAccepted <= before.receiverAccepted + 3,
              "browser repeats stay within the two original order notifications and one authorized resend",
            );
            const duplicateSources = await context.client.query(
              `SELECT count(*)::int total FROM(
               SELECT target_kind,target_id,consumer_key FROM admin_exception_receipts
               WHERE target_id=ANY($1::uuid[]) GROUP BY target_kind,target_id,consumer_key HAVING count(*)>1
              ) duplicated`,
              [
                [
                  fixture.webhookTarget.id,
                  fixture.deadLetterTarget.id,
                  fixture.paymentTarget.id,
                  fixture.notificationTarget.id,
                ],
              ],
            );
            check(
              duplicateSources.rows[0].total === 0,
              "browser response-loss recovery leaves one durable command receipt per source",
            );
          };
          await runtime.startBrowser();
          progress("seven-language actual management browser");
          const startAssertions = assertions;
          const { verifyAdminExceptionsBrowser } =
            await import("./admin-exceptions-browser.mjs");
          browser = await verifyAdminExceptionsBrowser({
            ...runtime,
            fixture,
            output,
            check,
            mediaOrigins: [context.gateway.origin],
            assertEffects,
          });
          browserAssertions = assertions - startAssertions;
          await save("browser.json", browser);
        }
        await runtime.assertPrivacy();
        await save("scope.json", {
          schemaVersion: 1,
          actualPostgres: true,
          postgresEnvironment,
          actualTlsOidc: true,
          actualTlsS3: true,
          actualPgBossSixAttemptFailure: true,
          faultInjectionTargetsOnly: true,
          actualWorker: true,
          recoveryFailureMode: "SIMULATED_POST_COMMIT_INTERRUPTION",
          actualDatabaseLeaseExpiry: true,
          actualNewWorkerInstance: true,
          workerProcessKilled: false,
          independentPersistentTestPsp: true,
          independentPersistentTestMail: true,
          actualPspSandbox: false,
          realMoney: false,
          realEmail: false,
          browser: Boolean(browser),
          browserReadonlyScope: browser
            ? "WEBHOOK_MUTATION_SEVEN_LOCALES"
            : null,
          setupAssertions,
          protocolAssertions,
          storageAssertions,
          browserAssertions,
          additionalFixtureAssertions:
            assertions -
            setupAssertions -
            protocolAssertions -
            storageAssertions -
            browserAssertions,
        });
      },
    });
    status = "PASS";
    console.log(`PASS admin exceptions ${assertions}; ${output}`);
  } catch (error) {
    await save("failure.json", { stage, assertions, ...safeError(error) });
    console.error(
      `Admin exceptions failure ${JSON.stringify({ stage, ...safeError(error) })}`,
    );
    throw error;
  } finally {
    restoreDiagnostics();
    await save("run-result.json", {
      status,
      assertions,
      setupAssertions,
      protocolAssertions,
      storageAssertions,
      browserAssertions,
      additionalFixtureAssertions:
        assertions -
        setupAssertions -
        protocolAssertions -
        storageAssertions -
        browserAssertions,
      stage,
      completedAt: new Date().toISOString(),
    });
  }
}
try {
  if (process.argv[2]?.startsWith("--run-admin-exceptions")) {
    if (process.argv[2].endsWith("-ui"))
      await import("./admin-access-test-dns.mjs");
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    const nativeBin = process.env.ADMIN_EXCEPTIONS_TEST_POSTGRES_BIN;
    if (nativeBin !== undefined)
      await withNativeFinancePostgres(
        (database, metadata) =>
          run(database, s3, process.argv[2].endsWith("-ui"), {
            kind: "NATIVE_ISOLATED_TEST",
            serverVersion: metadata.serverVersion,
            configuredBy: "ADMIN_EXCEPTIONS_TEST_POSTGRES_BIN",
          }),
        { binDirectory: nativeBin },
      );
    else
      await withEphemeralPostgres((database) =>
        run(database, s3, process.argv[2].endsWith("-ui"), {
          kind: "DOCKER_EPHEMERAL_TEST",
          configuredBy: "withEphemeralPostgres",
        }),
      );
  } else
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: process.argv.includes("--ui")
          ? "--run-admin-exceptions-ui"
          : "--run-admin-exceptions",
        timeoutMs: 1200000,
      }),
    );
} catch (error) {
  console.error(`FAIL admin exceptions ${JSON.stringify(safeError(error))}`);
  process.exitCode = 1;
}
