import assert from "node:assert/strict";
import test from "node:test";
import {
  accessibilityLocales,
  accessibilityMatrix,
  accessibilityScreens,
  assertAccessibilityMatrix,
  assertAccessibilityMeasurement,
  assertAccessibilityFocus,
} from "./accessibility-matrix.mjs";

const measure = {
  width: 320,
  height: 844,
  documentWidth: 320,
  bodyWidth: 320,
  locale: "en",
  reducedMotion: true,
  transformAnimations: 0,
  scrollBehavior: "auto",
};
const focus = {
  reached: true,
  visible: true,
  unobscured: true,
  focusVisible: true,
  outline: true,
  width: 48,
  height: 48,
};
function complete() {
  return accessibilityMatrix().map((cell) => ({
    ...cell,
    screens: accessibilityScreens.map((name) => ({
      name,
      passed: true,
      measurement: {
        ...measure,
        width: cell.width ?? 855,
        height: cell.height ?? 421,
        documentWidth: cell.width ?? 855,
        bodyWidth: cell.width ?? 855,
        locale: cell.locale,
        reducedMotion: cell.reducedMotion,
      },
      axe: { engineVersion: "4.13.0", violations: [], incomplete: [] },
    })),
    keyboard: true,
    homeNoContext: true,
    giftBeforeMarket: true,
  }));
}
test("matrix requires every seven-locale regular, desktop, narrow and real zoom cell", () => {
  const matrix = accessibilityMatrix();
  assert.equal(matrix.length, 28);
  assert.equal(new Set(matrix.map((cell) => cell.id)).size, 28);
  for (const locale of accessibilityLocales)
    assert.deepEqual(
      matrix.filter((cell) => cell.locale === locale).map((cell) => cell.mode),
      ["mobile", "desktop", "narrow", "native-zoom"],
    );
  assert.doesNotThrow(() => assertAccessibilityMatrix(complete()));
});
test("matrix refuses partial, duplicate and forged cells instead of extrapolating", () => {
  const cells = complete();
  for (const invalid of [
    cells.slice(1),
    [...cells.slice(1), cells[1]],
    [{ ...cells[0], locale: "xx" }, ...cells.slice(1)],
  ])
    assert.throws(() => assertAccessibilityMatrix(invalid));
});
test("each matrix cell proves all core screens and non-gated homepage keyboard path", () => {
  for (const change of [
    (cell) => {
      cell.screens.pop();
    },
    (cell) => {
      cell.screens[1].passed = false;
    },
    (cell) => {
      cell.screens[0].axe.violations.push({
        impact: "serious",
        id: "contrast",
      });
    },
    (cell) => {
      delete cell.screens[0].axe;
    },
    (cell) => {
      delete cell.screens[0].measurement;
    },
    (cell) => {
      cell.keyboard = false;
    },
    (cell) => {
      cell.homeNoContext = false;
    },
    (cell) => {
      cell.giftBeforeMarket = false;
    },
  ]) {
    const cells = complete();
    change(cells[0]);
    assert.throws(() => assertAccessibilityMatrix(cells));
  }
});
test("reflow fails on body overflow, incorrect locale, absent measurement or unreduced transform", () => {
  const expected = {
    locale: "en",
    width: 320,
    height: 844,
    reducedMotion: true,
  };
  assert.doesNotThrow(() => assertAccessibilityMeasurement(measure, expected));
  for (const invalid of [
    { ...measure, documentWidth: 324 },
    { ...measure, bodyWidth: 322 },
    { ...measure, locale: "pt" },
    { ...measure, reducedMotion: false },
    { ...measure, transformAnimations: 1 },
    { ...measure, width: NaN },
    { ...measure, height: 450 },
    { ...measure, scrollBehavior: "smooth" },
    {},
  ])
    assert.throws(() => assertAccessibilityMeasurement(invalid, expected));
});
test("focus evidence rejects invisible, obscured, ringless, zero-size and non-keyboard targets", () => {
  assert.doesNotThrow(() => assertAccessibilityFocus(focus));
  for (const key of [
    "reached",
    "visible",
    "unobscured",
    "focusVisible",
    "outline",
  ])
    assert.throws(() => assertAccessibilityFocus({ ...focus, [key]: false }));
  assert.throws(() => assertAccessibilityFocus({ ...focus, width: 0 }));
});
