import {
  SUPPORTED_LOCALES,
  currencySchema,
  minorAmountSchema,
} from "@fan-support/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { formatMinorAmount } from "./format-minor-amount.js";
import { Price, type PriceProps } from "./price.js";

const usd = currencySchema.parse("USD");
const jpy = currencySchema.parse("JPY");
const bhd = currencySchema.parse("BHD");

describe("formatMinorAmount", () => {
  test("preserves the lowest USD unit at Number.MAX_SAFE_INTEGER", () => {
    const amount = minorAmountSchema.parse(Number.MAX_SAFE_INTEGER);

    expect(formatMinorAmount(amount, usd, "en")).toBe("$90,071,992,547,409.91");
  });

  test("uses the currency minor-unit scale without floating-point division", () => {
    const amount = minorAmountSchema.parse(Number.MAX_SAFE_INTEGER);

    expect(formatMinorAmount(amount, jpy, "ja")).toBe(
      "￥9,007,199,254,740,991",
    );
    expect(formatMinorAmount(amount, bhd, "en")).toBe(
      "BHD 9,007,199,254,740.991",
    );
  });

  test("uses the requested presentation locale without inferring currency", () => {
    const amount = minorAmountSchema.parse(123_456);

    expect(formatMinorAmount(amount, usd, "es")).toBe("1234,56 US$");
    expect(formatMinorAmount(amount, usd, "zh-CN")).toBe("US$1,234.56");
  });
});

describe("Price", () => {
  test("keeps integer minor units machine-readable and isolates display text", () => {
    const amount = minorAmountSchema.parse(Number.MAX_SAFE_INTEGER);
    const markup = renderToStaticMarkup(
      <Price amountMinor={amount} currency={usd} locale="en" />,
    );

    expect(markup).toMatch(/^<data\b/u);
    expect(markup).toContain('value="9007199254740991"');
    expect(markup).toContain('data-currency="USD"');
    expect(markup).toContain("<bdi>$90,071,992,547,409.91</bdi>");
  });

  test("accepts every canonical presentation locale without changing the amount", () => {
    const amount = minorAmountSchema.parse(12_345);
    for (const locale of SUPPORTED_LOCALES) {
      const markup = renderToStaticMarkup(
        <Price amountMinor={amount} currency={usd} locale={locale} />,
      );

      expect(markup).toContain('value="12345"');
      expect(markup).toContain('data-currency="USD"');
    }
  });
});

const imprecisePrice: PriceProps = {
  // @ts-expect-error Price accepts branded integer minor units, not major-unit floats.
  amountMinor: 12.34,
  currency: usd,
  locale: "en",
};
void imprecisePrice;
