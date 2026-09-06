import { expect, test } from "vitest";
import {
  SUPPORTED_LOCALES,
  giftTranslationFieldsSchema,
} from "@fan-support/contracts";
import {
  computeIdolTranslationContentHash,
  computeGiftTranslationContentHash,
  computeMediaTranslationContentHash,
  selectPublishedIdol,
  selectPublishedGift,
} from "@fan-support/content";
import {
  loadGiftDirectoryRecords,
  loadIdolDirectoryRecords,
} from "./catalog-publication-loader.js";

const uuid = (number: number) =>
  `70000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
const timestamp = "2026-09-05T00:00:00.000Z";
const origin = "https://media.example.invalid/catalog/";
type Row = Record<string, unknown>;

function translationRows(
  kind: "IDOL" | "GIFT" | "MEDIA_METADATA",
  parent: string,
  offset: number,
): Row[] {
  const idolFields = {
    displayName: "Fictional artist",
    shortBio: "A test artist.",
    fullBio: "A fictional artist for tests.",
    seoTitle: "Artist",
    seoDescription: "Artist description.",
  };
  const giftFields = giftTranslationFieldsSchema.parse({
    title: "Fictional gift",
    shortDescription: "A test gift.",
    description: "A fictional gift for tests.",
    fulfillmentDescription: "Prepared for the artist.",
    variantLabels: [{ giftVariantId: uuid(5), label: "Standard" }],
    seoTitle: "Gift",
    seoDescription: "Gift description.",
  });
  const mediaFields = { alt: "A fictional image" };
  const fields =
    kind === "IDOL" ? idolFields : kind === "GIFT" ? giftFields : mediaFields;
  const hash =
    kind === "IDOL"
      ? computeIdolTranslationContentHash(idolFields)
      : kind === "GIFT"
        ? computeGiftTranslationContentHash(giftFields)
        : computeMediaTranslationContentHash(mediaFields);
  return SUPPORTED_LOCALES.map((locale, index) => ({
    id: uuid(offset + index),
    schema_version: 1,
    locale,
    source_hash: hash,
    translated_from_source_hash: hash,
    origin: "HUMAN",
    import_batch_id: null,
    editor_id: uuid(90),
    edited_at: timestamp,
    [kind === "IDOL"
      ? "idol_revision_id"
      : kind === "GIFT"
        ? "gift_revision_id"
        : "media_metadata_revision_id"]: parent,
    ...Object.fromEntries(
      Object.entries(fields)
        .filter(([key]) => key !== "variantLabels")
        .map(([key, value]) => [
          key.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`),
          value,
        ]),
    ),
    ...(kind === "GIFT"
      ? { variant_labels: [{ gift_variant_id: uuid(5), label: "Standard" }] }
      : {}),
    review: {
      id: uuid(offset + 100 + index),
      schema_version: 1,
      status: "APPROVED",
      reviewer_id: uuid(91),
      reviewed_at: timestamp,
      reviewed_source_hash: hash,
      reviewed_content_hash: hash,
    },
  }));
}
function fixture(kind: "IDOL" | "GIFT") {
  const id = uuid(1),
    revisionId = uuid(2);
  const main: Row = {
    base: {
      id,
      schema_version: 1,
      handle: "fictional-entry",
      status: "active",
      accepting_gifts: true,
      draft_revision_id: null,
      published_revision_id: revisionId,
      version: 1,
    },
    revision: {
      id: revisionId,
      schema_version: 1,
      [kind === "IDOL" ? "idol_id" : "gift_id"]: id,
      revision: 1,
      lifecycle: "PUBLISHED",
      theme_accent: "#5373A8",
      hero_text_tone: "light",
      display_order: 0,
      category: "FLOWERS",
      delivery_minimum: 1,
      delivery_maximum: 3,
      delivery_unit: "DAY",
      requires_safety_notice: false,
      shipping_mode: "internal_to_idol",
      created_by: uuid(90),
      created_at: timestamp,
      validated_at: timestamp,
      published_at: timestamp,
      superseded_at: null,
      archived_at: null,
    },
    publication: {
      id: uuid(3),
      proof_version: 1,
      schema_version: 1,
      content_type: kind,
      [kind === "IDOL" ? "idol_id" : "gift_id"]: id,
      [kind === "IDOL" ? "idol_revision_id" : "gift_revision_id"]: revisionId,
      action: "PUBLISH",
      replaces_publication_id: null,
      published_by: uuid(91),
      published_at: timestamp,
    },
    translations: translationRows(kind, revisionId, 200),
    contents: [{ component_code: "FLOWER", quantity: 1, unit: "ITEM" }],
    variants: [
      {
        id: uuid(5),
        schema_version: 1,
        gift_id: id,
        sku: "FIXTURE-GIFT",
        status: "active",
        inventory_policy: "PROCURE_ON_DEMAND",
      },
    ],
  };
  const roles =
    kind === "IDOL"
      ? ([
          ["PORTRAIT", 1600, 2000],
          ["HERO_DESKTOP", 2400, 1350],
          ["HERO_MOBILE", 1080, 1350],
        ] as const)
      : ([["PRIMARY", 1200, 1200]] as const);
  const media = roles.map(([role, width, height], index) => {
    const assetId = uuid(10 + index),
      metadataId = uuid(20 + index);
    return {
      provenance_eligible: true,
      reference: {
        [kind === "IDOL" ? "idol_revision_id" : "gift_revision_id"]: revisionId,
        role,
        media_asset_id: assetId,
        media_metadata_revision_id: metadataId,
        sort_order: 0,
      },
      asset: {
        id: assetId,
        schema_version: 1,
        checksum_sha256: "a".repeat(64),
        mime_type: "image/webp",
        width,
        height,
        byte_size: 1234,
        object_key: `source/${assetId}.webp`,
        processing_status: "READY",
        processing_error_code: null,
        rights_status: "APPROVED",
        rights_reference: "Fixture rights",
        created_at: timestamp,
      },
      metadata: {
        id: metadataId,
        schema_version: 1,
        media_asset_id: assetId,
        revision: 1,
        lifecycle: "PUBLISHED",
        presentation_kind: "INFORMATIVE",
        focal_x: 0.5,
        focal_y: 0.4,
        created_by: uuid(90),
        created_at: timestamp,
        validated_at: timestamp,
        published_at: timestamp,
        superseded_at: null,
        archived_at: null,
      },
      variant: {
        id: uuid(30 + index),
        schema_version: 1,
        media_asset_id: assetId,
        format: "WEBP",
        width,
        height,
        byte_size: 1000,
        checksum_sha256: "b".repeat(64),
        object_key: `public/${assetId}.webp`,
        status: "READY",
      },
      translations: translationRows(
        "MEDIA_METADATA",
        metadataId,
        1000 + index * 1000,
      ),
    };
  });
  return { id, main, media };
}
function clientWith(main: Row[], media: Row[]) {
  const calls: { text: string; values: unknown[] | undefined }[] = [];
  return {
    calls,
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return { rows: calls.length === 1 ? main : media };
    },
  };
}

