import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createRegressionWorkspace,
  readRegressionInventory,
  regressionWorkspacePath,
  verifyRegressionSource,
} from "../../../scripts/regression-workspace.mjs";
import {
  runRegressionCommand,
  regressionSuiteEnvironment,
} from "../../../scripts/regression-runner.mjs";
import { collectRegressionArtifacts } from "../../../scripts/regression-artifacts.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const name = process.argv[2];
if (process.argv.length !== 3 || !/^run-[1-9][0-9]*$/u.test(name ?? ""))
  throw new Error("Select a new owned run-N only");
const output = path.join(root, "output/checks/p6-04-security", name);
await mkdir(output, { mode: 0o700 });
const workspace = regressionWorkspacePath(root, randomUUID());
const environment = regressionSuiteEnvironment("journey", {
  ...process.env,
  POSTGRES_TEST_BIN: path.join(
    root,
    "output/checks/p5-03-refund-operations/native-runtime/dist/postgresql@18/18.6/bin",
  ),
  npm_config_registry: "https://registry.npmjs.org",
});
const report = {
  schemaVersion: 1,
  scope: "P6-04 owned local security regression, not all P6-01 suites",
  status: "RUNNING",
  startedAt: new Date().toISOString(),
  sourceHead: null,
  sourceHash: null,
  workspace,
  commands: [],
};
const save = () =>
  writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
const pnpm = (label, ...args) => ({
  label,
  command: "corepack",
  args: ["pnpm", ...args],
});
try {
  report.sourceHead = (
    await promisify(execFile)("git", ["rev-parse", "HEAD"], {
      cwd: root,
      env: environment,
    })
  ).stdout.trim();
  const source = await createRegressionWorkspace({
    source: root,
    destination: workspace,
    inventory: await readRegressionInventory(root),
  });
  report.sourceHash = source.sourceHash;
  await writeFile(
    path.join(output, "source.json"),
    JSON.stringify(source, null, 2) + "\n",
    { flag: "wx" },
  );
  await save();
  const previous = JSON.parse(await readFile(path.join(root, "output/checks/p6-04-security/run-1/report.json"), "utf8"));
  const original = JSON.parse(await readFile(path.join(root, "output/checks/p6-04-security/run-1/source.json"), "utf8"));
  assert.equal(previous.status, "FAIL");
  const priorFiles = new Map(original.files.map((file) => [file.path, file]));
  const changed = source.files.filter((file) => JSON.stringify(priorFiles.get(file.path)) !== JSON.stringify(file)).map((file) => file.path);
  assert.equal(source.files.length, original.files.length);
  assert.deepEqual(changed, ["apps/api/scripts/rum-browser.mjs"]);
  report.inputComparison = { originalSourceHash: original.sourceHash, changedFiles: changed, addedOrRemoved: 0, rationale: "Only the RUM browser acceptance locator changed; commands 06–09 and 11–15 do not consume this harness. Their original PASS results are reused, not rerun or relabeled as run-2 executions." };
  report.reusedCommands = previous.commands.filter((command) => /^(?:0[6-9]|1[1-5])-/u.test(command.label));
  assert.equal(report.reusedCommands.length, 9);
  assert.ok(report.reusedCommands.every((command) => command.status === "PASS"));
  await save();
  const steps = [
    { label: "01-git-init", command: "git", args: ["init", "--quiet"] },
    { label: "02-git-index", command: "git", args: ["add", "--all"] },
    {
      label: "03-git-freeze",
      command: "git",
      args: [
        "-c",
        "user.name=Local Security Verification",
        "-c",
        "user.email=security@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "--quiet",
        "-m",
        "Freeze isolated security verification inputs",
      ],
    },
    pnpm("04-frozen-install", "install", "--frozen-lockfile", "--offline"),
    pnpm("05-development-quality", "check:dev"),
    pnpm("10-performance-tools", "test:performance-tools"),
    pnpm("16-rum-browser", "verify:rum"),
    pnpm("17-seven-locale-journey", "verify:regression:journey"),
    {
      label: "18-artifact-boundaries",
      command: process.execPath,
      args: ["scripts/check-adapter-boundaries.mjs"],
    },
    {
      label: "19-built-artifacts",
      command: process.execPath,
      args: ["scripts/check-build-artifacts.mjs"],
    },
  ];
  for (const step of steps) {
    const result = await runRegressionCommand(step, {
      workspace,
      output,
      environment,
    });
    report.commands.push(result);
    await save();
    if (result.status !== "PASS")
      throw new Error("A recorded verification command failed");
  }
  await verifyRegressionSource(root, source);
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  try {
    report.archive = await collectRegressionArtifacts(
      path.join(workspace, "output"),
      path.join(output, "artifacts"),
    );
  } catch {
    report.status = "FAIL";
    report.archiveFailure = true;
    process.exitCode = 1;
  }
  report.completedAt = new Date().toISOString();
  await save();
  console.log(
    JSON.stringify({
      status: report.status,
      workspace,
      report: path.join(output, "report.json"),
    }),
  );
}
