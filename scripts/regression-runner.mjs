import { spawn } from "node:child_process";
import { open, writeFile } from "node:fs/promises";
import path from "node:path";
import { regressionCoverage } from "./regression-plan.mjs";
import { resolveSpawnCommand } from "./spawn-command.mjs";
import { regressionSuiteEnvironment } from "./regression-environment.mjs";
export { regressionSuiteEnvironment } from "./regression-environment.mjs";

/** Run fixed argv without a shell. Full child output remains in the owned evidence directory. */
export async function runRegressionCommand(
  step,
  { workspace, output, environment = process.env, log = console.log },
) {
  log(`[regression] ${step.label}`);
  const filename = `${step.label}.txt`;
  const file = await open(path.join(output, filename), "wx", 0o600);
  const startedAt = new Date().toISOString();
  let result;
  try {
    result = await new Promise((resolve) => {
      let resolved;
      try {
        resolved = resolveSpawnCommand(step.command, step.args);
      } catch {
        resolve({ exitCode: 1, signal: null, launchFailed: true });
        return;
      }
      const child = spawn(resolved.command, resolved.args, {
        cwd: workspace,
        env: environment,
        shell: false,
        stdio: ["ignore", file.fd, file.fd],
      });
      child.once("error", () =>
        resolve({ exitCode: 1, signal: null, launchFailed: true }),
      );
      child.once("close", (exitCode, signal) =>
        resolve({ exitCode, signal, launchFailed: false }),
      );
    });
  } finally {
    await file.close();
  }
  return {
    label: step.label,
    startedAt,
    completedAt: new Date().toISOString(),
    log: filename,
    ...result,
    status:
      result.exitCode === 0 && !result.signal && !result.launchFailed
        ? "PASS"
        : "FAIL",
  };
}

/** Fail at the first unsuccessful child; persist every completed result and all not-run suites. */
export async function runRegressionSteps(plan, options) {
  const report = {
    schemaVersion: 1,
    status: "RUNNING",
    startedAt: new Date().toISOString(),
    suites: plan.suites.map(({ id }) => ({ id, status: "NOT_RUN" })),
    steps: [],
    coverage: regressionCoverage([]),
  };
  const save = () =>
    writeFile(
      path.join(options.output, "steps.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  await save();
  for (const suite of plan.suites) {
    const state = report.suites.find(({ id }) => id === suite.id);
    state.status = "RUNNING";
    for (const step of suite.commands) {
      const result = await runRegressionCommand(
        { ...step, label: `${suite.id}-${step.label}` },
        {
          ...options,
          environment: regressionSuiteEnvironment(
            suite.id,
            options.environment ?? process.env,
          ),
        },
      );
      report.steps.push({ suite: suite.id, ...result });
      if (result.status === "FAIL") {
        state.status = "FAIL";
        break;
      }
      await save();
    }
    if (state.status !== "FAIL") state.status = "PASS";
    report.coverage = regressionCoverage(report.suites);
    await save();
    if (state.status === "FAIL") break;
  }
  report.status = report.suites.every(({ status }) => status === "PASS")
    ? "PASS"
    : "FAIL";
  report.completedAt = new Date().toISOString();
  await save();
  return report;
}
