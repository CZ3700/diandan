import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanupAccessibilityResources,
  accessibilityFailure,
} from "./accessibility-cleanup.mjs";

test("each failed close still closes the other resources, removes profiles and saves safe FAIL evidence", async () => {
  for (const failure of ["context", "browser", "state", "remove", "save"]) {
    const calls = [];
    const action = (name) => async () => {
      calls.push(name);
      if (failure === name) throw new Error("PRIVATE_TOKEN_DO_NOT_PERSIST");
    };
    const report = { status: "PASS" };
    await cleanupAccessibilityResources({
      context: { close: action("context") },
      browser: { close: action("browser") },
      state: { close: action("state") },
      profiles: "/owned/temporary/profile",
      remove: action("remove"),
      save: action("save"),
      report,
    });
    assert.deepEqual(
      new Set(calls),
      new Set(["context", "browser", "state", "remove", "save"]),
    );
    assert(calls.indexOf("remove") > calls.indexOf("state"));
    assert(calls.indexOf("save") > calls.indexOf("remove"));
    assert.equal(report.status, "FAIL");
    assert.equal(JSON.stringify(report).includes("PRIVATE_TOKEN"), false);
    assert.deepEqual(report.cleanupFailures, [failure]);
  }
});
test("clean completion preserves PASS and never removes a missing profile", async () => {
  const report = { status: "PASS" };
  let saved = false;
  await cleanupAccessibilityResources({
    report,
    save: async () => {
      saved = true;
    },
    remove: async () => {
      throw new Error("not expected");
    },
  });
  assert.equal(saved, true);
  assert.equal(report.status, "PASS");
  assert.deepEqual(report.cleanupFailures, []);
});
test("failure diagnostics contain only source module locations, never message, host or capability", () => {
  const error = new Error("PRIVATE_EMAIL token=SECRET");
  error.stack =
    "Error: PRIVATE_EMAIL token=SECRET\n    at step (file:///Users/private/project/apps/api/scripts/accessibility-flows.mjs:77:5)\n    at https://provider.invalid/?token=SECRET:34:5\n    at payment (file:///Users/private/project/apps/api/scripts/regression-journey-state.mjs:12:7)";
  const result = accessibilityFailure(error);
  assert.deepEqual(result.frames, [
    "apps/api/scripts/accessibility-flows.mjs:77:5",
    "apps/api/scripts/regression-journey-state.mjs:12:7",
  ]);
  assert(!/SECRET|PRIVATE|Users|provider|token/u.test(JSON.stringify(result)));
});