test("hydrates the exact current idol window and complete seven-locale approval evidence", async () => {
  const data = fixture("IDOL"),
    client = clientWith([data.main], data.media);
  const records = await loadIdolDirectoryRecords(
    client,
    [data.id],
    "th",
    origin,
  );
  expect(records).toHaveLength(1);
  const record = records[0]!;
  expect(record.selection.currentPublication.translationManifest).toHaveLength(
    28,
  );
  expect(record.selection.selectedTranslation.locale).toBe("th");
  expect(record.source.localeContext.fallbackUsed).toBe(false);
  const result = selectPublishedIdol(record.selection, record.source);
  expect(result.success).toBe(true);
  if (result.success)
    expect(result.value.portrait.url).toBe(`${origin}public/${uuid(10)}.webp`);
  expect(client.calls).toHaveLength(2);
  expect(client.calls[0]?.values).toEqual([[data.id]]);
  expect(client.calls[0]?.text).not.toContain(data.id);
});

test("hydrates gift components, localized variant labels, and media without projection shortcuts", async () => {
  const data = fixture("GIFT"),
    client = clientWith([data.main], data.media);
  const records = await loadGiftDirectoryRecords(
    client,
    [data.id],
    "ja",
    origin,
  );
  const record = records[0]!;
  expect(record.selection.currentPublication.translationManifest).toHaveLength(
    14,
  );
  expect(selectPublishedGift(record.selection, record.source).success).toBe(
    true,
  );
  expect(record.source.translation.variantLabels[0]?.label).toBe("Standard");
});

test("supports a rollback pointer to a superseded immutable revision", async () => {
  const data = fixture("IDOL");
  (data.main["revision"] as Row)["lifecycle"] = "SUPERSEDED";
  (data.main["revision"] as Row)["superseded_at"] = timestamp;
  (data.main["publication"] as Row)["action"] = "ROLLBACK";
  (data.main["publication"] as Row)["replaces_publication_id"] = uuid(99);
  const [record] = await loadIdolDirectoryRecords(
    clientWith([data.main], data.media),
    [data.id],
    "en",
    origin,
  );
  expect(
    record && selectPublishedIdol(record.selection, record.source).success,
  ).toBe(true);
});

test("fails closed on missing, duplicate, or incomplete publication records", async () => {
  const data = fixture("IDOL");
  await expect(
    loadIdolDirectoryRecords(clientWith([], []), [data.id], "en", origin),
  ).rejects.toThrow();
  await expect(
    loadIdolDirectoryRecords(
      clientWith([data.main, data.main], data.media),
      [data.id],
      "en",
      origin,
    ),
  ).rejects.toThrow();
  (data.main["translations"] as Row[]).pop();
  await expect(
    loadIdolDirectoryRecords(
      clientWith([data.main], data.media),
      [data.id],
      "en",
      origin,
    ),
  ).rejects.toThrow();
});

