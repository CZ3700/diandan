import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import { MigrationManifestError } from "./manifest.js";

const migrationDirectoryRelativePath = "database/migrations";
const migrationFilePattern =
  /^(?<version>\d{4})_(?<name>[a-z][a-z0-9-]*)\.(?<direction>up|down)\.sql$/u;

export type GeneratedMigrationManifest = Readonly<{
  schemaVersion: 1;
  migrations: readonly Readonly<{
    version: string;
    name: string;
    up: string;
    down: string;
    sha256: Readonly<{ up: string; down: string }>;
  }>[];
}>;

type MigrationPair = {
  name: string;
  up?: string;
  down?: string;
};

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function generateMigrationManifest(options: {
  workspaceRoot: string;
}): Promise<GeneratedMigrationManifest> {
  const canonicalWorkspaceRoot = await realpath(
    path.resolve(options.workspaceRoot),
  );
  const migrationDirectory = path.join(
    canonicalWorkspaceRoot,
    migrationDirectoryRelativePath,
  );
  const entries = await readdir(migrationDirectory, { withFileTypes: true });
  const pairs = new Map<string, MigrationPair>();

  for (const entry of entries) {
    if (!entry.name.endsWith(".sql")) {
      continue;
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new MigrationManifestError(
        `${migrationDirectoryRelativePath}/${entry.name} is not a regular file`,
      );
    }
    const match = migrationFilePattern.exec(entry.name);
    const groups = match?.groups;
    const version = groups?.["version"];
    const name = groups?.["name"];
    const direction = groups?.["direction"];
    if (
      version === undefined ||
      name === undefined ||
      (direction !== "up" && direction !== "down")
    ) {
      throw new MigrationManifestError(
        `${migrationDirectoryRelativePath}/${entry.name} is not canonically named`,
      );
    }
    const pair = pairs.get(version) ?? { name };
    if (pair.name !== name || pair[direction] !== undefined) {
      throw new MigrationManifestError(
        `migration ${version} does not have one canonical name and direction pair`,
      );
    }
    pair[direction] = entry.name;
    pairs.set(version, pair);
  }

  const orderedPairs = [...pairs.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const migrations = await Promise.all(
    orderedPairs.map(async ([version, pair], index) => {
      const expectedVersion = String(index + 1).padStart(4, "0");
      if (
        version !== expectedVersion ||
        pair.up === undefined ||
        pair.down === undefined
      ) {
        throw new MigrationManifestError(
          `migration ${version} is not a complete contiguous pair`,
        );
      }
      const up = `${migrationDirectoryRelativePath}/${pair.up}`;
      const down = `${migrationDirectoryRelativePath}/${pair.down}`;
      const [upBytes, downBytes] = await Promise.all([
        readFile(path.join(canonicalWorkspaceRoot, up)),
        readFile(path.join(canonicalWorkspaceRoot, down)),
      ]);
      return {
        version,
        name: pair.name,
        up,
        down,
        sha256: { up: sha256(upBytes), down: sha256(downBytes) },
      };
    }),
  );

  return { schemaVersion: 1, migrations };
}
