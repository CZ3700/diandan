import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = path.dirname(fileURLToPath(import.meta.url));
const baseline = "f9c8a619f38a07c095607e4b3b73039b4317f2a0";
const sha = value => createHash("sha256").update(value).digest("hex");
const git = args => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const read = name => readFile(path.join(root, name));
const prior = JSON.parse(await readFile(path.join(directory, "preexisting-untracked.json"), "utf8"));
assert.equal(prior.baseline, baseline);
for (const file of prior.files) assert.equal(sha(await read(file.path)), file.sha256, `Preexisting file changed: ${file.path}`);
const checks = {};
for (const [name, keys] of [["contracts.schema.json", ["$defs"]], ["openapi.json", ["paths"]], ["openapi.json", ["components", "schemas"]]]) {
  const filename = `packages/contracts/generated/${name}`;
  let before = JSON.parse(git(["show", `${baseline}:${filename}`]));
  let after = JSON.parse(await read(filename));
  for (const key of keys) { before = before[key]; after = after[key]; }
  for (const [name, value] of Object.entries(before)) assert.deepEqual(after[name], value, `Existing contract changed: ${name}`);
  checks[`${name}:${keys.join(".")}`] = { before: Object.keys(before).length, after: Object.keys(after).length, changed: 0 };
}
const migrations = git(["ls-tree", "-r", "--name-only", baseline, "database/migrations"]).toString().trim().split("\n").filter(name => name.endsWith(".sql"));
for (const filename of migrations) assert.equal(sha(await read(filename)), sha(git(["show", `${baseline}:${filename}`])), `Old SQL changed: ${filename}`);
const beforeManifest = JSON.parse(git(["show", `${baseline}:database/migrations/manifest.json`]));
const afterManifest = JSON.parse(await read("database/migrations/manifest.json"));
assert.deepEqual(afterManifest.migrations.slice(0, beforeManifest.migrations.length), beforeManifest.migrations);
const sourceNames = [...new Set(git(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "apps", "packages", "scripts", "database", "provider-fixtures", "infra", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", "turbo.json", "vitest.config.ts", "eslint.config.mjs"]).toString().split("\0").filter(Boolean))].sort();
const files = [];
for (const filename of sourceNames) files.push({ path: filename, sha256: sha(await read(filename)) });
const source = { baseline, files };
const sourceText = `${JSON.stringify(source, null, 2)}\n`;
await writeFile(path.join(directory, "candidate-source.json"), sourceText);
const report = { schemaVersion: 1, status: "PASS", checkedAt: new Date().toISOString(), baseline, preexistingFilesPreserved: prior.files.length, oldSqlPreserved: migrations.length, oldMigrationEntriesPreserved: beforeManifest.migrations.length, checks, sourceFiles: files.length, sourceManifestSha256: sha(sourceText) };
await writeFile(path.join(directory, "compatibility-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
