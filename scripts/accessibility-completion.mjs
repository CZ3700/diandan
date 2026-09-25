import assert from "node:assert/strict";
import {
  accessibilityLocales,
  assertAccessibilityMatrix,
} from "./accessibility-matrix.mjs";
import { assessNativeZoomMeasurements } from "./verify-ui-primitives-browser.mjs";

export function assertAccessibilityCompletion(report) {
  assertAccessibilityMatrix(report.cases);
  assert(
    Array.isArray(report.orderSearches) &&
      report.orderSearches.length === report.cases.length &&
      report.cases.every((cell) => {
        const searches = report.orderSearches.filter(
          (entry) => entry.cellId === cell.id,
        );
        return (
          searches.length === 1 &&
          [
            "beforeSubmitButtonFocus",
            "requestMatched",
            "pendingHeadingFocus",
            "responseValidated",
            "completedHeadingFocus",
            "nextTabInsideWorkspace",
          ].every((field) => searches[0][field] === true)
        );
      }),
    "Every cell proves the current order response and uninterrupted keyboard focus",
  );
  const daily = report.actualDailyBrowse;
  assert(
    daily?.result === "PASS" &&
      Number.isSafeInteger(daily.checks) &&
      daily.checks >= accessibilityLocales.length * 7 &&
      JSON.stringify(daily.locales) === JSON.stringify(accessibilityLocales) &&
      accessibilityLocales.includes(daily.sourceLocale),
    "Actual daily publication browsing is verified in every configured locale",
  );
  assert(
    report.nativeZoom?.profileRemoved === true,
    "Temporary native browser profiles were removed",
  );
  assert(
    assessNativeZoomMeasurements({ ...report.nativeZoom, expectedPercent: 200 })
      .length === 0,
    "Real native browser 200% zoom is proven by physical and CSS measurements",
  );
  assert(
    report.journey?.payment === true &&
      report.journey.mailAccess === true &&
      report.journey.fulfillment === true,
    "The single keyboard transaction, independent mail access and fulfillment all completed",
  );
  assert(
    Array.isArray(report.pageErrors) &&
      report.pageErrors.length === 0 &&
      Array.isArray(report.observations) &&
      report.observations.length === 0,
    "Unhandled page errors and failed canonical payment observations block completion",
  );
  assert(
    report.humanScreenReaderVerified === false,
    "Automation never claims human screen reader verification",
  );
}
