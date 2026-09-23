import assert from "node:assert/strict";
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
import { runAcceptanceFixture } from "./storefront-acceptance-http.mjs";
import { verifyRumBrowser } from "./rum-browser.mjs";

const childArgument = "--owned-rum-child";
async function main() {
  assert.ok(
    process.argv.slice(2).every((arg) => arg === childArgument),
    "Owned RUM verification accepts no existing user instance or external target",
  );
  if (process.argv.includes(childArgument)) {
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    await withEphemeralPostgres((database) =>
      runAcceptanceFixture(database, s3, {
        serve: false,
        ui: true,
        performance: false,
        localRum: true,
        verifyBrowser: verifyRumBrowser,
      }),
    );
  } else {
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: childArgument,
        timeoutMs: 1_500_000,
      }),
    );
  }
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      scope: "Owned real-browser local RUM wiring",
      name: error?.name,
      assertion: error?.name === "AssertionError" ? error.message : null,
    }),
  );
  process.exitCode = 1;
});
