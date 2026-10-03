import { afterEach, describe, expect, it, vi } from "vitest";
import {
  orderAccessItemSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import { loadStorefrontCopy } from "@fan-support/i18n/storefront";
import {
  certificateFileName,
  certificateGiftLine,
  certificateSignatureName,
  certificateTracked,
  certificateText,
  renderSupportCertificate,
  wrapCertificateText,
  type CertificateTheme,
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
    const latin = ["en", "es", "pt", "vi"] as const;
    const other = ["zh-CN", "ja", "th"] as const;
    expect([...latin, ...other].sort()).toEqual([...SUPPORTED_LOCALES].sort());
    expect(latin.map((locale) => certificateTracked(locale))).toEqual(
      latin.map(() => true),
    );
    expect(other.map((locale) => certificateTracked(locale))).toEqual(
      other.map(() => false),
    );
  });

  it("names the file after the public order number and line", () => {
    expect(certificateFileName("FS-7K3M9C", 3)).toBe(
      "support-certificate-FS-7K3M9C-3.png",
    );
  });
});

describe("certificate image composition", () => {
  const urls = { artist: "/artist-snapshot.webp", gift: "/gift-snapshot.webp" };
  const theme: CertificateTheme = {
    background: "#101010",
    surface: "#202020",
    accent: "#d0b080",
    text: "#ffffff",
    muted: "#aaaaaa",
    border: "#505050",
    fontFamily: "sans-serif",
  };
  const text = {
    title: "Certificate",
    artist: "Mina",
    gift: "Cheer × 1",
    signature: null,
    delivered: "Delivered today",
    order: "Order FS-TEST",
  };
  afterEach(() => vi.unstubAllGlobals());

  function canvasFixture(
    giftSize: [number, number],
    failedUrl?: string,
    failExport = false,
  ) {
    const requested: string[] = [];
    class Photo {
      src = "";
      naturalWidth = 400;
      naturalHeight = 500;
      async decode() {
        requested.push(this.src);
        if (this.src === failedUrl || !Object.values(urls).includes(this.src))
          throw new Error("Photo unavailable");
        if (this.src === urls.gift)
          [this.naturalWidth, this.naturalHeight] = giftSize;
      }
    }
    const context = {
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      rect: vi.fn(),
      fill: vi.fn(),
      clip: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      measureText: (value: string) => ({ width: value.length * 12 }),
      drawImage:
        vi.fn<
          (
            photo: Photo,
            x: number,
            y: number,
            width: number,
            height: number,
          ) => void
        >(),
    };
    const png = new Blob(["TEST PNG"], { type: "image/png" });
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: vi.fn((callback: BlobCallback) => {
        if (failExport && canvas.toBlob.mock.calls.length === 1)
          throw new Error("Canvas export blocked");
        callback(png);
      }),
    };
    vi.stubGlobal("Image", Photo);
    vi.stubGlobal("document", { createElement: () => canvas });
    return { canvas, context, png, requested };
  }

  it.each([
    [800, 200],
    [200, 800],
  ] as [number, number][])(
    "loads independent artist and gift snapshots and contains a %i × %i gift without cropping",
    async (width, height) => {
      const fixture = canvasFixture([width, height]);
      expect(await renderSupportCertificate(text, theme, "en", urls)).toBe(
        fixture.png,
      );
      expect(fixture.requested).toEqual([urls.artist, urls.gift]);
      expect([fixture.canvas.width, fixture.canvas.height]).toEqual([
        1080, 1620,
      ]);
      expect(
        fixture.context.drawImage.mock.calls.map(([photo]) => photo.src),
      ).toEqual([urls.artist, urls.gift]);
      const [, x, y, drawnWidth, drawnHeight] =
        fixture.context.drawImage.mock.calls[1]!;
      const giftBaseline = Number(
        fixture.context.fillText.mock.calls.find(
          ([value]) => value === text.gift,
        )?.[2],
      );
      expect(drawnWidth / drawnHeight).toBeCloseTo(width / height);
      expect(x).toBeGreaterThanOrEqual(444);
      expect(y).toBeGreaterThanOrEqual(giftBaseline + 40);
      expect(x + drawnWidth).toBeLessThanOrEqual(636);
      expect(y + drawnHeight).toBeLessThanOrEqual(giftBaseline + 232);
      expect(x + drawnWidth / 2).toBe(540);
      expect(Math.max(drawnWidth, drawnHeight)).toBe(192);
    },
  );

  it.each(["artist", "gift"] as const)(
    "a failed %s photo does not discard the other image",
    async (failed) => {
      const fixture = canvasFixture([320, 320], urls[failed]);
      await renderSupportCertificate(text, theme, "en", urls);
      expect(fixture.requested).toEqual([urls.artist, urls.gift]);
      expect(
        fixture.context.drawImage.mock.calls.map(([photo]) => photo.src),
      ).toEqual([urls[failed === "artist" ? "gift" : "artist"]]);
    },
  );

  it("an export failure redraws safely without either photo or private financial text", async () => {
    const fixture = canvasFixture([320, 320], undefined, true);
    const words = certificateText(
      item,
      certificate,
      "FS-TEST",
      "en",
      await loadStorefrontCopy("en"),
      { mode: "NONE" },
    );
    expect(await renderSupportCertificate(words, theme, "en", urls)).toBe(
      fixture.png,
    );
    expect(fixture.canvas.toBlob).toHaveBeenCalledTimes(2);
    expect(fixture.context.drawImage).toHaveBeenCalledTimes(2);
    expect(
      fixture.context.fillRect.mock.calls.filter(
        (args) => args[0] === 0 && args[1] === 0,
      ),
    ).toHaveLength(2);
    expect(
      fixture.context.fillText.mock.calls.map(([value]) => value).join(" "),
    ).not.toMatch(/USD|6,?000|@/u);
  });
});
