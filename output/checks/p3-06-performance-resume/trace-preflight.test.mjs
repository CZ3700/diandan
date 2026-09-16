import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseDiagnosticOptions,
  writeLighthouseEvidence,
} from "./trace-preflight.mjs";
import * as collector from "./trace-preflight.mjs";
import { AcceptanceContentAudit } from "../../../apps/api/scripts/storefront-acceptance-content.mjs";

test("diagnostic defaults retain three attempts of both gift locales; unknown scopes fail", () => {
  assert.deepEqual(parseDiagnosticOptions([]), {
    locales: ["en", "ja"],
    kinds: ["gift"],
    repeats: 3,
  });
  assert.deepEqual(
    parseDiagnosticOptions(["--kinds=home,artist,gift", "--repeats=1"]),
    {
      locales: ["en", "ja"],
      kinds: ["home", "artist", "gift"],
      repeats: 1,
    },
  );
  assert.deepEqual(
    parseDiagnosticOptions([
      "--locales=en,ja,zh-CN",
      "--kinds=home,artist,gift",
      "--repeats=3",
    ]),
    {
      locales: ["en", "ja", "zh-CN"],
      kinds: ["home", "artist", "gift"],
      repeats: 3,
    },
  );
  for (const value of [
    "--repeats=0",
    "--repeats=4",
    "--locales=xx",
    "--kinds=policy",
    "--best-only",
    "--locales=en,en",
  ]) {
    assert.throws(() => parseDiagnosticOptions([value]));
  }
});

function validResult() {
  return {
    lhr: {
      lighthouseVersion: "13.4.1",
      categories: { performance: { score: 0.91 } },
      audits: {
        "largest-contentful-paint": { numericValue: 2400 },
        "cumulative-layout-shift": { numericValue: 0 },
        "storefront-content": { score: 1 },
      },
    },
    report: "<!doctype html><title>TEST</title>",
    artifacts: {
      Trace: { traceEvents: [{ name: "TEST", ts: 1 }] },
      DevtoolsLog: [{ method: "TEST" }],
    },
  };
}

test("collector passes the current same-navigation gatherer without changing standard mobile settings", async () => {
  assert.equal(typeof collector.collectDiagnosticLighthouse, "function");
  const output = await mkdtemp(path.join(os.tmpdir(), "trace-config-test-"));
  const target = {
    locale: "zh-CN",
    kind: "gift",
    selector: "[data-gift-detail]",
    path: "/zh-CN/gifts/test",
  };
  const url = "http://localhost:3000" + target.path;
  let calls = 0;
  try {
    const value = await collector.collectDiagnosticLighthouse({
      output,
      name: "zh-CN-gift-mobile-1",
      target,
      url,
      port: 1234,
      lighthouse: async (actualUrl, options, config) => {
        calls++;
        assert.equal(actualUrl, url);
        assert.deepEqual(options, {
          port: 1234,
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
        assert.equal(config.extends, "lighthouse:default");
        assert.deepEqual(Object.keys(config.categories), ["storefront"]);
        assert.equal(config.audits[0], AcceptanceContentAudit);
        let observed;
        await config.artifacts[0].gatherer.getArtifact({
          driver: {
            executionContext: {
              evaluate: async (_read, input) => {
                observed = input;
              },
            },
          },
        });
        assert.deepEqual(observed, {
          args: [target.selector, url, "zh-CN", ["[data-gift-detail] h1"]],
          useIsolation: true,
        });
        return validResult();
      },
    });
    assert.equal(calls, 1, "no extra navigation or retry");
    assert.equal(value.result.lhr.audits["storefront-content"].score, 1);
    assert.equal(value.files.trace.events, 1);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("invalid measured content is retained as a failed attempt, never accepted from HTTP 200 or finite metrics", async () => {
  assert.equal(typeof collector.collectDiagnosticLighthouse, "function");
  const output = await mkdtemp(path.join(os.tmpdir(), "trace-content-test-"));
  const invalid = [
    undefined,
    { score: 0 },
    { score: 1, errorMessage: "TEST_FAILURE" },
  ];
  try {
    for (const [index, content] of invalid.entries()) {
      const result = validResult();
      result.lhr.audits["storefront-content"] = content;
      const name = `en-gift-mobile-${index + 1}`;
      await assert.rejects(
        collector.collectDiagnosticLighthouse({
          output,
          name,
          target: {
            locale: "en",
            kind: "gift",
            selector: "[data-gift-detail]",
          },
          url: "http://localhost:3000/en/gifts/test",
          port: 1234,
          lighthouse: async () => result,
        }),
        /same-navigation/u,
      );
      const retained = JSON.parse(
        await readFile(path.join(output, name + ".json"), "utf8"),
      );
      assert.deepEqual(retained, JSON.parse(JSON.stringify(result.lhr)));
      assert.deepEqual(
        JSON.parse(
          await readFile(path.join(output, name + ".trace.json"), "utf8"),
        ),
        result.artifacts.Trace,
      );
      assert.deepEqual(
        JSON.parse(
          await readFile(path.join(output, name + ".devtoolslog.json"), "utf8"),
        ),
        result.artifacts.DevtoolsLog,
      );
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("preserves actual trace and devtools log independently, never overwrites an attempt", async () => {
  const output = await mkdtemp(
    path.join(os.tmpdir(), "storefront-trace-test-"),
  );
  const result = {
    lhr: {
      lighthouseVersion: "13.4.1",
      runtimeError: { code: "TEST_FAILURE" },
    },
    report: ["{}", "<!DOCTYPE html><title>TEST</title>"],
    artifacts: {
      Trace: { traceEvents: [{ name: "TEST", ts: 123 }] },
      DevtoolsLog: [
        { method: "Network.requestWillBeSent", params: { requestId: "TEST" } },
      ],
    },
  };
  try {
    const files = await writeLighthouseEvidence(
      output,
      "en-gift-mobile-1",
      result,
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(output, files.trace.path), "utf8")),
      result.artifacts.Trace,
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(path.join(output, files.devtoolsLog.path), "utf8"),
      ),
      result.artifacts.DevtoolsLog,
    );
    assert.equal(files.trace.events, 1);
    assert.equal(files.devtoolsLog.events, 1);
    assert.match(files.trace.sha256, /^[a-f0-9]{64}$/);
    assert.equal(
      JSON.parse(await readFile(path.join(output, files.json.path), "utf8"))
        .runtimeError.code,
      "TEST_FAILURE",
    );
    await assert.rejects(
      writeLighthouseEvidence(output, "en-gift-mobile-1", result),
      { code: "EEXIST" },
    );
    await assert.rejects(
      writeLighthouseEvidence(output, "missing", {
        ...result,
        artifacts: { DevtoolsLog: [] },
      }),
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
