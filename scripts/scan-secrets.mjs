import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const ignoredDirectoryNames = new Set([
  ".git",
  "node_modules",
  ".pnpm-store",
  ".turbo",
  ".next",
  "dist",
  "coverage",
  "test-results",
  "playwright-report",
  "blob-report",
]);

const allowedSecretlintPolicyFiles = new Set([
  ".secretlintignore",
  ".secretlintrc.json",
]);

const maxGitOutputBytes = 16 * 1024 * 1024;

function runGit(arguments_) {
  return spawnSync("git", arguments_, {
    cwd: workspaceRoot,
    encoding: "utf8",
    maxBuffer: maxGitOutputBytes,
  });
}

function isGeneratedArtifactPath(filePath) {
  const segments = filePath.split("/");
  return segments.some((segment) => {
    const normalizedSegment = segment.toLowerCase();
    return (
      ignoredDirectoryNames.has(normalizedSegment) ||
      normalizedSegment.endsWith(".tsbuildinfo") ||
      normalizedSegment.endsWith(".log")
    );
  });
}

function isUnapprovedSecretlintPolicy(filePath) {
  if (allowedSecretlintPolicyFiles.has(filePath)) {
    return false;
  }

  const baseName = (filePath.split("/").at(-1) ?? "").toLowerCase();
  return (
    baseName.startsWith(".secretlintignore") ||
    baseName.startsWith(".secretlintrc")
  );
}

function shouldSkipDirectory(directoryName) {
  const normalizedName = directoryName.toLowerCase();
  return normalizedName !== ".git" && ignoredDirectoryNames.has(normalizedName);
}

function rejectUnsafeWorkspaceEntries() {
  const directories = [""];
  let rejectedCount = 0;

  while (directories.length > 0) {
    const relativeDirectory = directories.pop();
    let entries;
    try {
      entries = readdirSync(path.join(workspaceRoot, relativeDirectory), {
        withFileTypes: true,
      });
    } catch {
      console.error("Secret scan refused: cannot inspect the working tree");
      process.exit(1);
    }

    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;

      if (relativePath === ".git") {
        continue;
      }

      if (shouldSkipDirectory(entry.name)) {
        continue;
      }

      if (
        entry.name.toLowerCase() === ".git" ||
        isUnapprovedSecretlintPolicy(relativePath) ||
        entry.isSymbolicLink()
      ) {
        rejectedCount += 1;
        continue;
      }

      if (entry.isDirectory()) {
        directories.push(relativePath);
      }
    }
  }

  if (rejectedCount > 0) {
    console.error(
      `Secret scan refused: ${rejectedCount} working-tree entry or entries bypass the approved scan boundary`,
    );
    process.exit(1);
  }
}

function readTrackedFiles() {
  const result = runGit(["ls-files", "-z"]);
  if (
    result.error ||
    result.status !== 0 ||
    typeof result.stdout !== "string"
  ) {
    console.error("Secret scan refused: cannot enumerate Git-tracked files");
    process.exit(1);
  }

  return result.stdout.split("\0").filter(Boolean);
}

function rejectIgnoredTrackedFiles(trackedFiles) {
  const rejectedCount = trackedFiles.filter(
    (filePath) =>
      isGeneratedArtifactPath(filePath) ||
      isUnapprovedSecretlintPolicy(filePath),
  ).length;

  if (rejectedCount > 0) {
    console.error(
      `Secret scan refused: ${rejectedCount} tracked file(s) bypass the approved scan boundary`,
    );
    process.exit(1);
  }
}

function rejectInlineSuppressions() {
  const suppressionDirective = "secretlint" + "-disable";
  const result = runGit(["grep", "-q", "-e", suppressionDirective, "--"]);

  if (result.error || (result.status !== 0 && result.status !== 1)) {
    console.error(
      "Secret scan refused: cannot inspect tracked source directives",
    );
    process.exit(1);
  }

  if (result.status === 0) {
    console.error(
      "Secret scan refused: tracked source contains an inline scanner suppression",
    );
    process.exit(1);
  }
}

function runSecretlint() {
  const executable =
    process.platform === "win32" ? "secretlint.cmd" : "secretlint";
  const result = spawnSync(executable, ["--no-gitignore", "**/*"], {
    cwd: workspaceRoot,
    stdio: "inherit",
  });

  if (result.error || result.status === null) {
    console.error("Secret scan failed before the scanner returned a result");
    process.exit(1);
  }

  process.exitCode = result.status;
}

rejectUnsafeWorkspaceEntries();
const trackedFiles = readTrackedFiles();
rejectIgnoredTrackedFiles(trackedFiles);
rejectInlineSuppressions();
runSecretlint();
