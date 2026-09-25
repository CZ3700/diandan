import assert from "node:assert/strict";
import test from "node:test";
import {
  accessibilityLocales,
  accessibilityMatrix,
  accessibilityScreens,
} from "./accessibility-matrix.mjs";
import { assertAccessibilityCompletion } from "./accessibility-completion.mjs";
function valid() {
  const baseline = {
    outerWidth: 1710,
    outerHeight: 929,
    innerWidth: 1710,
    innerHeight: 842,
    devicePixelRatio: 1,
    visualViewport: { scale: 1, width: 1710, height: 842 },
  };
  const zoomed = {
    ...baseline,
    innerWidth: 855,
    innerHeight: 421,
    devicePixelRatio: 2,
    visualViewport: { scale: 1, width: 855, height: 421 },
  };
  return {
    cases: accessibilityMatrix().map((cell) => ({
      ...cell,
      keyboard: true,
      homeNoContext: true,
      giftBeforeMarket: true,
      screens: accessibilityScreens.map((name) => ({
        name,
        passed: true,
        measurement: {
          width: cell.width ?? 855,
          height: cell.height ?? 421,
          documentWidth: cell.width ?? 855,
          bodyWidth: cell.width ?? 855,
          locale: cell.locale,
          reducedMotion: cell.reducedMotion,
          transformAnimations: 0,
          scrollBehavior: "auto",
        },
        axe: { engineVersion: "4.13.0", violations: [], incomplete: [] },
      })),
    })),
    nativeZoom: { baseline, zoomed, profileRemoved: true },
    journey: { payment: true, mailAccess: true, fulfillment: true },
    pageErrors: [],
    observations: [],
    orderSearches: accessibilityMatrix().map((cell) => ({
      cellId: cell.id,
      beforeSubmitButtonFocus: true,
      requestMatched: true,
      pendingHeadingFocus: true,
      responseValidated: true,
      completedHeadingFocus: true,
      nextTabInsideWorkspace: true,
    })),
    humanScreenReaderVerified: false,
    actualDailyBrowse: {
      result: "PASS",
      checks: accessibilityLocales.length * 7,
      locales: [...accessibilityLocales],
      sourceLocale: "en",
    },
  };
}
test("completion requires native window zoom and explicitly retains the human gate", () => {
  assert.doesNotThrow(() => assertAccessibilityCompletion(valid()));
  for (const mutate of [
    (report) => {
      report.nativeZoom.zoomed.devicePixelRatio = 1;
    },
    (report) => {
      report.nativeZoom.zoomed.visualViewport.scale = 2;
    },
    (report) => {
      report.nativeZoom.profileRemoved = false;
    },
    (report) => {
      report.journey.fulfillment = false;
    },
    (report) => {
      report.observations.push({ code: "PAYMENT_READ_UNAVAILABLE" });
    },
    (report) => {
      report.pageErrors.push({ code: "HYDRATION" });
    },
    (report) => {
      report.humanScreenReaderVerified = true;
    },
    (report) => {
      delete report.actualDailyBrowse;
    },
    (report) => {
      report.orderSearches.pop();
    },
    (report) => {
      report.orderSearches[0].responseValidated = false;
    },
    (report) => {
      report.orderSearches[0].pendingHeadingFocus = false;
    },
  ]) {
    const report = valid();
    mutate(report);
    assert.throws(() => assertAccessibilityCompletion(report));
  }
});
