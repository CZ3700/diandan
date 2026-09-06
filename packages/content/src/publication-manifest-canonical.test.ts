import { expect, test } from "vitest";
import { canonicalPublicationValue } from "./publication-manifest-canonical.js";

test("canonical bytes expand scientific numbers like PostgreSQL numeric JSON", () => {
  const value = {
    focalPoint: { x: 1e-7, y: 1e-12 },
    caption: "中文礼物 🎁 Cafe\u0301",
  };
  const encoded = canonicalPublicationValue(value);
  expect(encoded).toBe(
    '{"caption":"中文礼物 🎁 Café","focalPoint":{"x":0.0000001,"y":0.000000000001}}',
  );
  expect(JSON.parse(encoded)).toEqual(value);
});
test("extreme finite scalar exponents keep their original JS value without rounding or a schema restriction", () => {
  for (const number of [1e21, -1e21, 1.234e-8, Number.MIN_VALUE, -0]) {
    const encoded = canonicalPublicationValue({ number });
    expect(encoded).not.toMatch(/[eE][+-]?\d/u);
    expect(JSON.parse(encoded).number).toBe(number === 0 ? 0 : number);
  }
});
