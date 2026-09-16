#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
import {
  withEphemeralS3,
  runS3IntegrationChild,
  readEphemeralS3Config,
  prepareEphemeralS3Buckets,
} from "../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs";
import { runAcceptanceFixture } from "./storefront-acceptance-http.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const modeFile = path.join(
  workspaceRoot,
  "output/checks/p3-06-gift-read-reuse/mode.json",
);
const internalArgument = "--run-gift-read-comparison";

async function verifyBrowser(context) {
  const mode = JSON.parse(await readFile(modeFile, "utf8"));
  assert.equal(mode.schemaVersion, 1);
  assert.ok(
    ["baseline", "candidate"].includes(mode.mode),
    "comparison mode must be explicit",
  );
  assert.ok(
    Object.keys(mode).every((key) =>
      ["schemaVersion", "mode", "fullMatrix"].includes(key),
    ),
  );
  assert.ok(
    mode.fullMatrix === undefined || typeof mode.fullMatrix === "boolean",
  );
  const { verifyGiftReadComparison } = await import(
    `./storefront-gift-read-verification.mjs?attempt=${Date.now()}`
  );
  const comparison = await verifyGiftReadComparison({
    ...context,
    mode: mode.mode,
    fullMatrixRequested: mode.mode === "candidate" && mode.fullMatrix === true,
  });
  const fullMatrix =
    mode.mode === "candidate" && mode.fullMatrix
      ? await (
          await import(
            `./storefront-acceptance-matrix.mjs?attempt=${Date.now()}`
          )
        ).verifyAcceptanceBrowser(context)
      : null;
  return { comparison, fullMatrix };
}

try {
  assert.ok(
    process.argv.slice(2).every((value) => value === internalArgument),
    "Unknown gift comparison option",
  );
  assert.equal(
    process.env.FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS,
    "1",
    "Comparison requires explicit TEST read diagnostics",
  );
  if (process.argv.includes(internalArgument)) {
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    await withEphemeralPostgres((database) =>
      runAcceptanceFixture(database, s3, {
        serve: true,
        ui: true,
        verifyBrowser,
      }),
    );
  } else {
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: internalArgument,
        timeoutMs: 6_600_000,
      }),
    );
  }
} catch (error) {
  console.error(
    JSON.stringify({
      scope: "TEST gift read comparison",
      name: error?.name,
      assertion: error?.name === "AssertionError" ? error.message : null,
    }),
  );
  process.exitCode = 1;
}
