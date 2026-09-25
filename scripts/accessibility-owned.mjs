import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRegressionCommand } from "./regression-runner.mjs";
import { regressionSuiteEnvironment } from "./regression-environment.mjs";
import {
  runJourneyLifecycle,
  regressionInstanceName,
} from "./regression-journey-lifecycle.mjs";
import { resolveLocalPostgresBin } from "../apps/api/scripts/local-experience-postgres.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv.length !== 2)
  throw new Error(
    "Owned accessibility run accepts no existing instance or external target",
  );
const instance = regressionInstanceName();
const output = path.join(
  root,
  "output/checks/p6-02-accessibility/browser",
  instance,
);
await mkdir(output, { recursive: true, mode: 0o700 });
const report = {
  schemaVersion: 1,
  instance,
  status: "RUNNING",
  commands: [],
  browser: null,
  dataPreserved: true,
};
let sequence = 0;
try {
  const environment = {
    ...regressionSuiteEnvironment("journey", process.env),
    FAN_SUPPORT_LOCAL_POSTGRES_BIN: await resolveLocalPostgresBin(root),
    FAN_SUPPORT_REGRESSION_WEB_MODE: "production",
  };
  async function command(label, executable, args) {
    const result = await runRegressionCommand(
      { label: `${++sequence}-${label}`, command: executable, args },
      { workspace: root, output, environment },
    );
    report.commands.push(result);
    if (result.status !== "PASS")
      throw new Error("Accessibility subprocess failed");
  }
  await command("build", "corepack", [
    "pnpm",
    "exec",
    "turbo",
    "run",
    "build",
    "--filter=@fan-support/api...",
    "--filter=@fan-support/worker...",
    "--filter=@fan-support/admin^...",
    "--filter=@fan-support/storefront^...",
    "--output-logs=errors-only",
    "--concurrency=2",
  ]);
  const { loadLocalState } = await import("./local-experience-state.mjs");
  const { verifyAccessibilityBrowser } =
    await import("../apps/api/scripts/accessibility-browser.mjs");
  const state = await loadLocalState(root, instance);
  const local = (action, args = []) =>
    command(action, process.execPath, [
      "scripts/local-experience.mjs",
      action,
      "--instance",
      instance,
      ...args,
    ]);
  report.browser = await runJourneyLifecycle({
    start: () => local("start", ["--skip-build"]),
    browser: () =>
      verifyAccessibilityBrowser({
        workspaceRoot: root,
        instance,
        output: path.join(output, "pages"),
      }),
    stop: () => local("stop"),
    reset: () => local("reset", ["--confirm", state.config.instanceId]),
  });
  report.status = "PASS";
  report.dataPreserved = false;
} catch {
  report.status = "FAIL";
  report.failure =
    "Inspect retained safe browser evidence and command logs. Owned TEST data retained.";
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      status: report.status,
      instance,
      report: path.join(output, "result.json"),
    }),
  );
}
