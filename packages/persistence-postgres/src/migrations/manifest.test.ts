import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { loadMigrationManifest } from "./manifest.js";

const temporaryRoots: string[] = [];

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), "fan-support-migrations-"),
  );
  temporaryRoots.push(workspaceRoot);
  await mkdir(path.join(workspaceRoot, "database/migrations"), {
    recursive: true,
  });
  return workspaceRoot;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeSingleMigrationManifest(
  workspaceRoot: string,
  upSql: string,
  downSql: string,
): Promise<void> {
  const migrationDirectory = path.join(workspaceRoot, "database/migrations");
  await Promise.all([
    writeFile(path.join(migrationDirectory, "0001_example.up.sql"), upSql),
    writeFile(path.join(migrationDirectory, "0001_example.down.sql"), downSql),
    writeFile(
      path.join(migrationDirectory, "manifest.json"),
      `${JSON.stringify({
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
      })}\n`,
    ),
  ]);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("loadMigrationManifest", () => {
  test("loads an ordered migration only when both SQL checksums match", async () => {
    const workspaceRoot = await createWorkspace();
    const upSql = "CREATE TABLE example (id bigint PRIMARY KEY);\n";
    const downSql = "DROP TABLE example;\n";
    await writeSingleMigrationManifest(workspaceRoot, upSql, downSql);

    await expect(loadMigrationManifest({ workspaceRoot })).resolves.toEqual([
      {
        version: "0001",
        name: "example",
        up: {
          relativePath: "database/migrations/0001_example.up.sql",
          sha256: sha256(upSql),
          sql: upSql,
        },
        down: {
          relativePath: "database/migrations/0001_example.down.sql",
          sha256: sha256(downSql),
          sql: downSql,
        },
      },
    ]);
  });

  test("rejects SQL changed after the manifest was signed", async () => {
    const workspaceRoot = await createWorkspace();
    await writeSingleMigrationManifest(
      workspaceRoot,
      "CREATE TABLE example (id bigint PRIMARY KEY);\n",
      "DROP TABLE example;\n",
    );
    await writeFile(
      path.join(workspaceRoot, "database/migrations/0001_example.up.sql"),
      "CREATE TABLE changed (id bigint PRIMARY KEY);\n",
    );

    await expect(loadMigrationManifest({ workspaceRoot })).rejects.toThrow(
      "checksum does not match",
    );
  });

  test("rejects unowned SQL files", async () => {
    const workspaceRoot = await createWorkspace();
    await writeSingleMigrationManifest(
      workspaceRoot,
      "CREATE TABLE example (id bigint PRIMARY KEY);\n",
      "DROP TABLE example;\n",
    );
    await writeFile(
      path.join(workspaceRoot, "database/migrations/9999_hidden.up.sql"),
      "SELECT 1;\n",
    );

    await expect(loadMigrationManifest({ workspaceRoot })).rejects.toThrow(
      "does not own every SQL migration file",
    );
  });

  test("rejects a migration SQL symbolic link", async () => {
    const workspaceRoot = await createWorkspace();
    const migrationDirectory = path.join(workspaceRoot, "database/migrations");
    const upSql = "CREATE TABLE example (id bigint PRIMARY KEY);\n";
    const downSql = "DROP TABLE example;\n";
    await writeSingleMigrationManifest(workspaceRoot, upSql, downSql);
    await rm(path.join(migrationDirectory, "0001_example.up.sql"));
    await writeFile(path.join(workspaceRoot, "linked.sql"), upSql);
    await symlink(
      path.join(workspaceRoot, "linked.sql"),
      path.join(migrationDirectory, "0001_example.up.sql"),
    );

    await expect(loadMigrationManifest({ workspaceRoot })).rejects.toThrow(
      "is not a regular file",
    );
  });

  test("rejects transaction control owned by a migration file", async () => {
    const workspaceRoot = await createWorkspace();
    await writeSingleMigrationManifest(
      workspaceRoot,
      "BEGIN;\nSELECT 1;\nCOMMIT;\n",
      "DROP TABLE example;\n",
    );

    await expect(loadMigrationManifest({ workspaceRoot })).rejects.toThrow(
      "must not contain transaction control",
    );
  });

  test.each([
    "BEGIN TRANSACTION;\nSELECT 1;\n",
    "START TRANSACTION ISOLATION LEVEL SERIALIZABLE;\nSELECT 1;\n",
    "COMMIT AND CHAIN;\n",
    "ROLLBACK AND CHAIN;\n",
    "SAVEPOINT migration_step;\n",
    "RELEASE SAVEPOINT migration_step;\n",
    "PREPARE TRANSACTION 'migration-step';\n",
  ])("rejects extended transaction control: %s", async (upSql) => {
    const workspaceRoot = await createWorkspace();
    await writeSingleMigrationManifest(
      workspaceRoot,
      upSql,
      "DROP TABLE example;\n",
    );

    await expect(loadMigrationManifest({ workspaceRoot })).rejects.toThrow(
      "must not contain transaction control",
    );
  });

  test("allows transaction words inside a PL/pgSQL function body", async () => {
    const workspaceRoot = await createWorkspace();
    const upSql = `
CREATE FUNCTION transaction_word_fixture()
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM 'BEGIN TRANSACTION;';
  PERFORM 'START TRANSACTION ISOLATION LEVEL SERIALIZABLE;';
  PERFORM 'COMMIT AND CHAIN;';
  PERFORM 'ROLLBACK AND CHAIN;';
  PERFORM 'SAVEPOINT migration_step;';
  PERFORM 'RELEASE SAVEPOINT migration_step;';
  PERFORM 'PREPARE TRANSACTION migration_step;';
END;
$function$;
`;
    await writeSingleMigrationManifest(
      workspaceRoot,
      upSql,
      "DROP FUNCTION transaction_word_fixture();\n",
    );

    await expect(loadMigrationManifest({ workspaceRoot })).resolves.toEqual([
      expect.objectContaining({
        up: expect.objectContaining({ sql: upSql }),
      }),
    ]);
  });
});
