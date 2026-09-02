import { spawnSync } from "node:child_process";

const ignoredDirectoryNames = new Set([
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
    encoding: "utf8",
    maxBuffer: maxGitOutputBytes,
  });
}

function isGeneratedArtifactPath(filePath) {
  const segments = filePath.split("/");
  return segments.some(
    (segment) =>
      ignoredDirectoryNames.has(segment) ||
      segment.endsWith(".tsbuildinfo") ||
      segment.endsWith(".log"),
  );
}

function isUnapprovedSecretlintPolicy(filePath) {
  if (allowedSecretlintPolicyFiles.has(filePath)) {
    return false;
  }

  const baseName = filePath.split("/").at(-1) ?? "";
  return (
    baseName.startsWith(".secretlintignore") ||
    baseName.startsWith(".secretlintrc")
  );
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
  const result = runGit(["grep", "-I", "-q", "-e", suppressionDirective, "--"]);

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
    stdio: "inherit",
  });

  if (result.error || result.status === null) {
    console.error("Secret scan failed before the scanner returned a result");
    process.exit(1);
  }

  process.exitCode = result.status;
}

const trackedFiles = readTrackedFiles();
rejectIgnoredTrackedFiles(trackedFiles);
rejectInlineSuppressions();
runSecretlint();
