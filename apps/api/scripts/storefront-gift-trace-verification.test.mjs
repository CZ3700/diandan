import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectGiftTraceAttempts,
  giftTraceChromeOptions,
  verifyGiftTraceComparison,
} from "./storefront-gift-trace-verification.mjs";

const prefix = "STOREFRONT_TEST_FETCH_DIAGNOSTIC ";
function result(attempt) {
  return {
    lhr: {
      lighthouseVersion: "13.4.1",
      requestedUrl:
        "http://127.0.0.1:4321/zh-CN/gifts/test?market=GLOBAL&currency=USD",
      configSettings: { formFactor: "mobile", throttlingMethod: "simulate" },
      categories: { performance: { score: 0.92 } },
      audits: {
        "storefront-content": { score: 1 },
        "largest-contentful-paint": { numericValue: 2600 + attempt },
        "cumulative-layout-shift": { numericValue: 0 },
      },
    },
    artifacts: {
      Trace: { traceEvents: [{ name: "RunTask", ts: attempt }] },
      DevtoolsLog: [
        {
          method: "Network.requestWillBeSent",
          params: { requestId: String(attempt) },
        },
      ],
      MainDocumentContent: "<!doctype html><html><body>Gift</body></html>",
      settings: { formFactor: "mobile", throttlingMethod: "simulate" },
      SourceMaps: [{ scriptUrl: "http://127.0.0.1:4321/chunk.js", map: {} }],
      Timing: [{ name: "gather", duration: attempt }],
      URL: {
        requestedUrl:
          "http://127.0.0.1:4321/zh-CN/gifts/test?market=GLOBAL&currency=USD",
      },
    },
    report: ["{}", "<!doctype html><html>Lighthouse</html>"],
  };
}
async function harness(mode, mutate, verify) {
  const directory = await mkdtemp(path.join(tmpdir(), "gift-trace-tool-"));
  const events = [];
  let calls = 0;
  const inputs = [];
  function request(target) {
    const requestSequence = events.length / 3 + 1;
    for (const stage of ["CREATE", "HEADERS", "COMPLETE"])
      events.push({
        schemaVersion: 1,
        sequence: events.length + 1,
        requestSequence,
        target,
        stage,
        durationMs: 1,
        ...(stage === "HEADERS" ? { status: 200 } : {}),
      });
  }
  const context = {
    directory,
    mode,
    target: {
      locale: "zh-CN",
      kind: "gift",
      selector: "[data-gift-detail]",
      path: "/zh-CN/gifts/test?market=GLOBAL&currency=USD",
    },
    url: result(1).lhr.requestedUrl,
    launchOptions: giftTraceChromeOptions("test-pin"),
    options: { port: 12345 },
    readNativeLog: async () =>
      events.map((event) => prefix + JSON.stringify(event)).join("\n"),
    progress: () => {},
  };
  const run = async (...args) => {
    calls++;
    inputs.push(args);
    if (mode === "baseline") request("GIFT_CONTENT");
    request("STOREFRONT_GIFT");
    return mutate ? mutate(result(calls), calls) : result(calls);
  };
  try {
    await verify({ directory, context, run, inputs, calls: () => calls });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("Chrome flags match the existing measurement flags without rendering experiments", () => {
  assert.deepEqual(giftTraceChromeOptions("test-pin").chromeFlags, [
    "--headless=new",
    "--ignore-certificate-errors-spki-list=test-pin",
    "--host-resolver-rules=MAP media.example.invalid 127.0.0.1",
    "--no-proxy-server",
  ]);
});
for (const mode of ["baseline", "candidate"])
  test(`${mode} retains exactly three same-page raw reports, trace, network, artifacts, config and read windows`, async () => {
    await harness(
      mode,
      undefined,
      async ({ directory, context, run, inputs, calls }) => {
        const report = await collectGiftTraceAttempts(context, run);
        assert.equal(calls(), 3);
        assert.equal(report.attempts.length, 3);
        assert.equal(report.status, "COLLECTED_DIAGNOSTIC_BUDGET_FAILED");
        assert.equal(report.aggregate.lcpMs.median, 2602);
        assert.ok(
          inputs.every(
            ([url, options, config]) =>
              url === context.url &&
              options.throttlingMethod === "simulate" &&
              options.formFactor === "mobile" &&
              config.extends === "lighthouse:default",
          ),
        );
        for (const entry of report.attempts) {
          assert.deepEqual(entry.reads.counts, {
            GIFT_CONTENT: mode === "baseline" ? 1 : 0,
            STOREFRONT_GIFT: 1,
          });
          const get = async (suffix) =>
            JSON.parse(
              await readFile(path.join(directory, entry.name + suffix), "utf8"),
            );
          assert.deepEqual(
            await get("-trace.json"),
            result(entry.attempt).artifacts.Trace,
          );
          assert.deepEqual(
            await get("-devtools.json"),
            result(entry.attempt).artifacts.DevtoolsLog,
          );
          assert.deepEqual(
            await get("-artifacts.json"),
            result(entry.attempt).artifacts,
          );
          assert.deepEqual(await get(".json"), result(entry.attempt).lhr);
          assert.ok(
            (await get("-config.json")).launchOptions.chromeFlags.includes(
              "--headless=new",
            ),
          );
          assert.equal(
            (await get("-config.json")).lhrSettings.throttlingMethod,
            "simulate",
          );
          assert.match(
            await readFile(
              path.join(directory, entry.name + "-document.html"),
              "utf8",
            ),
            /Gift/u,
          );
          assert.match(
            await readFile(
              path.join(directory, entry.name + "-lighthouse.html"),
              "utf8",
            ),
            /Lighthouse/u,
          );
        }
      },
    );
  });

test("invalid content is retained before assertion and is never replaced by a retry", async () => {
  await harness(
    "candidate",
    (raw, attempt) => {
      if (attempt === 1) raw.lhr.audits["storefront-content"].score = 0;
      return raw;
    },
    async ({ directory, context, run, calls }) => {
      await assert.rejects(collectGiftTraceAttempts(context, run));
      assert.equal(calls(), 3);
      const report = JSON.parse(
        await readFile(path.join(directory, "results.json"), "utf8"),
      );
      assert.equal(report.status, "FAIL");
      assert.equal(report.attempts.length, 3);
      const first = JSON.parse(
        await readFile(
          path.join(directory, "zh-CN-gift-mobile-1.json"),
          "utf8",
        ),
      );
      assert.equal(first.audits["storefront-content"].score, 0);
      assert.ok(
        await readFile(
          path.join(directory, "zh-CN-gift-mobile-1-trace.json"),
          "utf8",
        ),
      );
    },
  );
});
for (const corruption of [
  "missing-trace",
  "missing-network",
  "version",
  "runtime",
  "throw",
])
  test(`${corruption} evidence fails closed after all fixed attempts are retained`, async () => {
    await harness(
      "candidate",
      (raw, attempt) => {
        if (attempt !== 1) return raw;
        if (corruption === "missing-trace") delete raw.artifacts.Trace;
        if (corruption === "missing-network") delete raw.artifacts.DevtoolsLog;
        if (corruption === "version") raw.lhr.lighthouseVersion = "0.0.0";
        if (corruption === "runtime")
          raw.lhr.runtimeError = { code: "TEST_ERROR" };
        if (corruption === "throw")
          throw new Error("Synthetic Lighthouse exception");
        return raw;
      },
      async ({ directory, context, run, calls }) => {
        await assert.rejects(collectGiftTraceAttempts(context, run));
        assert.equal(calls(), 3);
        const saved = JSON.parse(
          await readFile(path.join(directory, "results.json"), "utf8"),
        );
        assert.equal(saved.status, "FAIL");
        assert.equal(saved.attempts.length, 3);
        assert.ok(saved.attempts[0].failure);
      },
    );
  });

const compositorCategories = [
  "cc",
  "disabled-by-default-cc.debug",
  "renderer.scheduler",
  "disabled-by-default-renderer.scheduler",
  "blink",
  "viz",
];

function compositorResult(raw) {
  for (const settings of [raw.lhr.configSettings, raw.artifacts.settings])
    settings.additionalTraceCategories = compositorCategories.join(",");
  return raw;
}

test("default and explicit standard profiles preserve the original Lighthouse inputs", async () => {
  for (const traceProfile of [undefined, "standard"])
    await harness("candidate", undefined, async ({ context, run, inputs }) => {
      const report = await collectGiftTraceAttempts(
        { ...context, ...(traceProfile ? { traceProfile } : {}) },
        run,
      );
      assert.equal(report.conditions.traceProfile, "standard");
      assert.equal(report.conditions.defaultTraceCategories, true);
      assert.deepEqual(report.conditions.additionalTraceCategories, []);
      for (const [, options] of inputs)
        assert.deepEqual(options, {
          port: 12345,
          logLevel: "error",
          output: ["json", "html"],
          onlyCategories: [
            "performance",
            "accessibility",
            "best-practices",
            "seo",
            "storefront",
          ],
          formFactor: "mobile",
          throttlingMethod: "simulate",
        });
    });
});

test("compositor diagnostics append only explicit trace categories and retain the exact options", async () => {
  await harness(
    "candidate",
    compositorResult,
    async ({ directory, context, run, inputs, calls }) => {
      const report = await collectGiftTraceAttempts(
        { ...context, traceProfile: "compositor-diagnostic" },
        run,
      );
      assert.equal(calls(), 3);
      assert.equal(report.status, "COLLECTED_DIAGNOSTIC_BUDGET_FAILED");
      assert.equal(report.conditions.traceProfile, "compositor-diagnostic");
      assert.equal(report.conditions.defaultTraceCategories, false);
      assert.equal(report.conditions.formalPerformanceAcceptance, false);
      assert.deepEqual(
        report.conditions.additionalTraceCategories,
        compositorCategories,
      );
      for (const entry of report.attempts) {
        const input = inputs[entry.attempt - 1][1];
        assert.equal(
          input.additionalTraceCategories,
          compositorCategories.join(","),
        );
        const saved = JSON.parse(
          await readFile(
            path.join(directory, entry.name + "-config.json"),
            "utf8",
          ),
        );
        assert.deepEqual(saved.options, input);
        assert.deepEqual(
          saved.launchOptions,
          giftTraceChromeOptions("test-pin"),
        );
        assert.equal(
          saved.lhrSettings.additionalTraceCategories,
          input.additionalTraceCategories,
        );
        assert.equal(
          saved.artifactSettings.additionalTraceCategories,
          input.additionalTraceCategories,
        );
      }
    },
  );
});

test("unknown trace profiles fail closed before collecting or starting the TEST fixture callback", async () => {
  await harness("candidate", undefined, async ({ context, run, calls }) => {
    await assert.rejects(
      collectGiftTraceAttempts({ ...context, traceProfile: "invented" }, run),
      /Unknown gift trace profile/u,
    );
    assert.equal(calls(), 0);
  });
  const previous = process.env.FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS;
  process.env.FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS = "1";
  try {
    await assert.rejects(
      verifyGiftTraceComparison({
        manifest: { environment: "TEST" },
        traceProfile: "invented",
      }),
      /Unknown gift trace profile/u,
    );
  } finally {
    if (previous === undefined)
      delete process.env.FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS;
    else process.env.FAN_SUPPORT_ACCEPTANCE_READ_DIAGNOSTICS = previous;
  }
});

for (const source of ["lhr", "artifacts"])
  test(`diagnostic ${source} settings must confirm the requested categories after all samples are retained`, async () => {
    await harness(
      "candidate",
      (raw, attempt) => {
        compositorResult(raw);
        if (attempt === 1) {
          const settings =
            source === "lhr" ? raw.lhr.configSettings : raw.artifacts.settings;
          settings.additionalTraceCategories = "cc";
        }
        return raw;
      },
      async ({ directory, context, run, calls }) => {
        await assert.rejects(
          collectGiftTraceAttempts(
            { ...context, traceProfile: "compositor-diagnostic" },
            run,
          ),
          AggregateError,
        );
        assert.equal(calls(), 3);
        const saved = JSON.parse(
          await readFile(path.join(directory, "results.json"), "utf8"),
        );
        assert.equal(saved.status, "FAIL");
        assert.equal(saved.attempts.length, 3);
        assert.match(saved.attempts[0].failure.assertion, /trace categories/u);
        const raw = JSON.parse(
          await readFile(
            path.join(directory, "zh-CN-gift-mobile-1-artifacts.json"),
            "utf8",
          ),
        );
        assert.ok(raw.Trace.traceEvents.length > 0);
      },
    );
  });
