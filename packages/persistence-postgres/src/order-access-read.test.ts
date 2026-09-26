import { expect, test } from "vitest";
const module = await import("./order-access-read.js").catch(() => undefined);
const id = "00000000-0000-4000-8000-000000000001";
const row = {
  id,
  schema_version: 1,
  idol_handle: "test-idol",
  idol_display_name: "Test Idol",
  gift_title: "Test Gift",
  variant_label: null,
  quantity: 1,
  unit_amount_minor: "100",
  line_subtotal_minor: "100",
  tax_amount_minor: "0",
  discount_amount_minor: "0",
  line_total_minor: "100",
  currency: "USD",
  display_mode: "anonymous",
  fulfillment_status: "PENDING",
  idol_translation_requested_locale: "en",
  idol_translation_resolved_locale: "en",
  idol_translation_fallback_used: false,
  idol_daily_translation_id: null,
  gift_translation_requested_locale: "en",
  gift_translation_resolved_locale: "en",
  gift_translation_fallback_used: false,
  gift_daily_translation_id: null,
  idol_portrait_object_key: "media/public/test-idol/image.webp",
  idol_portrait_public_object_key: "media/public/test-idol/image.webp",
  idol_portrait_checksum_sha256: "a".repeat(64),
  idol_portrait_alt: "Portrait",
  idol_portrait_alt_requested_locale: "en",
  idol_portrait_alt_resolved_locale: "en",
  idol_portrait_alt_fallback_used: false,
  idol_portrait_alt_daily_translation_id: null,
  gift_image_object_key: "media/public/test-gift/image.webp",
  gift_image_public_object_key: "media/public/test-gift/image.webp",
  gift_image_checksum_sha256: "b".repeat(64),
  gift_image_alt: "Gift",
  gift_image_alt_requested_locale: "en",
  gift_image_alt_resolved_locale: "en",
  gift_image_alt_fallback_used: false,
  gift_image_alt_daily_translation_id: null,
};
test("legacy historical items have no invented variant label or private references", () => {
  expect(module).toBeDefined();
  const result = module!.orderAccessItem(
    row,
    1,
    "https://cdn.example.invalid/",
  );
  expect(result.gift.variantLabel).toBeNull();
  expect(result.idol.portrait.url).toBe(
    "https://cdn.example.invalid/media/public/test-idol/image.webp",
  );
  for (const forbidden of [
    "objectKey",
    "supportIntentId",
    "orderItemId",
    "tokenDigest",
    "checksum",
  ])
    expect(JSON.stringify(result)).not.toContain(forbidden);
});
test("DAILY history preserves actual source language and original variant label", () => {
  expect(module).toBeDefined();
  const result = module!.orderAccessItem(
    {
      ...row,
      schema_version: 2,
      variant_label: "原规格",
      gift_title: "原礼物",
      gift_daily_translation_id: id,
      gift_translation_resolved_locale: "zh-CN",
      gift_translation_fallback_used: true,
    },
    1,
    "https://cdn.example.invalid/",
  );
  expect(result.gift).toMatchObject({
    title: "原礼物",
    variantLabel: "原规格",
    locale: {
      mode: "DAILY",
      resolvedLocale: "zh-CN",
      sourceLocale: "zh-CN",
      requestedLocale: "en",
      fallbackUsed: true,
    },
  });
});
test("historical media cannot replace the configured CDN origin", () => {
  expect(module).toBeDefined();
  for (const objectKey of [
    "https://evil.example.invalid/image",
    "//evil.example.invalid/image",
    "../private/image",
    "media/../../image",
  ])
    expect(() =>
      module!.orderAccessItem(
        {
          ...row,
          idol_portrait_object_key: objectKey,
          idol_portrait_public_object_key: objectKey,
        },
        1,
        "https://cdn.example.invalid/",
      ),
    ).toThrow();
});

test("private historical master keys are never used as a public image URL", () => {
  expect(module).toBeDefined();
  const result = module!.orderAccessItem(
    {
      ...row,
      idol_portrait_object_key: "processed/master/private-idol.png",
      gift_image_object_key: "processed/master/private-gift.png",
    },
    1,
    "https://cdn.example.invalid/",
  );
  expect(result.idol.portrait.url).toBe(
    "https://cdn.example.invalid/media/public/test-idol/image.webp",
  );
  expect(result.gift.image.url).toBe(
    "https://cdn.example.invalid/media/public/test-gift/image.webp",
  );
  expect(JSON.stringify(result)).not.toContain("processed/master/");
});
test("an unavailable ready derivative cannot fall back to the private master", () => {
  expect(module).toBeDefined();
  expect(() =>
    module!.orderAccessItem(
      { ...row, idol_portrait_public_object_key: null },
      1,
      "https://cdn.example.invalid/",
    ),
  ).toThrow();
});
test("valid v2 history cannot silently omit its saved variant label", () => {
  expect(module).toBeDefined();
  expect(() =>
    module!.orderAccessItem(
      { ...row, schema_version: 2 },
      1,
      "https://cdn.example.invalid/",
    ),
  ).toThrow();
});
test("the protected detail shows the public order number next to its UUID", async () => {
  expect(module).toBeDefined();
  const client = {
    query: async () => ({ rows: [row] }),
    release: () => {},
  };
  const detail = await module!.readOrderAccessDetail(
    client,
    {
      id,
      public_order_id: "00000000-0000-4000-8000-000000000002",
      public_order_no: "FS-7K3M9C",
      presentation_locale: "en",
      order_status: "OPEN",
      payment_status: "PAID",
      dispute_status: "NONE",
      fulfillment_status: "PENDING",
      currency: "USD",
      subtotal_minor: "100",
      tax_amount_minor: "0",
      shipping_amount_minor: "0",
      fee_amount_minor: "0",
      discount_amount_minor: "0",
      total_amount_minor: "100",
      created_at: "2026-09-26T00:00:00.000Z",
      updated_at: "2026-09-26T00:00:00.000Z",
    },
    "https://cdn.example.invalid/",
  );
  expect(detail).toMatchObject({
    publicOrderId: "00000000-0000-4000-8000-000000000002",
    publicOrderNo: "FS-7K3M9C",
  });
});
