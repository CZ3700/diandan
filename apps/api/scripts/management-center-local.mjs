#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const argument = process.argv[2];
if (
  !["--verify", "--serve", "--child-verify", "--child-serve"].includes(argument)
) {
  console.log(
    "Usage: mise exec node@24.20.0 -- node apps/api/scripts/management-center-local.mjs --verify | --serve\nCreates isolated local TEST PostgreSQL/S3 and one management center. No production authentication or release is implied.",
  );
} else {
  const harness =
    await import("../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs");
  if (!argument.startsWith("--child-")) {
    await harness.withEphemeralS3((context) =>
      harness.runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: argument === "--serve" ? "--child-serve" : "--child-verify",
        timeoutMs: 7_200_000,
      }),
    );
  } else {
    const { withEphemeralPostgres } =
      await import("@fan-support/persistence-postgres");
    const { withManagementCenterRuntime } =
      await import("./management-center-runtime.mjs");
    const { verifyManagementCenterBrowser } =
      await import("./management-center-browser.mjs");
    const workspaceRoot = fileURLToPath(
      new globalThis.URL("../../../", import.meta.url),
    );
    const output = path.join(
      workspaceRoot,
      "output/checks/p3-06-management-center",
      `run-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
    );
    await mkdir(output, { recursive: true, mode: 0o700 });
    const checks = [];
    let stopRequested = false,
      finish;
    const stopped = new Promise((resolve) => {
      finish = resolve;
    });
    const stop = () => {
      stopRequested = true;
      finish();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const expiresAt = new Date(Date.now() + 6_600_000).toISOString();
    const lifetime = globalThis.setTimeout(stop, 6_600_000);
    lifetime.unref();
    const check = (passed, label) => {
      if (stopRequested) throw new Error("LOCAL_RUNTIME_STOP_REQUESTED");
      checks.push({ passed: Boolean(passed), label });
      if (!passed) throw new Error(label);
    };
    const progress = (stage) => {
      if (stopRequested) throw new Error("LOCAL_RUNTIME_STOP_REQUESTED");
      console.log(`MANAGEMENT_STAGE ${stage}`);
    };
    const s3 = harness.readEphemeralS3Config();
    await harness.prepareEphemeralS3Buckets(s3);
    console.log(`MANAGEMENT_OUTPUT ${output}`);
    try {
      await withEphemeralPostgres((database) =>
        withManagementCenterRuntime({
          database,
          s3,
          workspaceRoot,
          output,
          check,
          progress,
          verify: async (runtime) => {
            await runtime.startStorefront();
            const sourceImages = Object.fromEntries(
              Object.entries({
                artist: "performer-daylight-mobile.webp",
                gift: "gift-ruby-bouquet.webp",
                posterA: "performer-daylight-desktop.webp",
                posterB: "performer-daylight-mobile.webp",
              }).map(([key, file]) => [
                key,
                path.join(
                  workspaceRoot,
                  "apps/storefront/public/ui-brand",
                  file,
                ),
              ]),
            );
            progress("real management browser verification");
            const report = await verifyManagementCenterBrowser({
              ...runtime,
              storefrontOrigin: runtime.origin,
              credentials: runtime.identity.credentials.manager,
              sourceImages,
              configPath: process.env.FAN_SUPPORT_MEDIA_S3_TEST_CONFIG,
            });
            await writeFile(
              path.join(output, "validation.json"),
              JSON.stringify(
                {
                  schemaVersion: 1,
                  environment: "LOCAL_TEST_DEV",
                  checks,
                  report,
                  productionRelease: false,
                },
                null,
                2,
              ) + "\n",
            );
            if (argument === "--child-serve") {
              const { openManagementCenter } =
                await import("./management-center-open.mjs");
              const browser = await openManagementCenter({
                ...runtime,
                credentials: runtime.identity.credentials.manager,
                configPath: process.env.FAN_SUPPORT_MEDIA_S3_TEST_CONFIG,
              });
              runtime.own("single management browser", () => browser.close());
              await writeFile(
                path.join(output, "runtime.json"),
                JSON.stringify(
                  {
                    adminUrl: `${runtime.adminOrigin}/zh-CN`,
                    storefrontUrl: `${runtime.origin}/zh-CN`,
                    operatorCount: 1,
                    expiresAt,
                    environment: "LOCAL_TEST_DEV",
                  },
                  null,
                  2,
                ) + "\n",
              );
              console.log(`MANAGEMENT_READY ${runtime.adminOrigin}/zh-CN`);
              await stopped;
            }
          },
        }),
      );
      console.log(`MANAGEMENT_PASS ${checks.length} checks`);
    } catch (error) {
      await writeFile(
        path.join(output, "failure.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            checks,
            stage: "LOCAL_TEST_FAILURE",
            code:
              typeof error?.code === "string"
                ? error.code
                : "VERIFICATION_FAILED",
          },
          null,
          2,
        ) + "\n",
      );
      // Only safe assertion text; never serialize database parameters, URLs or credentials.
      console.error(
        `MANAGEMENT_FAILED ${error?.name ?? "Error"} ${error?.code ?? "VERIFICATION_FAILED"}`,
      );
      process.exitCode = 1;
    } finally {
      globalThis.clearTimeout(lifetime);
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
  }
}
