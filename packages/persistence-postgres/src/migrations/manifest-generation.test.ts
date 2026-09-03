import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { generateMigrationManifest } from "./manifest-generation.js";

const temporaryRoots: string[] = [];

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

test("generates a deterministic manifest from paired migration files", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), "fan-support-manifest-generation-"),
  );
  temporaryRoots.push(workspaceRoot);
  const migrationDirectory = path.join(workspaceRoot, "database/migrations");
  await mkdir(migrationDirectory, { recursive: true });
  const upSql = "SELECT 'up';\n";
  const downSql = "SELECT 'down';\n";
  await Promise.all([
    writeFile(path.join(migrationDirectory, "0001_example.up.sql"), upSql),
    writeFile(path.join(migrationDirectory, "0001_example.down.sql"), downSql),
  ]);

  await expect(generateMigrationManifest({ workspaceRoot })).resolves.toEqual({
    schemaVersion: 1,
    migrations: [
      {
        version: "0001",
        name: "example",
        up: "database/migrations/0001_example.up.sql",
        down: "database/migrations/0001_example.down.sql",
        sha256: { up: sha256(upSql), down: sha256(downSql) },
      },
    ],
  });
});
