import assert from "node:assert/strict";
import test from "node:test";

const module = await import("./regression-plan.mjs").catch(() => ({}));

test("full regression includes every fixed suite without substituting development checks", () => {
  assert.equal(
    typeof module.planRegression,
    "function",
    "The complete regression plan must exist",
  );
  const plan = module.planRegression([]);
  assert.deepEqual(
    plan.suites.map((entry) => entry.id),
    ["quality", "catalog", "commerce", "operations", "journey"],
  );
  assert.deepEqual(
    plan.suites[0].commands.map(({ args }) => args.join(" ")),
    [
      "pnpm test:regression-tools",
      "pnpm verify:ui-composites:browser",
      "pnpm verify:ui-motion:browser",
      "pnpm check",
    ],
  );
  assert.equal(plan.scope.realMoney, false);
  assert.equal(plan.scope.remoteCi, false);
  assert.equal(plan.requirements.length, 14);
  assert.ok(plan.requirements.every((entry) => entry.suites.length > 0));
});

test("selected suites are explicitly partial, with no arbitrary executable input", () => {
  assert.equal(typeof module.planRegression, "function");
  const plan = module.planRegression(["--suite", "commerce", "--plan"]);
  assert.equal(plan.mode, "plan");
  assert.deepEqual(
    plan.suites.map((entry) => entry.id),
    ["commerce"],
  );
  assert.equal(plan.complete, false);
  for (const args of [
    ["--suite", "unknown"],
    ["--suite", "commerce", "--suite", "quality"],
    ["--skip"],
    ["--output"],
    ["--output", "--plan"],
  ])
    assert.throws(() => module.planRegression(args));
});

test("operations exercises the real login and permission UI before privileged flows", () => {
  const operations = module.planRegression(["--suite", "operations"]).suites[0];
  assert.equal(
    operations.commands[0].args.join(" "),
    "pnpm verify:admin-access:browser",
  );
});

test("coverage remains incomplete when a required suite fails or is missing", () => {
  assert.equal(typeof module.regressionCoverage, "function");
  const partial = module.regressionCoverage([
    { id: "quality", status: "PASS" },
  ]);
  assert.equal(partial.complete, false);
  assert.ok(partial.requirements.some((entry) => entry.status === "NOT_RUN"));
  const all = module
    .planRegression([])
    .suites.map(({ id }) => ({ id, status: "PASS" }));
  assert.equal(module.regressionCoverage(all).complete, true);
  all.find((entry) => entry.id === "journey").status = "FAIL";
  assert.equal(module.regressionCoverage(all).complete, false);
  assert.equal(
    module
      .regressionCoverage(all)
      .requirements.find((entry) => entry.id === "E2E-11").status,
    "FAIL",
  );
});
