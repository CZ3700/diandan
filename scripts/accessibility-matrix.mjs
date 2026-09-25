import assert from "node:assert/strict";
import { accessibilityLocales } from "../apps/api/scripts/accessibility-contracts.mjs";
export { accessibilityLocales };
export const accessibilityScreens = Object.freeze([
  "home",
  "gift",
  "cart",
  "checkout",
  "order",
  "management",
  "operations",
]);
export function accessibilityMatrix() {
  return accessibilityLocales.flatMap((locale) =>
    [
      { mode: "mobile", width: 390, height: 844, reducedMotion: true },
      { mode: "desktop", width: 1440, height: 900, reducedMotion: false },
      { mode: "narrow", width: 320, height: 844, reducedMotion: true },
      { mode: "native-zoom", width: null, height: null, reducedMotion: true },
    ].map((mode) => ({ ...mode, locale, id: `${locale}-${mode.mode}` })),
  );
}
export function assertAccessibilityMatrix(cells) {
  const expected = accessibilityMatrix();
  assert(
    Array.isArray(cells) && cells.length === expected.length,
    "Every accessibility cell is required",
  );
  assert(
    new Set(cells.map((cell) => cell.id)).size === expected.length,
    "No duplicate accessibility cells",
  );
  for (const entry of expected) {
    const cell = cells.find((value) => value.id === entry.id);
    assert(cell, "Expected accessibility cell exists");
    for (const [key, value] of Object.entries(entry))
      assert(cell[key] === value, `Canonical accessibility dimension: ${key}`);
    assert(
      cell.keyboard === true &&
        cell.homeNoContext === true &&
        cell.giftBeforeMarket === true,
      "Each cell proves a keyboard path and immediate unscoped homepage gifts",
    );
    assert(
      Array.isArray(cell.screens) &&
        cell.screens.length === accessibilityScreens.length,
      "Every production screen is inspected",
    );
    for (const name of accessibilityScreens) {
      const screens = cell.screens.filter((screen) => screen.name === name);
      assert(
        screens.length === 1 && screens[0].passed === true,
        "Each screen is present exactly once and passed",
      );
      assertAccessibilityMeasurement(screens[0].measurement, cell);
      const axe = screens[0].axe;
      assert(
        typeof axe?.engineVersion === "string" &&
          axe.engineVersion.length > 0 &&
          Array.isArray(axe.violations) &&
          Array.isArray(axe.incomplete),
        "Complete axe evidence is required",
      );
      assert(
        !axe.violations.some((item) =>
          ["critical", "serious"].includes(item.impact),
        ),
        "Critical and serious accessibility findings block acceptance",
      );
    }
  }
}
export function assertAccessibilityMeasurement(value, expected) {
  for (const key of ["width", "height", "documentWidth", "bodyWidth"])
    assert(
      Number.isFinite(value?.[key]) && value[key] > 0,
      "Finite positive rendered dimensions are required",
    );
  assert(
    value.documentWidth <= value.width + 1 &&
      value.bodyWidth <= value.width + 1,
    "The actual document and body must fit the CSS viewport",
  );
  if (expected.width !== null)
    assert(
      value.width === expected.width,
      "Requested viewport must actually be rendered",
    );
  if (expected.height !== null)
    assert(
      value.height === expected.height,
      "Requested viewport height must actually be rendered",
    );
  assert(
    value.locale === expected.locale,
    "Actual document language matches the scenario",
  );
  assert(
    value.reducedMotion === expected.reducedMotion,
    "Actual reduced motion preference matches the scenario",
  );
  if (expected.reducedMotion) {
    assert(
      value.transformAnimations === 0,
      "Reduced motion has no running transform animations",
    );
    assert(
      value.scrollBehavior === "auto",
      "Reduced motion does not use smooth document scrolling",
    );
  }
}
export function assertAccessibilityFocus(value) {
  for (const key of [
    "reached",
    "visible",
    "unobscured",
    "focusVisible",
    "outline",
  ])
    assert(
      value?.[key] === true,
      `Sequential keyboard focus must prove ${key}`,
    );
  assert(
    Number.isFinite(value.width) &&
      value.width > 0 &&
      Number.isFinite(value.height) &&
      value.height > 0,
    "Keyboard target has a rendered box",
  );
}
