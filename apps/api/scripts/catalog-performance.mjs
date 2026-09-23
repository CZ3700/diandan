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
import { measureCatalogPerformance } from "../../../packages/persistence-postgres/scripts/catalog-performance-runner.mjs";
import { measureLegacyCatalogPerformance } from "../../../packages/persistence-postgres/scripts/catalog-performance-legacy.mjs";
import { withAcceptanceFixture } from "./storefront-acceptance-runtime.mjs";
import { seedCatalogPerformanceDaily } from "./catalog-performance-daily-fixture.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
async function run(output, s3) {
  await mkdir(output, { recursive: true });
  const summary = {
    schemaVersion: 1,
    status: "RUNNING",
    stages: [],
    cleanup: "PENDING",
    userInstanceAccessed: false,
  };
  const save = () =>
    writeFile(
      path.join(output, "catalog-results.json"),
      JSON.stringify(summary, null, 2) + "\n",
    );
  await save();
  try {
    await measureLegacyCatalogPerformance(output);
    summary.stages.push("LEGACY_120", "LEGACY_1200");
    await save();
    await withEphemeralPostgres((database, runtime) =>
      withAcceptanceFixture({
        database,
        s3,
        workspaceRoot,
        output: path.join(output, "modern-fixture"),
        check: (condition, message) => assert.ok(condition, message),
        progress: (message) =>
          console.log(`Catalog performance fixture: ${message}`),
        verify: async (context) => {
          const daily = await seedCatalogPerformanceDaily({
            ...context,
            database,
            s3,
            workspaceRoot,
          });
          await writeFile(
            path.join(output, "daily-fixture-manifest.json"),
            JSON.stringify(
              {
                schemaVersion: 1,
                actualDailyPublications: daily.length,
                giftIds: daily.map((gift) => gift.id),
                normalPublisher: true,
                realPostgres: true,
                realTlsS3: true,
                baselineFixture: context.manifest,
              },
              null,
              2,
            ) + "\n",
          );
          await context.client.query("ANALYZE");
          const expectedTotal = Number(
            (
              await context.client.query(
                "SELECT count(*) FROM public.gifts g JOIN public.gift_publication_heads h ON h.gift_id=g.id AND h.gift_revision_id=g.published_revision_id WHERE g.status IN ('active','paused')",
              )
            ).rows[0].count,
          );
          await measureCatalogPerformance({
            database,
            client: context.client,
            publicMediaBaseUrl: context.gateway.origin,
            output: path.join(output, "modern-120"),
            expectedProofVersion: 3,
            expectedTotal,
            runtime,
          });
        },
      }),
    );
    summary.stages.push("DAILY_V3_120");
    summary.cleanup = "COMPLETED_NORMAL_EPHEMERAL_HARNESS";
    summary.status = "PASS";
    await save();
  } catch (error) {
    summary.status = "FAIL";
    summary.failure = {
      kind: error?.name === "AssertionError" ? "ASSERTION" : "HARNESS_FAILURE",
    };
    await save();
    throw error;
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const internal = process.argv[2]?.startsWith("--run-catalog-performance=");
  const output = internal
    ? decodeURIComponent(
        process.argv[2].slice("--run-catalog-performance=".length),
      )
    : process.argv[2];
  assert.ok(
    output && path.isAbsolute(output),
    "explicit absolute owned output directory is required",
  );
  assert.equal(
    process.argv.length,
    3,
    "only the owned output option is supported",
  );
  if (internal) {
    const s3 = readEphemeralS3Config();
    await prepareEphemeralS3Buckets(s3);
    await run(output, s3);
  } else
    await withEphemeralS3((context) =>
      runS3IntegrationChild({
        ...context,
        scriptUrl: import.meta.url,
        argument: `--run-catalog-performance=${encodeURIComponent(output)}`,
        timeoutMs: 1800000,
      }),
    );
}
