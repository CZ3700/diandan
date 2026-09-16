import assert from "node:assert/strict";
import test from "node:test";
import { subtractPoints } from "./probe-support.mjs";

test("removes only UI points and retains both endpoints and arbitrary Unicode", () => {
  assert.deepEqual(
    subtractPoints(
      [
        [2, 9],
        [0x10000, 0x10003],
      ],
      new Set([2, 5, 7, 9, 0x10001]),
    ),
    [
      [3, 4],
      [6, 6],
      [8, 8],
      [0x10000, 0x10000],
      [0x10002, 0x10003],
    ],
  );
});
test("exhaustive small-domain partition preserves the original union without overlap", () => {
  for (let mask = 0; mask < 256; mask++) {
    const excluded = new Set(
      Array.from({ length: 8 }, (_, n) => n).filter((n) => mask & (1 << n)),
    );
    const kept = subtractPoints([[0, 7]], excluded).flatMap(([start, end]) =>
      Array.from({ length: end - start + 1 }, (_, n) => start + n),
    );
    assert.equal(
      kept.some((point) => excluded.has(point)),
      false,
    );
    assert.deepEqual(
      [...new Set([...kept, ...excluded])].sort((a, b) => a - b),
      [0, 1, 2, 3, 4, 5, 6, 7],
    );
  }
});
