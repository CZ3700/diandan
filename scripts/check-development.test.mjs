import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  planDevelopmentCheck,
  runDevelopmentCheck,
} from "./check-development.mjs";

const names = ["@fan-support/cart", "@fan-support/contracts"];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("default plan keeps global guards and cached tasks, without formal acceptance", () => {
  const plan = planDevelopmentCheck([], names);
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.mode, "run");
  assert.equal(plan.scope.filter, null);
  assert.equal(plan.scope.consumers, "all-workspaces");
  assert.deepEqual(
    plan.commands.map((step) => step.label),
    [
      "workspace",
      "domain-boundaries",
      "format",
      "lint",
      "typecheck",
      "test",
      "build",
    ],
  );
  for (const task of ["typecheck", "test", "build"]) {
    const step = plan.commands.find((item) => item.label === task);
    assert.deepEqual(step, {
      label: task,
      command: "corepack",
      args: [
        "pnpm",
        "exec",
        "turbo",
        "run",
        task,
        "--output-logs=errors-only",
        "--concurrency=2",
      ],
    });
  }
  assert.deepEqual(plan.excludes, [
    "PostgreSQL",
    "S3",
    "browser",
    "formal acceptance",
  ]);
  assert.match(plan.notice, /development/i);
});

test("explicit package scope and dependencies are exact; consumers are not inferred", () => {
  for (const filter of ["@fan-support/cart", "@fan-support/cart..."]) {
    const plan = planDevelopmentCheck(["--filter", filter, "--plan"], names);
    assert.equal(plan.mode, "plan");
    assert.equal(plan.scope.filter, filter);
    assert.equal(plan.scope.consumers, "not-selected");
    assert.equal(
      plan.scope.packageDependencies,
      filter.endsWith("...") ? "transitive" : "task-graph-only",
    );
    for (const step of plan.commands) {
      assert.equal(
        step.args.includes(`--filter=${filter}`),
        ["typecheck", "test", "build"].includes(step.label),
      );
    }
  }
});

test("unknown, empty, repeated and shell-like options are rejected", () => {
  const invalid = [
    ["--changed"],
    ["--filter"],
    ["--filter", ""],
    ["--filter=@fan-support/cart"],
    ["--filter", "@fan-support/typo"],
    ["--filter", "...@fan-support/cart"],
    ["--filter", "@fan-support/*"],
    ["--filter", "@fan-support/cart;exit 0"],
    ["--filter", "@fan-support/cart", "--filter", "@fan-support/contracts"],
    ["--plan", "--plan"],
    ["--help", "--plan"],
    ["--force"],
    ["--", "--plan"],
  ];
  for (const args of invalid)
    assert.throws(() => planDevelopmentCheck(args, names), /check:dev/);
});

test("plan and help never execute checks", () => {
  for (const args of [["--plan"], ["--help"]]) {
    const plan = planDevelopmentCheck(args, names);
    const lines = [];
    assert.equal(
      runDevelopmentCheck(plan, {
        cwd: root,
        log: (line) => lines.push(line),
        runCommand: () => assert.fail("planning must not execute a process"),
      }),
      0,
    );
    assert.ok(lines.length > 0);
  }
});

test("a real child failure exits unchanged and stops all later steps without a shell", () => {
  const plan = planDevelopmentCheck([], names);
  plan.commands = [
    {
      label: "first",
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
    },
    {
      label: "failure",
      command: process.execPath,
      args: ["-e", "process.exit(17)"],
    },
    {
      label: "must-not-run",
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
    },
  ];
  const labels = [];
  const status = runDevelopmentCheck(plan, {
    cwd: root,
    log: () => {},
    runCommand: (command, args, options) => {
      assert.equal(options.shell, false);
      assert.equal(options.cwd, root);
      labels.push(args.at(-1));
      return spawnSync(command, args, options);
    },
  });
  assert.equal(status, 17);
  assert.equal(labels.length, 2);
});

test("spawn errors and signalled children fail closed", () => {
  for (const result of [
    { status: null, signal: "SIGTERM" },
    { status: null, error: new Error("ENOENT") },
  ]) {
    let calls = 0;
    assert.equal(
      runDevelopmentCheck(planDevelopmentCheck([], names), {
        cwd: root,
        log: () => {},
        runCommand: () => {
          calls++;
          return result;
        },
      }),
      1,
    );
    assert.equal(calls, 1);
  }
});

test("CLI plan resolves real workspace names and unknown arguments have nonzero status", () => {
  const entry = path.join(root, "scripts/check-development.mjs");
  const valid = spawnSync(
    process.execPath,
    [entry, "--plan", "--filter", "@fan-support/cart..."],
    {
      cwd: root,
      encoding: "utf8",
      shell: false,
    },
  );
  assert.equal(valid.status, 0, valid.stderr);
  const plan = JSON.parse(valid.stdout);
  assert.equal(plan.mode, "plan");
  assert.equal(plan.scope.filter, "@fan-support/cart...");
  const invalid = spawnSync(
    process.execPath,
    [entry, "--filter", "@fan-support/not-a-package"],
    {
      cwd: root,
      encoding: "utf8",
      shell: false,
    },
  );
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /check:dev/);
});
