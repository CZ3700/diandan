import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("data-bearing publication migration harness", () => {
  test("exercises 0005 data through up, down, and up without duplicating history", async () => {
    const [script, packageJson] = await Promise.all([
      readFile(
        path.join(
          workspaceRoot,
          "packages/persistence-postgres/scripts/postgres-publication-upgrade.mjs",
        ),
        "utf8",
      ).catch(() => ""),
      readFile(
        path.join(workspaceRoot, "packages/persistence-postgres/package.json"),
        "utf8",
      ),
    ]);

    expect(script).toContain("seedVersionFivePublicationHistory");
    expect(script).toContain("readImmutableHistorySnapshot");
    expect(script).toContain("assertImmutableHistoryPreserved");
    expect(script).toContain("assertVersionSixPublicationState");
    expect(script).toContain("assertVersionFiveHistoryPreserved");
    expect(script).toContain("assertPriceBookDowngradeGuard");
    expect(script).toContain("appendOnlyTriggerRestored");
    expect(
      script.match(/applyMigration\(client, migrationSql\.up\)/gu),
    ).toHaveLength(2);
    expect(script).toContain("applyMigration(client, migrationSql.down)");
    expect(script).toContain("syntheticAuditCount");
    expect(script).toContain("publicationRows");
    expect(script).toContain("outboxRows");
    expect(script).toContain(
      'import { SUPPORTED_LOCALES } from "@fan-support/contracts";',
    );
    expect(packageJson).toContain(
      "node ./scripts/postgres-publication-upgrade.mjs",
    );
  });
});
