import { spawnSync } from "node:child_process";
import { glob, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(entry), "..");
const usage = `Usage: pnpm check:dev [--plan] [--filter PACKAGE[...]]
       pnpm check:dev --help

Development checks only; not formal acceptance.
Without --filter: all workspaces, including consumers.
PACKAGE: that package; existing Turbo task dependencies still apply.
PACKAGE...: that package and its transitive dependencies.
Filtered runs do not select consumers. Use no filter to check consumers.
Workspace/domain boundaries, format and lint always cover the whole repository.
Turbo typecheck, test and build run sequentially, reusing their normal cache.
No PostgreSQL, S3, browser or formal acceptance is run.
--plan prints the command plan without starting any checks.
Only exact existing package names are accepted; no Git selectors or globs.`;

/** Serializable command plan; package names come from the actual workspace. */
export function planDevelopmentCheck(args, packageNames) {
  let mode = "run";
  let filter = null;
  if (args.length === 1 && args[0] === "--help") mode = "help";
  else {
    for (let index = 0; index < args.length; index++) {
      if (args[index] === "--plan" && mode === "run") mode = "plan";
      else if (args[index] === "--filter" && filter === null) {
        filter = args[++index];
        const name = filter?.endsWith("...") ? filter.slice(0, -3) : filter;
        if (!name || !packageNames.includes(name)) {
          throw new Error(
            "check:dev: --filter requires an exact workspace package, optionally followed by ...",
          );
        }
      } else {
        throw new Error(
          "check:dev: unsupported or repeated option; use --help",
        );
      }
    }
  }
  const pnpm = (label, args) => ({
    label,
    command: "corepack",
    args: ["pnpm", ...args],
  });
  return {
    schemaVersion: 1,
    mode,
    notice:
      "Development checks only; success is not formal acceptance. Use pnpm check and task-specific acceptance separately.",
    scope: {
      filter,
      consumers: filter === null ? "all-workspaces" : "not-selected",
      packageDependencies:
        filter === null || filter.endsWith("...")
          ? "transitive"
          : "task-graph-only",
      global: ["workspace", "domain-boundaries", "format", "lint"],
    },
    excludes: ["PostgreSQL", "S3", "browser", "formal acceptance"],
    commands: [
      {
        label: "workspace",
        command: process.execPath,
        args: ["./scripts/check-workspace.mjs"],
      },
      {
        label: "domain-boundaries",
        command: process.execPath,
        args: ["./scripts/check-domain-boundaries.mjs"],
      },
      pnpm("format", ["run", "format:check"]),
      pnpm("lint", ["run", "lint"]),
      ...["typecheck", "test", "build"].map((task) =>
        pnpm(task, [
          "exec",
          "turbo",
          "run",
          task,
          "--output-logs=errors-only",
          "--concurrency=2",
          ...(filter ? [`--filter=${filter}`] : []),
        ]),
      ),
    ],
  };
}

/** Run one process at a time, retaining the first failing exit status. */
export function runDevelopmentCheck(
  plan,
  { cwd = workspaceRoot, runCommand = spawnSync, log = console.log } = {},
) {
  if (plan.mode === "help") {
    log(usage);
    return 0;
  }
  if (plan.mode === "plan") {
    log(JSON.stringify(plan, null, 2));
    return 0;
  }
  log(plan.notice);
  log(
    `Scope: ${plan.scope.filter ?? "all workspaces"}; consumers: ${plan.scope.consumers}.`,
  );
  for (const step of plan.commands) {
    log(`[check:dev] ${step.label}`);
    const result = runCommand(step.command, step.args, {
      cwd,
      stdio: "inherit",
      shell: false,
    });
    if (result.error || result.signal || result.status !== 0) {
      const status =
        Number.isInteger(result.status) && result.status > 0
          ? result.status
          : 1;
      log(
        `[check:dev] stopped at ${step.label} (exit ${status}); later checks did not run.`,
      );
      return status;
    }
  }
  log(
    "Development checks passed. PG/S3/browser/formal acceptance were not run.",
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === entry) {
  try {
    const names = [];
    for await (const filename of glob(
      ["apps/*/package.json", "packages/*/package.json"],
      { cwd: workspaceRoot },
    )) {
      const manifest = JSON.parse(
        await readFile(path.join(workspaceRoot, filename), "utf8"),
      );
      names.push(manifest.name);
    }
    process.exitCode = runDevelopmentCheck(
      planDevelopmentCheck(process.argv.slice(2), names),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "check:dev failed");
    process.exitCode = 1;
  }
}
