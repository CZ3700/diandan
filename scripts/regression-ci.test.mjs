import { URL } from "node:url";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";
import { planRegression } from "./regression-plan.mjs";
const workflow = parse(
  await readFile(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  ),
);

test("required Quality result is gated by every regression suite, even on failure or cancellation", () => {
  const regression = workflow.jobs.regression;
  assert.ok(regression, "CI must run the full regression matrix");
  assert.deepEqual(
    regression.strategy.matrix.suite,
    planRegression([]).suites.map(({ id }) => id),
  );
  assert.equal(regression.strategy["fail-fast"], false);
  assert.equal(workflow.jobs.quality.needs, "regression");
  assert.equal(workflow.jobs.quality.if, "always()");
  const gate = workflow.jobs.quality.steps.at(-1);
  assert.equal(gate.env.REGRESSION_RESULT, "${{ needs.regression.result }}");
  assert.equal(gate.run, 'test "$REGRESSION_RESULT" = success');
  assert.equal(regression["continue-on-error"], undefined);
});

test("CI provisions the required runtimes and preserves failure evidence without private instance state", () => {
  const steps = workflow.jobs.regression?.steps;
  assert.ok(steps, "CI regression steps must exist");
  assert.ok(
    steps.some(
      (step) =>
        step.run === "pnpm exec playwright install --with-deps chrome chromium",
    ),
  );
  assert.ok(steps.some((step) => step.run?.includes("postgresql-18")));
  const upload = steps.find(
    (step) => step.name === "Preserve regression evidence",
  );
  assert.equal(upload.if, "always()");
  assert.match(upload.uses, /^actions\/upload-artifact@[a-f0-9]{40}$/u);
  assert.equal(upload.with.path, "output/checks/p6-01-regression/ci");
  assert.equal(upload.with["include-hidden-files"], undefined);
});
