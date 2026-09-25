import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  planPspOnboarding,
  runPspOnboarding,
} from "./verify-psp-onboarding.mjs";

test("plan fixes local TEST gates and excludes actual merchant acceptance", () => {
  const plan = planPspOnboarding(["--plan"]);
  assert.equal(plan.mode, "plan");
  assert.deepEqual(
    plan.steps.map((step) => step.label),
    ["build", "fake-conformance", "adapter-tests", "staged-rollout"],
  );
  assert.equal(plan.scope.realMoney, false);
  assert.equal(plan.scope.commercialSandbox, false);
  assert.equal(plan.scope.productionRelease, false);
  assert.equal(plan.scope.browser, false);
  assert.equal(
    plan.steps.at(-1).args[0],
    "apps/api/scripts/psp-onboarding-http.mjs",
  );
  assert.equal(
    plan.steps[2].args.includes("@fan-support/payment-gateway"),
    true,
  );
  assert.equal(plan.steps[2].args.includes("@fan-support/payment-fake"), true);
});

test("unknown or repeated options and existing-database selectors are rejected", () => {
  for (const args of [
    ["--live"],
    ["--skip-build"],
    ["--database", "remote"],
    ["--output"],
    ["--output", ""],
    ["--plan", "--plan"],
    ["--output", "a", "--output", "b"],
    ["--help", "--plan"],
  ]) {
    assert.throws(() => planPspOnboarding(args), /psp-onboarding/u);
  }
});

test("plan/help do not create artifacts or start children", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "psp-plan-"));
  try {
    for (const args of [
      ["--plan", "--output", path.join(directory, "new")],
      ["--help"],
    ]) {
      assert.equal(
        await runPspOnboarding(planPspOnboarding(args), {
          log: () => {},
          runCommand: () => assert.fail("must not start children"),
        }),
        0,
      );
    }
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true });
  }
});

async function scenario(t, results) {
  const directory = await mkdtemp(path.join(tmpdir(), "psp-runner-"));
  t.after(() => rm(directory, { recursive: true }));
  const output = path.join(directory, "run");
  const plan = planPspOnboarding(["--output", output]);
  const seen = [];
  const exitCode = await runPspOnboarding(plan, {
    log: () => {},
    runCommand: (command, args, options) => {
      assert.equal(options.shell, false);
      seen.push({ command, args });
      const result = results[seen.length - 1];
      assert.ok(result, "must not execute unplanned later step");
      return result;
    },
  });
  const report = JSON.parse(
    await readFile(path.join(output, "result.json"), "utf8"),
  );
  return { exitCode, report, seen, output, plan };
}

test("first failure stops later stages and records no false PASS", async (t) => {
  const result = await scenario(t, [{ status: 0 }, { status: 17 }]);
  assert.equal(result.exitCode, 17);
  assert.equal(result.seen.length, 2);
  assert.equal(result.report.status, "FAIL");
  assert.equal(result.report.steps[1].exitCode, 17);
  assert.equal(result.report.completedSteps, 1);
  assert.deepEqual(result.report.notRun, ["adapter-tests", "staged-rollout"]);
});

test("spawn error or signal is failure without leaking exception content", async (t) => {
  for (const result of [
    { status: null, signal: "SIGTERM" },
    { error: new Error("PRIVATE_CANARY") },
  ]) {
    const actual = await scenario(t, [result]);
    assert.equal(actual.exitCode, 1);
    assert.equal(actual.report.status, "FAIL");
    assert.equal(
      JSON.stringify(actual.report).includes("PRIVATE_CANARY"),
      false,
    );
  }
});

test("all steps must pass and output directories are never overwritten", async (t) => {
  const result = await scenario(
    t,
    Array.from({ length: 4 }, () => ({ status: 0 })),
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.status, "PASS");
  assert.equal(result.report.completedSteps, 4);
  assert.deepEqual(result.report.notRun, []);
  await assert.rejects(
    runPspOnboarding(result.plan, {
      log: () => {},
      runCommand: () => assert.fail("must not overwrite"),
    }),
    /EEXIST/u,
  );
});

test("real child exit status and output are preserved", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "psp-child-"));
  t.after(() => rm(directory, { recursive: true }));
  const output = path.join(directory, "run");
  const plan = planPspOnboarding(["--output", output]);
  plan.steps = [
    {
      label: "failure-proof",
      command: process.execPath,
      args: ["-e", "console.log('safe child output'); process.exit(23)"],
    },
  ];
  assert.equal(
    await runPspOnboarding(plan, { log: () => {}, runCommand: spawnSync }),
    23,
  );
  assert.match(
    await readFile(path.join(output, "failure-proof.txt"), "utf8"),
    /safe child output/u,
  );
});

test("unexpected child launcher exception leaves a failed safe receipt", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "psp-throw-"));
  t.after(() => rm(directory, { recursive: true }));
  const output = path.join(directory, "run");
  const plan = planPspOnboarding(["--output", output]);
  assert.equal(
    await runPspOnboarding(plan, {
      log: () => {},
      runCommand: () => {
        throw new Error("PRIVATE_THROW_CANARY");
      },
    }),
    1,
  );
  const text = await readFile(path.join(output, "result.json"), "utf8");
  assert.equal(JSON.parse(text).status, "FAIL");
  assert.equal(JSON.parse(text).notRun.length, 3);
  assert.equal(text.includes("PRIVATE_THROW_CANARY"), false);
});
