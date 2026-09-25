import { spawnSync } from "node:child_process";
import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveSpawnCommand } from "./spawn-command.mjs";

/** Spawn a fixed argv without a shell, portable to Windows corepack. */
function spawnPortable(command, args, options) {
  const resolved = resolveSpawnCommand(command, args);
  return spawnSync(resolved.command, resolved.args, options);
}

const entry = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(entry), "..");
const usage = `Usage: pnpm verify:psp-onboarding [--plan] [--output NEW_DIRECTORY]
       pnpm verify:psp-onboarding --help

Local TEST conformance and actual isolated PostgreSQL/TLS rollout drill only.
Optional PSP_ONBOARDING_TEST_POSTGRES_BIN: absolute PostgreSQL 18 bin directory.
Otherwise the existing temporary Docker PostgreSQL harness is used.
No existing database, merchant credentials or LIVE environment can be selected.
--plan prints the commands without creating files or starting services.
Existing output directories are refused. Review result.json and every step log.
Commercial PSP sandbox, real funds, browser UAT and production release are excluded.`;

export function planPspOnboarding(args) {
  let mode = "run",
    output;
  if (args.length === 1 && args[0] === "--help") mode = "help";
  else
    for (let index = 0; index < args.length; index++) {
      if (args[index] === "--plan" && mode === "run") mode = "plan";
      else if (args[index] === "--output" && output === undefined) {
        output = args[++index];
        if (
          typeof output !== "string" ||
          !output.trim() ||
          output.startsWith("--")
        )
          throw new Error("psp-onboarding: --output requires a new directory");
      } else
        throw new Error(
          "psp-onboarding: unsupported or repeated option; use --help",
        );
    }
  const node = (label, args) => ({ label, command: process.execPath, args });
  const pnpm = (label, args) => ({
    label,
    command: "corepack",
    args: ["pnpm", ...args],
  });
  return {
    schemaVersion: 1,
    mode,
    output: path.resolve(
      workspaceRoot,
      output ??
        `output/checks/p5-07-psp-onboarding/drill-${new Date().toISOString().replaceAll(":", "-")}`,
    ),
    scope: {
      environment: "LOCAL_TEST",
      commercialSandbox: false,
      realMoney: false,
      productionRelease: false,
      browser: false,
    },
    steps: [
      pnpm("build", [
        "exec",
        "turbo",
        "run",
        "build",
        "--filter=@fan-support/api...",
        "--filter=@fan-support/worker...",
        "--filter=@fan-support/testing...",
        "--output-logs=errors-only",
      ]),
      node("fake-conformance", ["scripts/psp-onboarding-conformance.mjs"]),
      pnpm("adapter-tests", [
        "--filter",
        "@fan-support/payment-fake",
        "--filter",
        "@fan-support/payment-gateway",
        "test",
      ]),
      node("staged-rollout", ["apps/api/scripts/psp-onboarding-http.mjs"]),
    ],
  };
}

/** Sequential fixed local gates. Never overwrite evidence or continue after failure. */
export async function runPspOnboarding(
  plan,
  { runCommand = spawnPortable, log = console.log } = {},
) {
  if (plan.mode !== "run") {
    log(plan.mode === "help" ? usage : JSON.stringify(plan, null, 2));
    return 0;
  }
  await mkdir(path.dirname(plan.output), { recursive: true });
  await mkdir(plan.output, { mode: 0o700 });
  await writeFile(
    path.join(plan.output, "plan.json"),
    JSON.stringify(plan, null, 2) + "\n",
    { flag: "wx" },
  );
  const report = {
    schemaVersion: 1,
    status: "FAIL",
    scope: plan.scope,
    startedAt: new Date().toISOString(),
    steps: [],
    completedSteps: 0,
    notRun: plan.steps.map((step) => step.label),
  };
  let exitCode = 0;
  const save = () =>
    writeFile(
      path.join(plan.output, "result.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  await save();
  for (const step of plan.steps) {
    log(
      `[psp-onboarding] ${step.label}; ${path.join(plan.output, `${step.label}.txt`)}`,
    );
    const handle = await open(
      path.join(plan.output, `${step.label}.txt`),
      "wx",
      0o600,
    );
    const startedAt = new Date().toISOString();
    let result;
    try {
      result = runCommand(step.command, step.args, {
        cwd: workspaceRoot,
        shell: false,
        stdio: ["ignore", handle.fd, handle.fd],
      });
    } catch {
      result = { status: null };
    } finally {
      await handle.close();
    }
    const failed = Boolean(
      result.error || result.signal || result.status !== 0,
    );
    exitCode = 0;
    if (failed) {
      exitCode =
        Number.isInteger(result.status) && result.status > 0
          ? result.status
          : 1;
    }
    report.steps.push({
      label: step.label,
      exitCode,
      startedAt,
      completedAt: new Date().toISOString(),
      log: `${step.label}.txt`,
    });
    report.notRun.shift();
    if (!failed) report.completedSteps++;
    await save();
    if (failed) break;
  }
  report.status =
    exitCode === 0 && report.completedSteps === plan.steps.length
      ? "PASS"
      : "FAIL";
  report.completedAt = new Date().toISOString();
  await save();
  log(
    `[psp-onboarding] ${report.status}; ${path.join(plan.output, "result.json")}`,
  );
  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === entry) {
  try {
    process.exitCode = await runPspOnboarding(
      planPspOnboarding(process.argv.slice(2)),
    );
  } catch {
    console.error(
      "psp-onboarding: invalid options, output already exists or local execution unavailable; use --help and inspect preserved evidence",
    );
    process.exitCode = 1;
  }
}
