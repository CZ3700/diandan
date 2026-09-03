#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateMigrationManifest } from "../dist/index.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const manifestPath = path.join(
  workspaceRoot,
  "database/migrations/manifest.json",
);
const generated = await generateMigrationManifest({ workspaceRoot });
const serialized = `${JSON.stringify(generated, null, 2)}\n`;

if (process.argv.includes("--check")) {
  let committed = "";
  try {
    committed = await readFile(manifestPath, "utf8");
  } catch {
    // A missing manifest is reported as drift without exposing a local path.
  }
  if (committed !== serialized) {
    console.error(
      "Migration manifest drift detected. Run the manifest generation command.",
    );
    process.exitCode = 1;
  }
} else {
  await writeFile(manifestPath, serialized);
  console.log("Migration manifest generated.");
}
