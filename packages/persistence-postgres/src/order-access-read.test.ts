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
  delivery_proofs: [],
};
test("a privately authorized wish record reflects withdrawal and financial revocation without claiming delivery", () => {
  const wish = {
    ...row,
    gift_kind: "WISH",
    wish_entry_id: id,
    wish_supported_at: "2026-10-01T00:00:00.000Z",
    wish_visibility: "PUBLIC_NAMED",
    wish_public_alias: "Moon friend",
    wish_withdrawn: true,
  };
  const record = module!.orderAccessItem(
    wish,
    1,
    "https://cdn.example.invalid/",
  );
  expect(record).toMatchObject({
    fulfillmentStatus: "PENDING",
    supportCertificate: null,
    wishSupport: {
      entryId: id,
      visibility: "PUBLIC_NAMED",
      publicAlias: "Moon friend",
      withdrawn: true,
      revoked: false,
    },
  });
  for (const change of [{ refunded_in_full: true }, {}]) {
    const value = module!.orderAccessItem(
      { ...wish, ...change },
      1,
      "https://cdn.example.invalid/",
      "LOST",
    );
    expect(value).toMatchObject({ wishSupport: { revoked: true } });
  }
  expect(
    module!.orderAccessItem(
      { ...row, gift_kind: "WISH" },
      1,
      "https://cdn.example.invalid/",
    ),
  ).not.toHaveProperty("wishSupport");
});
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
test("delivered physical lines expose opaque proof references, never storage identities", () => {
  expect(module).toBeDefined();
  const proof = {
    proofId: "00000000-0000-4000-8000-00000000000a",
    width: 1600,
    height: 1200,
    thumbnailWidth: 480,
    thumbnailHeight: 360,
  };
  const result = module!.orderAccessItem(
    {
      ...row,
      gift_kind: "PHYSICAL",
      fulfillment_status: "DELIVERED",
      delivery_proofs: [proof],
    },
    1,
    "https://cdn.example.invalid/",
  );
  expect(result.deliveryProofs).toEqual([proof]);
  expect(JSON.stringify(result)).not.toContain("fulfillment-proofs/");
  expect(() =>
    module!.orderAccessItem(
      { ...row, fulfillment_status: "PREPARING", delivery_proofs: [proof] },
      1,
      "https://cdn.example.invalid/",
    ),
  ).toThrow();
});
// ADR-019 supplement (L3-09): certificate facts only on delivered virtual lines.
test("delivered virtual lines carry certificate facts; revoked once refunded in full", () => {
  expect(module).toBeDefined();
  const delivered = {
    ...row,
    gift_kind: "VIRTUAL",
    fulfillment_status: "DELIVERED",
    delivered_at: "2026-09-29T12:00:00.000000Z",
    refunded_in_full: false,
    // The read never selects private intent columns; a stray one must not surface.
    display_name_ciphertext: "secret",
  };
  const item = (value: Record<string, unknown>) =>
    module!.orderAccessItem(value, 1, "https://cdn.example.invalid/");
  expect(item(delivered).supportCertificate).toEqual({
    deliveredAt: "2026-09-29T12:00:00.000000Z",
    revoked: false,
  });
  expect(
    item({ ...delivered, refunded_in_full: true }).supportCertificate,
  ).toEqual({ deliveredAt: "2026-09-29T12:00:00.000000Z", revoked: true });
  expect(JSON.stringify(item(delivered))).not.toContain("secret");
  for (const change of [
    { gift_kind: "PHYSICAL" },
    { gift_kind: null },
    { fulfillment_status: "PENDING", delivered_at: null },
  ])
    expect(item({ ...delivered, ...change }).supportCertificate).toBeNull();
  // A delivered virtual row without its delivery time is not a readable history.
  expect(() => item({ ...delivered, delivered_at: null })).toThrow();
});
// L3-09a: a lost chargeback returns the whole order's payment, so every certificate is withdrawn.
test("a lost dispute withdraws the certificate; open or won disputes do not", () => {
  expect(module).toBeDefined();
  const delivered = {
    ...row,
    gift_kind: "VIRTUAL",
    fulfillment_status: "DELIVERED",
    delivered_at: "2026-09-29T12:00:00.000000Z",
    refunded_in_full: false,
  };
  const revoked = (dispute: string, value = delivered) =>
    module!.orderAccessItem(value, 1, "https://cdn.example.invalid/", dispute)
      .supportCertificate?.revoked;
  expect(revoked("LOST")).toBe(true);
  for (const dispute of ["NONE", "OPEN", "WON"])
    expect(revoked(dispute)).toBe(false);
  expect(revoked("WON", { ...delivered, refunded_in_full: true })).toBe(true);
  expect(
    module!.orderAccessItem(
      { ...delivered, gift_kind: "PHYSICAL" },
      1,
      "https://cdn.example.invalid/",
      "LOST",
    ).supportCertificate,
  ).toBeNull();
});
test("the detail read withdraws every delivered virtual line of a lost-dispute order", async () => {
  expect(module).toBeDefined();
  const delivered = {
    ...row,
    gift_kind: "VIRTUAL",
    fulfillment_status: "DELIVERED",
    delivered_at: "2026-09-29T12:00:00.000000Z",
    refunded_in_full: false,
  };
  const client = {
    query: async () => ({ rows: [delivered, delivered] }),
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
      dispute_status: "LOST",
      fulfillment_status: "DELIVERED",
      currency: "USD",
      subtotal_minor: "200",
      tax_amount_minor: "0",
      shipping_amount_minor: "0",
      fee_amount_minor: "0",
      discount_amount_minor: "0",
      total_amount_minor: "200",
      created_at: "2026-09-26T00:00:00.000Z",
      updated_at: "2026-09-26T00:00:00.000Z",
    },
    "https://cdn.example.invalid/",
  );
  expect(detail.items.map((item) => item.supportCertificate?.revoked)).toEqual([
    true,
    true,
  ]);
});
test("the read counts only succeeded refunds against the line total", async () => {
  expect(module).toBeDefined();
  let sql = "";
  const client = {
    query: async (text: string) => {
      sql = text;
      return { rows: [row] };
    },
    release: () => {},
  };
  await module!.readOrderAccessDetail(
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
  for (const guard of [
    "refund.status='SUCCEEDED'",
    "ri.order_item_id=i.id",
    ">=i.line_total_minor",
    "f.delivered_at",
  ])
    expect(sql).toContain(guard);
  expect(sql).not.toContain("support_intents");
});
test("proof reads require exactly one session-bound, visible proof", async () => {
  expect(module).toBeDefined();
  const checksum = "d".repeat(64);
  const upload = "00000000-0000-4000-8000-00000000000b";
  const located = {
    object_key: `fulfillment-proofs/v1/renditions/${upload}/${checksum}.webp`,
    checksum_sha256: checksum,
    byte_size: 2048,
    width: 480,
    height: 360,
  };
  const calls: unknown[][] = [];
  const client = (rows: unknown[]) => ({
    query: async (sql: string, values: unknown[]) => {
      calls.push([sql, values]);
      return { rows };
    },
    release: () => {},
  });
  const command = {
    schemaVersion: 1 as const,
    publicOrderId: id,
    proofId: "00000000-0000-4000-8000-00000000000a",
    rendition: "thumbnail" as const,
    sessionCandidates: [
      {
        schemaVersion: 1 as const,
        tokenDigest: "e".repeat(64),
        pepperVersion: "v1",
      },
    ],
  };
  const location = await module!.locateOrderAccessProof(
    client([located]) as never,
    command as never,
  );
  expect(location.rendition).toMatchObject({
    objectKey: located.object_key,
    byteSize: 2048,
    mimeType: "image/webp",
  });
  const [sql, values] = calls[0]!;
  expect(values).toEqual([
    JSON.stringify([{ digest: "e".repeat(64), version: "v1" }]),
    id,
    command.proofId,
    "thumbnail",
  ]);
  for (const guard of [
    "session.status='ACTIVE'",
    "f.status='DELIVERED'",
    "i.gift_kind IS DISTINCT FROM 'VIRTUAL'",
    "fulfillment_proof_withdrawals",
    "u.status='READY'",
  ])
    expect(String(sql)).toContain(guard);
  for (const rows of [[], [located, located]])
    await expect(
      module!.locateOrderAccessProof(client(rows) as never, command as never),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
});
