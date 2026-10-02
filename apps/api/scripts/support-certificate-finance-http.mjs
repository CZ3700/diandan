#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
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
import { createOrderStorefrontGateway } from "./order-storefront-gateway.mjs";
import { createPaymentRuntimeNext } from "./payment-runtime-next.mjs";
import { verifySupportCertificateFinance } from "./support-certificate-finance-fixture.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const runId =
  process.env["SUPPORT_CERTIFICATE_FINANCE_TEST_RUN"] ?? String(Date.now());
assert.match(runId, /^[0-9]+$/u);
process.env["SUPPORT_CERTIFICATE_FINANCE_TEST_RUN"] = runId;
const output = path.join(
  workspaceRoot,
  "output/checks/l3-certificate-finance/integration",
  `run-${runId}`,
);
const save = (name, value) =>
  writeFile(path.join(output, name), JSON.stringify(value, null, 2) + "\n");

/** Bind deployed inputs as well as source; never enumerate ignored runtime credentials. */
async function sourceInputs() {
  const tracked = execFileSync(
    "git",
    ["ls-files", "-c", "-o", "--exclude-standard", "-z"],
    { cwd: workspaceRoot, encoding: "utf8" },
  ).split("\0");
  const files = new Set(
    tracked.filter((file) =>
      /^(?:(?:apps|packages|database|scripts|provider-fixtures)\/|(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|turbo\.json)$)/u.test(
        file,
      ),
    ),
  );
  for await (const file of glob(
    ["packages/*/dist/**/*.js", "apps/{api,worker}/dist/**/*.js"],
    { cwd: workspaceRoot },
  ))
    files.add(file);
  return Object.fromEntries(
    await Promise.all(
      [...files].sort().map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(path.join(workspaceRoot, file)))
          .digest("hex"),
      ]),
    ),
  );
}

async function run(database, s3, ui) {
  await mkdir(output, { recursive: true });
  let assertions = 0,
    setupAssertions = 0,
    stage = "setup",
    status = "FAIL",
    protocol,
    browser;
  const check = (condition, label) => {
    assertions++;
    if (!condition) stage = label;
    assert.ok(condition, label);
  };
  const progress = (label) => {
    stage = label;
    console.log(`Certificate finance: ${label}`);
  };
  const before = await sourceInputs();
  await save("source-before.json", before);
  try {
    await withOrderAccessFixture({
      database,
      s3,
      workspaceRoot,
      output,
      check,
      progress,
      verify: async (fixture) => {
        const context = { ...fixture, workspaceRoot, output };
        setupAssertions = assertions;
        let observer, next;
        try {
          if (ui) {
            const proxy = await createOrderStorefrontGateway({
              fallbackBase: context.proxy.origin,
              accessBase: context.accessBase,
            });
            context.own("certificate order gateway", () => proxy.close());
            next = createPaymentRuntimeNext({ ...context, proxy });
            context.own("certificate production Next", () => next.stop());
            progress("compile current storefront for actual financial stages");
            await next.start();
            observer = await (
              await import("./support-certificate-finance-browser.mjs")
            ).createSupportCertificateFinanceBrowser(context);
            context.own("certificate browser", () => observer.close());
          }
          protocol = await verifySupportCertificateFinance(context, {
            ...(observer ? { onStage: observer.observe } : {}),
          });
          await save("protocol-results.json", {
            status: "PASS",
            protocol,
            actualPspSandbox: false,
          });
          if (observer) browser = await observer.finish();
        } finally {
          await observer?.close();
          await next?.stop();
        }
      },
    });
    const after = await sourceInputs();
    await save("source-after.json", after);
    check(
      JSON.stringify(before) === JSON.stringify(after),
      "All selected source and compiled runtime inputs remain byte-identical",
    );
    status = "CHECKS_PASSED";
  } catch (error) {
    await save("failure.json", {
      status: "FAIL",
      stage,
      name: /^[A-Za-z]{1,64}$/u.test(error?.name ?? "") ? error.name : null,
      code: /^[A-Z0-9_]{1,64}$/u.test(error?.code ?? "") ? error.code : null,
      callsites: [
        ...(error?.stack ?? "").matchAll(
          /support-certificate-finance-[a-z-]+\.mjs:\d+:\d+/gu,
        ),
      ].map(([site]) => site),
    });
    throw error;
  } finally {
    await save("run-result.json", {
      schemaVersion: 1,
      status,
      assertions,
      setupAssertions,
      stage,
      sourceUnchanged: status === "CHECKS_PASSED",
      sourceScope:
        "Tracked and non-ignored commerce source plus compiled package/API/Worker JavaScript",
      protocol,
      browser: browser ? { status: browser.status } : null,
      actualPostgres: true,
      actualTls: true,
      actualPspSandbox: false,
      actualExternalMail: false,
      completedAt: new Date().toISOString(),
    });
  }
}

try {
  const internalUi = process.argv.includes(
    "--owned-support-certificate-finance-ui",
  );
  const internal =
    internalUi || process.argv.includes("--owned-support-certificate-finance");
  const ui = internalUi || process.argv.includes("--ui");
  assert.ok(
    process.argv
      .slice(2)
      .every((arg) =>
        [
          "--owned-support-certificate-finance",
          "--owned-support-certificate-finance-ui",
          "--ui",
        ].includes(arg),
      ),
    "Unknown certificate finance option",
  );
  if (internal) {
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    await withEphemeralPostgres((database) => run(database, s3, ui));
  } else {
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: ui
          ? "--owned-support-certificate-finance-ui"
          : "--owned-support-certificate-finance",
        timeoutMs: 1_200_000,
      }),
    );
    const report = JSON.parse(
      await readFile(path.join(output, "run-result.json"), "utf8"),
    );
    assert.equal(report.status, "CHECKS_PASSED");
    await save("run-result.json", {
      ...report,
      status: "PASS",
      ownedRuntimeCleanup: true,
    });
    console.log(`PASS certificate finance ${report.assertions}; ${output}`);
  }
} catch {
  console.error("FAIL certificate finance; see the redacted owned-run report");
  process.exitCode = 1;
}
