import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";
import {
  observePerformanceTraffic,
  assessPerformanceResources,
  messageFingerprints,
} from "./performance-resources.mjs";

test("font, stylesheet, network and missing-body failures are never omitted", async () => {
  const page = new EventEmitter();
  const observer = observePerformanceTraffic(page);
  page.emit("requestfailed", {
    resourceType: () => "font",
    url: () => "https://test.invalid/font.woff2",
  });
  page.emit("response", {
    request: () => ({ resourceType: () => "stylesheet" }),
    url: () => "https://test.invalid/style.css",
    status: () => 500,
    body: async () => Buffer.from("error"),
    headers: () => ({}),
  });
  page.emit("response", {
    request: () => ({ resourceType: () => "script" }),
    url: () => "https://test.invalid/script.js",
    status: () => 200,
    body: async () => {
      throw new Error("not persisted");
    },
    headers: () => ({}),
  });
  await observer.settle();
  assert.equal(observer.failures.length, 3);
  assert.equal(observer.resources[0].type, "stylesheet");
});

test("only same-origin scripts and the locale font hash allowlist pass", () => {
  const input = {
    origin: "https://test.invalid",
    locale: "en",
    resources: [
      {
        type: "script",
        url: "https://test.invalid/a.js",
        status: 200,
        bodyBytes: 100,
        gzipBytes: 40,
      },
      {
        type: "stylesheet",
        url: "https://test.invalid/a.css",
        status: 200,
        bodyBytes: 100,
      },
      {
        type: "font",
        url: "https://test.invalid/a.woff2",
        status: 200,
        bodyBytes: 100,
        sha256: "allowed",
      },
    ],
    failures: [],
    allowedFontHashes: new Set(["allowed"]),
    messageEvidence: { currentLocaleMatches: 5, foreignLocaleMatches: [] },
  };
  assert.equal(assessPerformanceResources(input).passed, true);
  for (const mutation of [
    { failures: [{ type: "image" }] },
    { allowedFontHashes: new Set() },
    { messageEvidence: { currentLocaleMatches: 0, foreignLocaleMatches: [] } },
    {
      messageEvidence: {
        currentLocaleMatches: 5,
        foreignLocaleMatches: ["th"],
      },
    },
    {
      resources: [
        ...input.resources,
        { type: "script", url: "https://psp.invalid/sdk.js", status: 200 },
      ],
    },
    { resources: input.resources.filter((row) => row.type !== "font") },
  ])
    assert.equal(
      assessPerformanceResources({ ...input, ...mutation }).passed,
      false,
    );
});

test("message probes use unique long locale strings and never report message bodies", () => {
  const catalogs = {
    en: {
      same: "same long shared phrase",
      unique: "English unique checkout phrase",
    },
    th: {
      same: "same long shared phrase",
      unique: "Thai unique checkout phrase",
    },
  };
  const probes = messageFingerprints(catalogs);
  const report = probes.inspect("en", JSON.stringify(catalogs.en));
  assert.equal(report.currentLocaleMatches, 1);
  assert.deepEqual(report.foreignLocaleMatches, []);
  assert.deepEqual(probes.inspect("en", JSON.stringify(catalogs)), {
    currentLocaleMatches: 1,
    foreignLocaleMatches: ["th"],
  });
  assert.equal(JSON.stringify(report).includes("checkout phrase"), false);
  assert.deepEqual(
    probes.inspect("en", "Dynamic Thai unique checkout phrase"),
    { currentLocaleMatches: 0, foreignLocaleMatches: [] },
  );
  assert.equal(
    probes.inspect("en", JSON.stringify(JSON.stringify(catalogs.en)))
      .currentLocaleMatches,
    1,
  );
});
