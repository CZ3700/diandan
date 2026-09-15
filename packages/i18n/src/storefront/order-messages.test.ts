import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { expect, it } from "vitest";
import { formatStorefrontMessage, loadStorefrontCopy } from "./messages.js";

it("provides complete order recovery and status messages in every public locale", async () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = await loadStorefrontCopy(locale);
    for (const key of [
      "orderTitle",
      "orderThankYou",
      "orderLoading",
      "orderLookupTitle",
      "orderLookupHelp",
      "orderIdLabel",
      "orderOpen",
      "orderAccessDenied",
      "orderUnavailable",
      "orderPaymentPending",
      "orderRateLimited",
      "orderRetry",
      "orderRevoke",
      "orderRevoked",
      "orderBack",
      "orderView",
      "orderLinkInvalid",
      "orderRecoveryHelp",
      "orderProgress",
      "orderPaid",
      "orderOnHold",
      "orderPartiallyRefunded",
      "orderRefunded",
      "orderDisputeOpen",
      "orderOriginalLanguage",
      "orderSnapshotLanguage",
    ])
      expect(
        (copy as Record<string, string>)[key],
        `${locale}:${key}`,
      ).toBeTruthy();
  }
});

it("formats server-provided rate limits and original-content language names without leaking ICU placeholders", async () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = await loadStorefrontCopy(locale);
    const rate = formatStorefrontMessage(copy, "orderRateLimited", locale, {
      seconds: 12,
    });
    expect(rate).not.toMatch(/[{}]/u);
    expect(rate).toContain(new Intl.NumberFormat(locale).format(12));
    for (const key of [
      "orderOriginalLanguage",
      "orderSnapshotLanguage",
    ] as const) {
      const text = formatStorefrontMessage(copy, key, locale, {
        language: "ไทย",
      });
      expect(text).toContain("ไทย");
      expect(text).not.toMatch(/[{}]/u);
    }
  }
});
