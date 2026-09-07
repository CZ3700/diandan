#!/usr/bin/env node
import { mkdir, writeFile, rename } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const help = `Local TEST operations UAT preparation (no automated human acceptance).
Usage: mise exec node@24.20.0 -- node apps/api/scripts/storefront-operations-uat.mjs --serve
Build existing Admin/API dependencies first. Run separately from performance checks.
--serve creates ephemeral PostgreSQL/S3, baseline data and isolated browser role windows.
The human clicks START/FINISH in the local action-card page. No measured gift is pre-created.
Use Ctrl-C to stop the owned runtime. Session/runtime lifetime is at most about one hour.
Records remain PENDING human review; this does not test production authentication.
`;
const argument = process.argv[2];
try {
  if (
    process.argv.length > 3 ||
    ![undefined, "--help", "--serve", "--run-operations-uat"].includes(argument)
  )
    throw new Error("INVALID_ARGUMENT");
  if (!argument || argument === "--help") console.log(help);
  else {
    const s3Harness =
      await import("../../../packages/media-s3/scripts/ephemeral-s3-harness.mjs");
    if (argument === "--serve") {
      await s3Harness.withEphemeralS3((context) =>
        s3Harness.runS3IntegrationChild({
          ...context,
          scriptUrl: import.meta.url,
          argument: "--run-operations-uat",
          timeoutMs: 3_600_000,
        }),
      );
    } else {
      const [
        { withEphemeralPostgres },
        { verifyAdminWorkspaceScenario },
        { giftCommerceExtension },
        { prepareOperationsMaterials },
        { openOperationsUat },
      ] = await Promise.all([
        import("@fan-support/persistence-postgres"),
        import("./admin-workspace-http.mjs"),
        import("./gift-commerce-http-fixtures.mjs"),
        import("./storefront-operations-uat-fixtures.mjs"),
        import("./storefront-operations-uat-browser.mjs"),
      ]);
      const root = fileURLToPath(
        new globalThis.URL("../../../", import.meta.url),
      );
      const run = `run-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`;
      const output = path.join(
        root,
        "output/checks/p3-06-storefront-acceptance/operations-uat",
        run,
      );
      await mkdir(output, { recursive: true, mode: 0o700 });
      const persist = async (snapshot) => {
        const temporary = path.join(output, "timing.json.next");
        await writeFile(temporary, JSON.stringify(snapshot, null, 2) + "\n", {
          mode: 0o600,
        });
        await rename(temporary, path.join(output, "timing.json"));
      };
      const extension = {
        name: "operations UAT preparation only (human acceptance remains PENDING)",
        seed: giftCommerceExtension.seed,
        compositions: giftCommerceExtension.compositions,
        async prepare(dependencies) {
          const materials = await prepareOperationsMaterials(dependencies);
          dependencies.fixtures.operationsUat = materials;
          const bytes = JSON.stringify(materials, null, 2) + "\n";
          await writeFile(path.join(output, "materials.json"), bytes, {
            mode: 0o600,
          });
          await writeFile(
            path.join(output, "preparation.json"),
            JSON.stringify(
              {
                schemaVersion: 1,
                environment: "LOCAL_TEST_ONLY",
                humanOperationsAcceptance: false,
                measuredGiftCreated: false,
                materialsSha256: createHash("sha256")
                  .update(bytes)
                  .digest("hex"),
              },
              null,
              2,
            ) + "\n",
            { mode: 0o600 },
          );
        },
        verifyBrowser: (dependencies) =>
          openOperationsUat({ ...dependencies, persist }),
      };
      const s3 = s3Harness.readEphemeralS3Config();
      await s3Harness.prepareEphemeralS3Buckets(s3);
      console.log(`LOCAL_OPERATIONS_UAT_OUTPUT ${output}`);
      await withEphemeralPostgres((database) =>
        verifyAdminWorkspaceScenario(database, s3, {
          serve: true,
          ui: false,
          extension,
        }),
      );
    }
  }
} catch {
  console.error(
    "FAIL operations UAT preparation; no human acceptance is implied. Check safe stage diagnostics.",
  );
  process.exitCode = 1;
}
