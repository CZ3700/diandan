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
import { verifyPspOnboardingProtocol } from "./psp-onboarding-protocol.mjs";
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
const save = (output, name, value) =>
  writeFile(path.join(output, name), JSON.stringify(value, null, 2) + "\n");

async function verify(database, s3, postgresEnvironment, output) {
  const restoreDiagnostics = observeFinancePostgres();
  let assertions = 0,
    setupAssertions = 0,
    status = "FAIL",
    stage = "seed",
    fixtureCleanupVerified = false;
  const owned = [];
  const check = (condition, label) => {
    assertions++;
    if (!condition) stage = label;
    assert.ok(condition, label);
  };
  const progress = (label) => {
    stage = label;
    console.log(`PSP onboarding: ${label}`);
  };
  try {
    await withOrderAccessFixture({
      database,
      s3,
      workspaceRoot,
      output,
      check,
      progress,
      verify: async (original) => {
        const context = {
          ...original,
          workspaceRoot,
          saveEvidence: (name, value) => save(output, name, value),
          own(name, close) {
            const resource = { name, closed: false };
            owned.push(resource);
            original.own(name, async () => {
              await close();
              resource.closed = true;
            });
          },
        };
        progress(
          "two independent APIs, authenticated OIDC and persistent TLS TEST PSP",
        );
        const payment = createOrderPaymentProtocolClient(context);
        const runtime = await createAdminPaymentConfigurationFixture(context);
        payment.canaries.forEach(runtime.registerSecret);
        setupAssertions = assertions;
        const protocol = await verifyPspOnboardingProtocol(
          context,
          runtime,
          payment,
        );
        await runtime.assertPrivacy();
        check(
          payment.canaries.every(
            (value) => !context.logLines.some((line) => line.includes(value)),
          ),
          "all process logs exclude private fan data",
        );
        await save(output, "protocol.json", {
          schemaVersion: 1,
          status: "PASS",
          assertions: assertions - setupAssertions,
          ...protocol,
        });
        await save(output, "scope.json", {
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
          liveEmployeeRollout: false,
          productionDeployment: false,
          browser: false,
          internalStage:
            "Isolated loopback TEST fixture with actual ACTIVE/TEST account; no LIVE employee targeting is claimed.",
          cohortScope:
            "24 server-generated checkout IDs; seven locales and two independent API processes per stage. Intermediate observed ratios are reported without requiring a probabilistic hit.",
          paymentCreateScope:
            "One legacy TEST payment accepted before AFTER response loss, one normalized TEST payment accepted at the isolated 100% stage, current 0% new-create rejection on both APIs, and stale-version rejection. The 5%/25% stages verify capability admission, not additional provider creates.",
        });
      },
    });
    fixtureCleanupVerified = true;
    status = "PASS";
    console.log(`PASS PSP onboarding ${assertions}; ${output}`);
  } catch (error) {
    await save(output, "failure.json", {
      schemaVersion: 1,
      stage,
      assertions,
      ...safeError(error),
    });
    console.error(
      `PSP onboarding failure ${JSON.stringify({ stage, ...safeError(error) })}`,
    );
    throw error;
  } finally {
    restoreDiagnostics();
    await save(output, "cleanup.json", {
      schemaVersion: 1,
      fixtureCleanupVerified,
      configurationResources: owned,
      outerPostgresAndS3:
        "See outer-result.json; fixture completion does not establish outer harness cleanup.",
    });
    await save(output, "run-result.json", {
      schemaVersion: 1,
      status,
      assertions,
      setupAssertions,
      scenarioAssertions: assertions - setupAssertions,
      stage,
      completedAt: new Date().toISOString(),
    });
  }
}

async function runChild(output) {
  const s3 = readEphemeralS3Config();
  await prepareEphemeralS3Buckets(s3);
  const binDirectory = process.env.PSP_ONBOARDING_TEST_POSTGRES_BIN;
  if (binDirectory)
    await withNativeFinancePostgres(
      (database, metadata) =>
        verify(
          database,
          s3,
          {
            kind: "NATIVE_ISOLATED_TEST",
            serverVersion: metadata.serverVersion,
            configuredBy: "PSP_ONBOARDING_TEST_POSTGRES_BIN",
          },
          output,
        ),
      { binDirectory },
    );
  else
    await withEphemeralPostgres((database) =>
      verify(database, s3, { kind: "DOCKER_EPHEMERAL_TEST" }, output),
    );
}

/** Import-safe entry used by the root verification command; success includes both outer cleanups. */
export async function runPspOnboardingHttp() {
  const output = path.join(
    workspaceRoot,
    "output/checks/p5-07-psp-onboarding",
    `integration-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  await mkdir(output, { recursive: true, mode: 0o700 });
  const previous = process.env.PSP_ONBOARDING_TEST_OUTPUT;
  process.env.PSP_ONBOARDING_TEST_OUTPUT = output;
  let status = "FAIL";
  try {
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: "--run-psp-onboarding",
        timeoutMs: 1200000,
      }),
    );
    status = "PASS";
    return { status, output };
  } catch (error) {
    await save(output, "outer-failure.json", {
      schemaVersion: 1,
      ...safeError(error),
    });
    throw error;
  } finally {
    if (previous === undefined) delete process.env.PSP_ONBOARDING_TEST_OUTPUT;
    else process.env.PSP_ONBOARDING_TEST_OUTPUT = previous;
    await save(output, "outer-result.json", {
      schemaVersion: 1,
      status,
      childExitZero: status === "PASS",
      postgresHarnessReturned: status === "PASS",
      s3HarnessReturned: status === "PASS",
      cleanupVerified: status === "PASS",
      completedAt: new Date().toISOString(),
    });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv[2] === "--run-psp-onboarding") {
      const output = process.env.PSP_ONBOARDING_TEST_OUTPUT;
      assert.ok(
        output && path.isAbsolute(output),
        "owned onboarding output path is required",
      );
      await runChild(output);
    } else await runPspOnboardingHttp();
  } catch (error) {
    console.error(`FAIL PSP onboarding ${JSON.stringify(safeError(error))}`);
    process.exitCode = 1;
  }
}
