import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { collectRegressionArtifacts } from "./regression-artifacts.mjs";
import { planRegression } from "./regression-plan.mjs";
import { regressionSuiteEnvironment } from "./regression-environment.mjs";
import {
  createRegressionWorkspace,
  readRegressionInventory,
  regressionWorkspacePath,
} from "./regression-workspace.mjs";
import {
  runRegressionCommand,
  runRegressionSteps,
} from "./regression-runner.mjs";

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const usage = `Usage: pnpm verify:regression [--suite quality|catalog|commerce|operations|journey] [--output NEW_DIRECTORY] [--plan]

Runs the fixed local regression matrix in a new source-only workspace with a frozen install.
Default: all five suites, failing at the first error. --suite is explicitly partial.
Requires Docker for S3, Chrome and PostgreSQL 18; POSTGRES_TEST_BIN selects one native runtime for every suite.
No user instance, database, private .env or old evidence is copied. No cloud, real money or Git push.
Logs, source fingerprints, coverage and the owned workspace path are preserved on failure.
CI execution and human/real-provider acceptance must still be recorded separately.`;

async function main() {
  const plan = planRegression(process.argv.slice(2), { root });
  if (plan.mode !== "run") {
    console.log(plan.mode === "help" ? usage : JSON.stringify(plan, null, 2));
    return;
  }
  await mkdir(path.dirname(plan.output), { recursive: true });
  await mkdir(plan.output, { mode: 0o700 });
  const runId = randomUUID();
  const workspace = regressionWorkspacePath(root, runId);
  const report = {
    schemaVersion: 1,
    runId,
    status: "RUNNING",
    scope: plan.scope,
    sourceHash: null,
    sourceHead: null,
    workspace,
    artifacts: path.join(workspace, "output"),
    startedAt: new Date().toISOString(),
    preparation: [],
    execution: null,
  };
  const save = () =>
    writeFile(
      path.join(plan.output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  await writeFile(
    path.join(plan.output, "plan.json"),
    JSON.stringify(plan, null, 2) + "\n",
    { flag: "wx" },
  );
  await save();
  try {
    const toolEnvironment = regressionSuiteEnvironment("source", process.env);
    report.postgresSelection = {
      kind:
        toolEnvironment.POSTGRES_TEST_BIN === undefined
          ? "DEFAULT_DOCKER_WITH_NATIVE_JOURNEY"
          : "EXPLICIT_NATIVE_18",
      configuredBy:
        toolEnvironment.POSTGRES_TEST_BIN === undefined
          ? "harness defaults"
          : "POSTGRES_TEST_BIN (validated common selection)",
    };
    const inventory = await readRegressionInventory(root);
    report.sourceHead = (
      await execute("git", ["rev-parse", "HEAD"], {
        cwd: root,
        env: regressionSuiteEnvironment("source", process.env),
      })
    ).stdout.trim();
    const manifest = await createRegressionWorkspace({
      source: root,
      destination: workspace,
      inventory,
    });
    report.sourceHash = manifest.sourceHash;
    await writeFile(
      path.join(plan.output, "source.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      { flag: "wx" },
    );
    const options = { output: plan.output, workspace };
    for (const step of [
      {
        label: "initialize-isolated-index",
        command: "git",
        args: ["init", "--quiet"],
      },
      {
        label: "index-isolated-source",
        command: "git",
        args: ["add", "--all"],
      },
      {
        label: "commit-isolated-source",
        command: "git",
        args: [
          "-c",
          "user.name=Local Regression",
          "-c",
          "user.email=regression@example.invalid",
          "-c",
          "commit.gpgsign=false",
          "-c",
          "core.hooksPath=/dev/null",
          "commit",
          "--quiet",
          "-m",
          "Freeze isolated regression inputs",
        ],
      },
      {
        label: "frozen-install",
        command: "corepack",
        args: ["pnpm", "install", "--frozen-lockfile", "--offline"],
      },
    ]) {
      const result = await runRegressionCommand(step, {
        ...options,
        environment: regressionSuiteEnvironment("preparation", process.env),
      });
      report.preparation.push(result);
      await save();
      if (result.status !== "PASS")
        throw new Error("Regression preparation failed");
    }
    report.execution = await runRegressionSteps(plan, options);
    report.status = report.execution.status;
  } catch {
    report.status = "FAIL";
    report.failure =
      "Inspect retained step logs; inputs and owned TEST data are preserved.";
  } finally {
    try {
      report.archive = await collectRegressionArtifacts(
        path.join(workspace, "output"),
        path.join(plan.output, "artifacts"),
      );
    } catch {
      report.status = "FAIL";
      report.failure =
        "Evidence archive failed; originals remain in the owned workspace.";
    }
    report.completedAt = new Date().toISOString();
    await save();
    console.log(
      JSON.stringify({
        status: report.status,
        completeLocalMatrix: report.execution?.coverage.complete === true,
        report: path.join(plan.output, "report.json"),
        workspace,
      }),
    );
    if (report.status !== "PASS") process.exitCode = 1;
  }
}
main().catch(() => {
  console.error(
    "regression: invalid options, existing output, or unavailable source; use --help",
  );
  process.exitCode = 1;
});
