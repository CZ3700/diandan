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

// ADR-019 supplement (L3-09): the certificate reads as a digital support certificate in every
// locale, never as a donation or tip, and fills its placeholders.
it("words the support certificate as a digital support certificate in every locale", async () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = await loadStorefrontCopy(locale);
    const certificate = Object.entries(copy).filter(([key]) =>
      key.startsWith("orderCertificate"),
    );
    expect(certificate).toHaveLength(20);
    for (const [key, value] of certificate)
      expect(value, `${locale}:${key}`).not.toMatch(
        /donat|\btip(?:s|ping)?\b|打赏|打賞|チップ|ทิป|tiền boa|propina|gorjeta/iu,
      );
    const filled = [
      formatStorefrontMessage(copy, "orderCertificateHelp", locale, {
        artist: "ไทย",
      }),
      formatStorefrontMessage(copy, "orderCertificateGift", locale, {
        gift: "ไทย",
        quantity: "2",
      }),
      formatStorefrontMessage(copy, "orderCertificateDelivered", locale, {
        date: "ไทย",
      }),
      formatStorefrontMessage(copy, "orderCertificateOrder", locale, {
        number: "FS-7K3M9C",
      }),
      formatStorefrontMessage(copy, "orderCertificateFrom", locale, {
        name: "ไทย",
      }),
      formatStorefrontMessage(copy, "orderCertificateImageAlt", locale, {
        artist: "ไทย",
      }),
    ];
    for (const text of filled) expect(text).not.toMatch(/[{}]/u);
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
