import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRegressionWorkspace,
  readRegressionInventory,
  regressionWorkspacePath,
  verifyRegressionSource,
} from "./regression-workspace.mjs";
import { regressionSuiteEnvironment } from "./regression-environment.mjs";
import { runRegressionCommand } from "./regression-runner.mjs";
import { collectRegressionArtifacts } from "./regression-artifacts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const args = process.argv.slice(2);
  if (
    args.length !== 0 &&
    !(args.length === 2 && args[0] === "--output" && args[1])
  )
    throw new Error(
      "Use node scripts/accessibility-runner.mjs [--output NEW_DIRECTORY]",
    );
  const runId = randomUUID();
  const output = path.resolve(
    root,
    args[1] ?? `output/checks/p6-02-accessibility/run-${runId}`,
  );
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output, { mode: 0o700 });
  const workspace = regressionWorkspacePath(root, runId);
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    runId,
    workspace,
    steps: [],
    sourceHash: null,
    startedAt: new Date().toISOString(),
  };
  const save = () =>
    writeFile(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  await save();
  try {
    const inventory = await readRegressionInventory(root);
    const manifest = await createRegressionWorkspace({
      source: root,
      destination: workspace,
      inventory,
    });
    report.sourceHash = manifest.sourceHash;
    await writeFile(
      path.join(output, "source.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      { flag: "wx" },
    );
    const steps = [
      {
        label: "initialize-isolated-index",
        command: "git",
        args: ["init", "--quiet"],
      },
      { label: "freeze-source-index", command: "git", args: ["add", "--all"] },
      {
        label: "freeze-source-commit",
        command: "git",
        args: [
          "-c",
          "user.name=Local Accessibility",
          "-c",
          "user.email=accessibility@example.invalid",
          "-c",
          "commit.gpgsign=false",
          "-c",
          "core.hooksPath=/dev/null",
          "commit",
          "--quiet",
          "-m",
          "Freeze isolated accessibility inputs",
        ],
      },
      {
        label: "frozen-install",
        command: "corepack",
        args: ["pnpm", "install", "--frozen-lockfile", "--offline"],
      },
      {
        label: "browser",
        command: process.execPath,
        args: ["scripts/accessibility-owned.mjs"],
      },
    ];
    for (const step of steps) {
      const result = await runRegressionCommand(step, {
        workspace,
        output,
        environment: regressionSuiteEnvironment("journey", process.env),
      });
      report.steps.push(result);
      await save();
      if (result.status !== "PASS")
        throw new Error("Accessibility subprocess failed");
    }
    await verifyRegressionSource(workspace, manifest);
    report.status = "PASS";
  } catch {
    report.status = "FAIL";
    report.failure =
      "Owned workspace, safe evidence and TEST data are retained for diagnosis.";
  } finally {
    try {
      report.archive = await collectRegressionArtifacts(
        path.join(workspace, "output"),
        path.join(output, "artifacts"),
      );
    } catch {
      report.status = "FAIL";
      report.archiveFailed = true;
    }
    report.completedAt = new Date().toISOString();
    await save();
    console.log(
      JSON.stringify({
        status: report.status,
        report: path.join(output, "report.json"),
        workspace,
      }),
    );
    if (report.status !== "PASS") process.exitCode = 1;
  }
}

main().catch(() => {
  console.error(
    "Accessibility runner rejected options or an existing output; no existing user instance is selectable.",
  );
  process.exitCode = 1;
});
