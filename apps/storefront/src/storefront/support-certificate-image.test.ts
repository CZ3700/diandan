import { describe, expect, it } from "vitest";
import { orderAccessItemSchema } from "@fan-support/contracts";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";
import {
  certificateFileName,
  certificateGiftLine,
  certificateSignatureName,
  certificateTracked,
  certificateText,
  wrapCertificateText,
} from "./support-certificate-image";

const language = {
  schemaVersion: 1,
  mode: "APPROVED",
  requestedLocale: "en",
  resolvedLocale: "en",
  fallbackUsed: false,
} as const;
const media = {
  url: "https://media.example.test/processed/v1/a/b.webp",
  alt: "Artist",
  locale: language,
};
const certificate = {
  deliveredAt: "2026-09-29T23:30:00.000000Z",
  revoked: false,
};
const item = orderAccessItemSchema.parse({
  schemaVersion: 1,
  position: 3,
  idol: {
    handle: "artist",
    displayName: "Mina",
    locale: language,
    portrait: media,
  },
  gift: { title: "Cheer", variantLabel: null, locale: language, image: media },
  quantity: 1200,
  unitAmountMinor: 5,
  lineSubtotalMinor: 6000,
  taxAmountMinor: 0,
  discountAmountMinor: 0,
  lineTotalMinor: 6000,
  currency: "USD",
  displayMode: "nickname",
  giftKind: "VIRTUAL",
  fulfillmentStatus: "DELIVERED",
  deliveryProofs: [],
  supportCertificate: certificate,
});

describe("certificate signature", () => {
  it("accepts 1–40 characters after trimming and refuses control characters", () => {
    expect(certificateSignatureName("  Mina's   fan  ")).toBe("Mina's fan");
    expect(certificateSignatureName("   ")).toBeNull();
    expect(certificateSignatureName("粉".repeat(40))).toBe("粉".repeat(40));
    expect(certificateSignatureName("粉".repeat(41))).toBeNull();
    expect(certificateSignatureName("a\u0007b")).toBeNull();
  });

  it("prints nothing, an anonymous line, or the typed name", async () => {
    const copy = await loadStorefrontCopy("en");
    const text = (signature: Parameters<typeof certificateText>[5]) =>
      certificateText(item, certificate, "FS-7K3M9C", "en", copy, signature);
    expect(text({ mode: "NONE" }).signature).toBeNull();
    expect(text({ mode: "ANONYMOUS" }).signature).toBe(
      copy.orderCertificateFromAnonymous,
    );
    expect(text({ mode: "NAME", name: "Mina's fan" }).signature).toBe(
      "From Mina's fan",
    );
    const words = text({ mode: "NONE" });
    expect(words).toEqual({
      title: copy.orderCertificateTitle,
      artist: "Mina",
      gift: "Cheer × 1,200",
      signature: null,
      delivered: "Delivered on September 29, 2026",
      order: "Order FS-7K3M9C",
    });
    // Nothing about money or contact reaches the image.
    expect(JSON.stringify(words)).not.toMatch(/USD|\$|6,?000|@/u);
  });

  it("localizes the words and quantity", async () => {
    const copy = await loadStorefrontCopy("zh-CN");
    const words = certificateText(
      item,
      certificate,
      "FS-7K3M9C",
      "zh-CN",
      copy,
      {
        mode: "ANONYMOUS",
      },
    );
    expect(words.title).toBe("数字应援凭证");
    expect(words.gift).toBe("Cheer × 1,200");
    expect(words.delivered).toBe("送达日期：2026年9月29日");
    expect(words.signature).toBe("来自一位匿名粉丝");
  });
});

describe("certificate layout helpers", () => {
  const measure = (value: string) => [...value].length * 10;

  it("wraps at words, breaks unspaced scripts and ellipsizes past the line limit", () => {
    expect(wrapCertificateText("one two three", "en", measure, 80, 3)).toEqual([
      "one two",
      "three",
    ]);
    const thai = wrapCertificateText(
      "ขอบคุณสำหรับการสนับสนุน",
      "th",
      measure,
      60,
      5,
    );
    expect(thai.every((line) => measure(line) <= 60)).toBe(true);
    expect(thai.join("")).toBe("ขอบคุณสำหรับการสนับสนุน");
    const cut = wrapCertificateText("a b c d e f g h", "en", measure, 30, 2);
    expect(cut).toHaveLength(2);
    expect(cut[1]!.endsWith("…")).toBe(true);
    expect(measure(cut[1]!)).toBeLessThanOrEqual(30);
  });

  it("drops a variant label that only repeats the gift title", async () => {
    const copy = await loadStorefrontCopy("en");
    const repeated = orderAccessItemSchema.parse({
      ...item,
      gift: { ...item.gift, variantLabel: "Cheer" },
    });
    const distinct = orderAccessItemSchema.parse({
      ...item,
      gift: { ...item.gift, variantLabel: "Gold" },
    });
    expect(certificateGiftLine(repeated, "en", copy)).toBe("Cheer × 1,200");
    expect(certificateGiftLine(distinct, "en", copy)).toBe(
      "Cheer · Gold × 1,200",
    );
  });

  it("spaces and capitalizes the title only in Latin-script locales", () => {
    expect(
      (["en", "es", "pt", "vi", "zh-CN", "ja", "th"] as const).map((locale) =>
        certificateTracked(locale),
      ),
    ).toEqual([true, true, true, true, false, false, false]);
  });

  it("names the file after the public order number and line", () => {
    expect(certificateFileName("FS-7K3M9C", 3)).toBe(
      "support-certificate-FS-7K3M9C-3.png",
    );
  });
});
