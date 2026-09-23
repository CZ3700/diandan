import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const module = await import("./regression-runner.mjs").catch(() => ({}));
const execute = promisify(execFile);

test("Git snapshot preparation cannot redirect an owned commit to another repository", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "regression-git-"));
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const commit = [
    "-c",
    "user.name=Regression",
    "-c",
    "user.email=regression@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--quiet",
    "-m",
    "Fixture",
  ];
  try {
    const control = path.join(directory, "control"),
      owned = path.join(directory, "owned"),
      output = path.join(directory, "evidence");
    await Promise.all([control, owned, output].map((name) => mkdir(name)));
    const git = async (...args) =>
      (await execute("git", args, { cwd: control, env: clean })).stdout.trim();
    await git("init", "--quiet");
    await writeFile(path.join(control, "user.txt"), "existing user data");
    await git("add", "--all");
    await git(...commit);
    const head = await git("rev-parse", "HEAD");
    await writeFile(path.join(control, "user.txt"), "uncommitted user changes");
    const index = await readFile(path.join(control, ".git/index"));
    await writeFile(path.join(owned, "owned.txt"), "owned snapshot");
    const result = await module.runRegressionSteps(
      {
        suites: [
          {
            id: "quality",
            commands: [
              {
                label: "initialize",
                command: "git",
                args: ["init", "--quiet"],
              },
              { label: "index", command: "git", args: ["add", "--all"] },
              { label: "commit", command: "git", args: commit },
            ],
          },
        ],
      },
      {
        workspace: owned,
        output,
        log: () => {},
        environment: {
          ...clean,
          GIT_DIR: path.join(control, ".git"),
          GIT_WORK_TREE: control,
          GIT_COMMON_DIR: path.join(control, ".git"),
          GIT_INDEX_FILE: path.join(control, ".git/index"),
        },
      },
    );
    assert.equal(result.status, "PASS");
    assert.equal(
      await git("rev-parse", "HEAD"),
      head,
      "Control HEAD must remain unchanged",
    );
    assert.deepEqual(await readFile(path.join(control, ".git/index")), index);
    assert.equal(
      await readFile(path.join(control, "user.txt"), "utf8"),
      "uncommitted user changes",
    );
    assert.equal(
      (
        await execute("git", ["ls-tree", "--name-only", "HEAD"], {
          cwd: owned,
          env: clean,
        })
      ).stdout.trim(),
      "owned.txt",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("suite environment drops all Git overrides while preserving host tooling", () => {
  const result = module.regressionSuiteEnvironment("quality", {
    PATH: "/host/tools",
    DISPLAY: ":10",
    GITHUB_ACTIONS: "true",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.worktree",
    GIT_CONFIG_VALUE_0: "/unrelated",
    GIT_OBJECT_DIRECTORY: "/unrelated/objects",
    GIT_CONFIG_PARAMETERS: "injected",
  });
  assert.deepEqual(result, {
    PATH: "/host/tools",
    DISPLAY: ":10",
    GITHUB_ACTIONS: "true",
  });
});

test("suite processes receive tooling settings without inherited application configuration", async () => {
  const output = await mkdtemp(
    path.join(os.tmpdir(), "regression-environment-"),
  );
  try {
    for (const suite of ["quality", "journey"]) {
      const directory = path.join(output, suite);
      await mkdir(directory);
      const result = await module.runRegressionSteps(
        {
          suites: [
            {
              id: suite,
              commands: [
                {
                  label: "environment",
                  command: process.execPath,
                  args: [
                    "-e",
                    `
          const valid = process.env.FAN_SUPPORT_SITE_ORIGIN === undefined
            && process.env.FAN_SUPPORT_REGRESSION_WEB_MODE === undefined
            && process.env.FAN_SUPPORT_LOCAL_POSTGRES_BIN === ${suite === "journey" ? "'/owned/postgres'" : "undefined"}
            && process.env.ADMIN_FINANCE_TEST_POSTGRES_BIN === undefined
            && process.env.POSTGRES_TEST_BIN === '/owned/postgres';
          process.exit(valid ? 0 : 9);
        `,
                  ],
                },
              ],
            },
          ],
        },
        {
          output: directory,
          workspace: directory,
          log: () => {},
          environment: {
            PATH: process.env.PATH,
            FAN_SUPPORT_SITE_ORIGIN: "https://ambient.example.invalid",
            FAN_SUPPORT_REGRESSION_WEB_MODE: "unexpected",
            FAN_SUPPORT_LOCAL_POSTGRES_BIN: "/owned/postgres",
            ADMIN_FINANCE_TEST_POSTGRES_BIN: "/owned/postgres",
          },
        },
      );
      assert.equal(
        result.status,
        "PASS",
        `${suite} has only its required tooling input`,
      );
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("runner stops after a failing process and retains the failed step without claiming missing suites", async () => {
  assert.equal(typeof module.runRegressionSteps, "function");
  const output = await mkdtemp(path.join(os.tmpdir(), "regression-runner-"));
  try {
    const plan = {
      suites: [
        {
          id: "quality",
          commands: [
            {
              label: "failure",
              command: process.execPath,
              args: ["-e", "process.exit(7)"],
            },
            {
              label: "unreachable",
              command: process.execPath,
              args: ["-e", "process.exit(0)"],
            },
          ],
        },
        { id: "journey", commands: [] },
      ],
    };
    const result = await module.runRegressionSteps(plan, {
      output,
      workspace: output,
      log: () => {},
    });
    assert.equal(result.status, "FAIL");
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].exitCode, 7);
    assert.equal(result.coverage.complete, false);
    assert.equal(result.suites[1].status, "NOT_RUN");
    assert.equal(
      JSON.parse(await readFile(path.join(output, "steps.json"), "utf8"))
        .status,
      "FAIL",
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("runner records successful partial execution as partial coverage", async () => {
  assert.equal(typeof module.runRegressionSteps, "function");
  const output = await mkdtemp(path.join(os.tmpdir(), "regression-runner-"));
  try {
    const result = await module.runRegressionSteps(
      {
        suites: [
          {
            id: "quality",
            commands: [
              {
                label: "success",
                command: process.execPath,
                args: ["-e", "process.stdout.write('ok')"],
              },
            ],
          },
        ],
      },
      { output, workspace: output, log: () => {} },
    );
    assert.equal(result.status, "PASS");
    assert.equal(result.coverage.complete, false);
    assert.equal(
      await readFile(path.join(output, result.steps[0].log), "utf8"),
      "ok",
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
