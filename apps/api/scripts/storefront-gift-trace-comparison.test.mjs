import assert from "node:assert/strict";
import test from "node:test";
import { parseGiftTraceMode } from "./storefront-gift-trace-comparison.mjs";

test("trace mode accepts only explicit baseline or candidate with schema version one", () => {
  for (const mode of ["baseline", "candidate"])
    assert.equal(parseGiftTraceMode({ schemaVersion: 1, mode }), mode);
});
test("trace mode rejects extra knobs, arrays, absent mode and unknown versions", () => {
  for (const value of [
    null,
    [],
    { mode: "baseline" },
    { schemaVersion: 2, mode: "baseline" },
    { schemaVersion: 1, mode: "other" },
    { schemaVersion: 1, mode: "candidate", fullMatrix: true },
    { schemaVersion: 1, mode: "baseline", attempts: 9 },
  ])
    assert.throws(() => parseGiftTraceMode(value));
});
