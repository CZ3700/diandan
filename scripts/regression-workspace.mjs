import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { regressionSuiteEnvironment } from "./regression-environment.mjs";

const execute = promisify(execFile);

/** Exclude only deletions already observed by Git; copy-time disappearance remains an error. */
export async function readRegressionInventory(source) {
  const read = async (args) =>
    (
      await execute("git", ["ls-files", ...args, "-z"], {
        cwd: source,
        env: regressionSuiteEnvironment("source", process.env),
        maxBuffer: 64 * 1024 * 1024,
      })
    ).stdout
      .split("\0")
      .filter(Boolean);
  const [inventory, deleted] = await Promise.all([
    read(["--cached", "--others", "--exclude-standard"]),
    read(["--deleted"]),
  ]);
  const excluded = new Set(deleted);
  return inventory.filter((filename) => !excluded.has(filename));
}

const roots = [
  "apps/",
  "packages/",
  "scripts/",
  "database/",
  "provider-fixtures/",
  "infra/",
  "docs/",
  ".github/",
  ".agents/",
];
const rootFiles = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "vitest.config.ts",
  "tsconfig.base.json",
  "eslint.config.mjs",
  ".gitignore",
  ".dockerignore",
  ".prettierignore",
  ".secretlintignore",
  ".secretlintrc.json",
  ".node-version",
  ".npmrc",
  ".env.example",
  "README.md",
  "AGENTS.md",
]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function selected(filename) {
  if (
    path.isAbsolute(filename) ||
    filename.split(/[\\/]/u).some((part) => part === ".." || part === ".") ||
    filename.includes("\\")
  )
    throw new Error("Invalid regression source path");
  if (
    /(?:^|\/)(?:node_modules|\.next|\.turbo|dist|coverage|\.git)(?:\/|$)/u.test(
      filename,
    ) ||
    /(?:\.log|\.tsbuildinfo)$/u.test(filename)
  )
    return false;
  if (/(?:^|\/)\.env(?:\.|$)/u.test(filename) && !filename.endsWith(".example"))
    return false;
  return (
    rootFiles.has(filename) || roots.some((root) => filename.startsWith(root))
  );
}
async function sourceBytes(source, filename) {
  const segments = filename.split("/");
  for (let index = 1; index <= segments.length; index++) {
    const metadata = await lstat(
      path.join(source, ...segments.slice(0, index)),
    );
    if (metadata.isSymbolicLink())
      throw new Error("Regression input cannot be a symbolic link");
  }
  const metadata = await lstat(path.join(source, filename));
  if (!metadata.isFile())
    throw new Error("Regression input must be a regular file");
  return {
    bytes: await readFile(path.join(source, filename)),
    mode: metadata.mode & 0o777,
  };
}
/** Copy source only. Never copy user databases, private config, credentials, or old evidence. */
export async function createRegressionWorkspace({
  source,
  destination,
  inventory,
}) {
  await mkdir(path.dirname(destination), { recursive: true });
  await mkdir(destination, { mode: 0o700 });
  const files = [];
  for (const filename of [...new Set(inventory)].filter(selected).sort()) {
    const { bytes, mode } = await sourceBytes(source, filename);
    await mkdir(path.dirname(path.join(destination, filename)), {
      recursive: true,
    });
    await writeFile(path.join(destination, filename), bytes, {
      flag: "wx",
      mode,
    });
    files.push({ path: filename, sha256: hash(bytes), mode });
  }
  // Progress notes and instructions do not alter executable inputs between suite runs.
  const executable = files.filter(
    ({ path: filename }) =>
      !filename.startsWith("docs/") &&
      !filename.startsWith(".agents/") &&
      !["AGENTS.md", "README.md"].includes(filename),
  );
  return {
    schemaVersion: 1,
    sourceHash: hash(JSON.stringify(executable)),
    files,
  };
}
export async function verifyRegressionSource(source, report) {
  for (const file of report.files) {
    const { bytes } = await sourceBytes(source, file.path);
    if (hash(bytes) !== file.sha256)
      throw new Error("Regression source changed during verification");
  }
}

export function regressionWorkspacePath(sourceRoot, runId) {
  if (!/^[a-z0-9-]+$/u.test(runId))
    throw new Error("Invalid owned run identity");
  return path.join(
    path.dirname(sourceRoot),
    ".fan-support-regression",
    runId,
    "workspace",
  );
}
