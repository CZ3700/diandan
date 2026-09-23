import assert from "node:assert/strict";
import test from "node:test";
import * as browserGate from "./management-center-browser.mjs";

const previousImages = [
  "https://media.example.invalid/old-wide.webp",
  "https://media.example.invalid/old-tall.webp",
];
const publicImages = [
  "https://media.example.invalid/new-wide.webp",
  "https://media.example.invalid/new-tall.webp",
];
function evidence(overrides = {}) {
  assert.equal(typeof browserGate.posterVisibilityEvidence, "function");
  return browserGate.posterVisibilityEvidence({
    operationKind: "REPLACE_POSTER",
    elapsedMs: 59_999,
    previousImages,
    publicImages,
    ...overrides,
  });
}

test("poster visibility requires both actual compositions to change within sixty seconds", () => {
  assert.equal(evidence().pass, true);
  for (const overrides of [
    { elapsedMs: 60_001 },
    { elapsedMs: -1 },
    { elapsedMs: Number.NaN },
    { publicImages: [publicImages[0]] },
    { publicImages: [publicImages[0], previousImages[1]] },
    { publicImages: [publicImages[0], null] },
  ])
    assert.equal(evidence(overrides).pass, false);
});

test("restoration verifies the exact historical pair and does not store media URLs", () => {
  assert.equal(
    evidence({ operationKind: "RESTORE_POSTER", expectedImages: publicImages })
      .pass,
    true,
  );
  assert.equal(
    evidence({
      operationKind: "RESTORE_POSTER",
      expectedImages: previousImages,
    }).pass,
    false,
  );
  assert.doesNotMatch(JSON.stringify(evidence()), /https:|old-wide|new-wide/iu);
});
