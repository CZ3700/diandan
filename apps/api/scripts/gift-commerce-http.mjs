#!/usr/bin/env node
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
import { verifyAdminWorkspaceScenario } from "./admin-workspace-http.mjs";
import { giftCommerceExtension } from "./gift-commerce-http-fixtures.mjs";
try {
  const ui =
    process.argv.includes("--ui") ||
    process.argv.includes("--run-gift-commerce-ui");
  const serve =
    process.argv.includes("--serve") ||
    process.argv.includes("--serve-gift-commerce");
  if (
    process.argv.some((value) =>
      [
        "--run-gift-commerce",
        "--run-gift-commerce-ui",
        "--serve-gift-commerce",
      ].includes(value),
    )
  ) {
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    await withEphemeralPostgres((database) =>
      verifyAdminWorkspaceScenario(database, s3, {
        ui,
        serve,
        extension: giftCommerceExtension,
      }),
    );
  } else {
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: serve
          ? "--serve-gift-commerce"
          : ui
            ? "--run-gift-commerce-ui"
            : "--run-gift-commerce",
        timeoutMs: serve ? 3_600_000 : 600_000,
      }),
    );
  }
} catch (error) {
  console.error(
    `FAIL gift commerce HTTP; code=${typeof error?.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code) ? error.code : "UNAVAILABLE"}`,
  );
  process.exitCode = 1;
}
