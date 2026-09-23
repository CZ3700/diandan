import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import { Client } from "pg";
import { withEphemeralPostgres, runMigrations } from "../dist/index.js";
import { seedCatalogDirectoryFixtures } from "./postgres-catalog-fixtures.mjs";
import { measureCatalogPerformance } from "./catalog-performance-runner.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
export async function measureLegacyCatalogPerformance(output) {
  for (const count of [120, 1200])
    await withEphemeralPostgres(async (database, runtime) => {
      await runMigrations({
        clientConfig: database,
        workspaceRoot,
        command: { direction: "up", targetVersion: "0017" },
      });
      const client = new Client(database);
      await client.connect();
      try {
        console.log(`Catalog performance legacy seed ${count}`);
        await seedCatalogDirectoryFixtures(client, count);
        await runMigrations({
          clientConfig: database,
          workspaceRoot,
          command: { direction: "up" },
        });
        await client.query("ANALYZE");
        await measureCatalogPerformance({
          database,
          client,
          publicMediaBaseUrl: "https://media.example.invalid",
          output: path.join(output, `legacy-${count}`),
          expectedProofVersion: 1,
          expectedTotal: count,
          runtime,
        });
      } finally {
        await client.end();
      }
    });
}
if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output)
    throw new TypeError("An explicit owned output directory is required");
  await measureLegacyCatalogPerformance(path.resolve(output));
}