test("rejects invalid window ids, duplicate ids, unsafe media origins before querying", async () => {
  const client = clientWith([], []);
  for (const ids of [["invalid"], [uuid(1), uuid(1)]])
    await expect(
      loadIdolDirectoryRecords(client, ids, "en", origin),
    ).rejects.toThrow();
  for (const base of [
    "http://media.example.invalid/",
    "https://media.example.invalid/?width=50",
    "https://media.example.invalid/#fragment",
    "https://user:secret@media.example.invalid/",
    "https://127.0.0.1/",
  ])
    await expect(
      loadIdolDirectoryRecords(client, [], "en", base),
    ).rejects.toThrow();
  expect(client.calls).toHaveLength(0);
});

test("does not issue SQL for an empty valid window", async () => {
  const client = clientWith([], []);
  expect(await loadGiftDirectoryRecords(client, [], "vi", origin)).toEqual([]);
  expect(client.calls).toHaveLength(0);
});

test("produces valid projections for all seven requested locales", async () => {
  for (const locale of SUPPORTED_LOCALES) {
    const idol = fixture("IDOL");
    const [idolRecord] = await loadIdolDirectoryRecords(
      clientWith([idol.main], idol.media),
      [idol.id],
      locale,
      origin,
    );
    expect(
      idolRecord &&
        selectPublishedIdol(idolRecord.selection, idolRecord.source).success,
    ).toBe(true);
    const gift = fixture("GIFT");
    const [giftRecord] = await loadGiftDirectoryRecords(
      clientWith([gift.main], gift.media),
      [gift.id],
      locale,
      origin,
    );
    expect(
      giftRecord &&
        selectPublishedGift(giftRecord.selection, giftRecord.source).success,
    ).toBe(true);
  }
});

test("preserves discovery order when PostgreSQL returns a different row order", async () => {
  const first = fixture("IDOL");
  const second = fixture("IDOL");
  const id = uuid(40),
    revisionId = uuid(41);
  (second.main["base"] as Row)["id"] = id;
  (second.main["base"] as Row)["published_revision_id"] = revisionId;
  (second.main["revision"] as Row)["id"] = revisionId;
  (second.main["revision"] as Row)["idol_id"] = id;
  (second.main["publication"] as Row)["idol_id"] = id;
  (second.main["publication"] as Row)["idol_revision_id"] = revisionId;
  for (const row of second.main["translations"] as Row[])
    row["idol_revision_id"] = revisionId;
  for (const row of second.media)
    (row.reference as Row)["idol_revision_id"] = revisionId;
  const records = await loadIdolDirectoryRecords(
    clientWith([second.main, first.main], [...second.media, ...first.media]),
    [first.id, id],
    "en",
    origin,
  );
  expect(records.map((record) => record.source.base.id)).toEqual([
    first.id,
    id,
  ]);
});

test("retains current asset rights and processing states for the domain publication gate", async () => {
  for (const [field, value] of [
    ["rights_status", "EXPIRED"],
    ["processing_status", "PENDING"],
  ] as const) {
    const data = fixture("IDOL");
    (data.media[0]!.asset as Row)[field] = value;
    const [record] = await loadIdolDirectoryRecords(
      clientWith([data.main], data.media),
      [data.id],
      "en",
      origin,
    );
    expect(
      record && selectPublishedIdol(record.selection, record.source).success,
    ).toBe(false);
  }
});

test.each([false, null, undefined])(
  "rejects an otherwise approved master when source provenance is %s",
  async (proof) => {
    const data = fixture("IDOL");
    (data.media[0]! as Row)["provenance_eligible"] = proof;
    await expect(
      loadIdolDirectoryRecords(
        clientWith([data.main], data.media),
        [data.id],
        "en",
        origin,
      ),
    ).rejects.toThrow("CATALOG_PUBLICATION_INVALID");
  },
);

test("does not fabricate approved or missing media translation evidence", async () => {
  const unapproved = fixture("GIFT");
  ((unapproved.main["translations"] as Row[])[0]!["review"] as Row)["status"] =
    "DRAFT";
  await expect(
    loadGiftDirectoryRecords(
      clientWith([unapproved.main], unapproved.media),
      [unapproved.id],
      "en",
      origin,
    ),
  ).rejects.toThrow();
  const missing = fixture("IDOL");
  missing.media[0]!.translations.pop();
  await expect(
    loadIdolDirectoryRecords(
      clientWith([missing.main], missing.media),
      [missing.id],
      "en",
      origin,
    ),
  ).rejects.toThrow();
});

test("leaves localized content hash verification to the strong domain projection", async () => {
  const data = fixture("GIFT");
  (data.main["translations"] as Row[])[0]!["title"] =
    "Changed without reviewed evidence";
  const [record] = await loadGiftDirectoryRecords(
    clientWith([data.main], data.media),
    [data.id],
    "en",
    origin,
  );
  expect(
    record && selectPublishedGift(record.selection, record.source).success,
  ).toBe(false);
});

test.each([undefined, null, false, 2])(
  "catalog cannot downgrade a missing or unverified publication proof marker %s",
  async (version) => {
    const data = fixture("GIFT");
    (data.main["publication"] as Row)["proof_version"] = version;
    await expect(
      loadGiftDirectoryRecords(
        clientWith([data.main], data.media),
        [data.id],
        "en",
        origin,
      ),
    ).rejects.toThrow("CATALOG_PUBLICATION_INVALID");
  },
);
