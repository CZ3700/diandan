import assert from "node:assert/strict";
import test from "node:test";
const module = await import("./regression-journey-lifecycle.mjs").catch(
  () => ({}),
);
test("failed journeys stop services but preserve owned data, successful journeys clean only their instance", async () => {
  assert.equal(typeof module.runJourneyLifecycle, "function");
  for (const fail of [false, true]) {
    const calls = [];
    const actions = {
      start: async () => calls.push("start"),
      browser: async () => {
        calls.push("browser");
        if (fail) throw new Error("fixture failure");
        return { status: "PASS" };
      },
      stop: async () => calls.push("stop"),
      reset: async () => calls.push("reset"),
    };
    if (fail) await assert.rejects(module.runJourneyLifecycle(actions));
    else
      assert.equal((await module.runJourneyLifecycle(actions)).status, "PASS");
    assert.deepEqual(
      calls,
      fail
        ? ["start", "browser", "stop"]
        : ["start", "browser", "stop", "reset"],
    );
  }
});
test("a partial browser report cannot trigger reset or successful acceptance", async () => {
  assert.equal(typeof module.runJourneyLifecycle, "function");
  let reset = false,
    stopped = false;
  await assert.rejects(
    module.runJourneyLifecycle({
      start: async () => {},
      browser: async () => ({ status: "PARTIAL_PASS" }),
      stop: async () => {
        stopped = true;
      },
      reset: async () => {
        reset = true;
      },
    }),
  );
  assert.equal(stopped, true);
  assert.equal(reset, false);
});

test("generated journey selectors obey the existing 32-character instance limit", () => {
  assert.equal(typeof module.regressionInstanceName, "function");
  assert.match(
    module.regressionInstanceName(),
    /^test-regression-[a-z0-9-]{1,16}$/u,
  );
  assert.ok(module.regressionInstanceName().length <= 32);
});

test("a failed journey is diagnosed before its services stop, and diagnosis never hides the failure", async () => {
  assert.equal(typeof module.runJourneyLifecycle, "function");
  for (const diagnosisFails of [false, true]) {
    const calls = [];
    await assert.rejects(
      module.runJourneyLifecycle({
        start: async () => calls.push("start"),
        browser: async () => {
          calls.push("browser");
          throw new Error("fixture failure");
        },
        diagnose: async () => {
          calls.push("diagnose");
          if (diagnosisFails) throw new Error("diagnosis failure");
        },
        stop: async () => calls.push("stop"),
        reset: async () => calls.push("reset"),
      }),
      /fixture failure/u,
    );
    assert.deepEqual(calls, ["start", "browser", "diagnose", "stop"]);
  }
  const calls = [];
  await module.runJourneyLifecycle({
    start: async () => calls.push("start"),
    browser: async () => ({ status: "PASS" }),
    diagnose: async () => calls.push("diagnose"),
    stop: async () => calls.push("stop"),
    reset: async () => calls.push("reset"),
  });
  assert.deepEqual(calls, ["start", "stop", "reset"]);
});
