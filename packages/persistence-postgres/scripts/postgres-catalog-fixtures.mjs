import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  computeGiftTranslationContentHash,
  computeIdolTranslationContentHash,
  computeMediaTranslationContentHash,
} from "@fan-support/content";
import { normalizeArtistSearchName } from "@fan-support/catalog";

const createdAt = "2026-01-01T00:00:00.000Z";
const editedAt = "2026-01-01T00:01:00.000Z";
const submittedAt = "2026-01-01T00:02:00.000Z";
const reviewedAt = "2026-01-01T00:03:00.000Z";
const publishedAt = "2026-01-01T00:04:00.000Z";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const uuid = (number) =>
  `61000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
let sequence = 1;
const id = () => uuid(sequence++);

async function insert(client, table, row) {
  const columns = Object.keys(row);
  if (![table, ...columns].every((name) => /^[a-z][a-z0-9_]*$/u.test(name)))
    throw new Error("invalid fixture SQL identifier");
  await client.query(
    `INSERT INTO public.${table} (${columns.join(",")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")})`,
    Object.values(row),
  );
}

async function translation(client, config, values, editor, reviewer) {
  const translationId = id();
  await insert(client, config.table, {
    id: translationId,
    [config.parent]: config.parentId,
    locale: values.locale,
    source_hash: values.contentHash,
    translated_from_source_hash: values.englishHash,
    origin: "HUMAN",
    editor_id: editor,
    edited_at: editedAt,
    ...values.columns,
  });
  for (const [index, status] of ["DRAFT", "IN_REVIEW", "APPROVED"].entries()) {
    await insert(client, config.reviews, {
      id: id(),
      [config.reviewParent]: translationId,
      sequence: index + 1,
      status,
      created_at: [editedAt, submittedAt, reviewedAt][index],
      ...(status === "IN_REVIEW" ? { submitted_at: submittedAt } : {}),
      ...(status === "APPROVED"
        ? {
            reviewer_id: reviewer,
            reviewed_at: reviewedAt,
            reviewed_source_hash: values.englishHash,
            reviewed_content_hash: values.contentHash,
          }
        : {}),
    });
  }
  return translationId;
}

async function publish(
  client,
  {
    kind,
    entityId,
    revisionId,
    editor,
    revisionTable,
    headTable,
    ownerColumn,
    revisionColumn,
    baseTable,
    at = publishedAt,
  },
) {
  await client.query(
    `UPDATE public.${revisionTable} SET lifecycle='VALIDATED',validated_at=$2 WHERE id=$1`,
    [revisionId, reviewedAt],
  );
  await client.query(
    `UPDATE public.${revisionTable} SET lifecycle='PUBLISHED',published_at=$2 WHERE id=$1`,
    [revisionId, at],
  );
  const publicationId = id(),
    auditId = id(),
    requestId = id(),
    correlationId = id();
  await insert(client, "audit_logs", {
    id: auditId,
    actor_type: "ADMIN",
    actor_id: editor,
    action: "CONTENT_PUBLISH",
    subject_type: "CONTENT_PUBLICATION",
    subject_id: publicationId,
    reason_code: "TEST_FIXTURE",
    request_id: requestId,
    correlation_id: correlationId,
    outcome: "SUCCEEDED",
    created_at: at,
  });
  await insert(client, "content_publications", {
    id: publicationId,
    content_type: kind,
    [ownerColumn]: entityId,
    [revisionColumn]: revisionId,
    action: "PUBLISH",
    translation_manifest_hash: hash(`translations:${revisionId}`),
    approval_manifest_hash: hash(`approvals:${revisionId}`),
    media_manifest_hash: hash(`media:${revisionId}`),
    published_by: editor,
    published_at: at,
    idempotency_key: `catalog-fixture:${publicationId}`,
    audit_log_id: auditId,
  });
  await insert(client, headTable, {
    id: id(),
    [ownerColumn]: entityId,
    publication_id: publicationId,
    [revisionColumn]: revisionId,
    created_at: at,
    updated_at: at,
  });
  for (const locale of SUPPORTED_LOCALES)
    await insert(client, "outbox_events", {
      id: id(),
      event_type: "CONTENT_PUBLICATION_CHANGED",
      aggregate_type: "CONTENT_PUBLICATION",
      aggregate_id: publicationId,
      aggregate_version: 1,
      primary_subject_id: publicationId,
      secondary_subject_id: revisionId,
      locale,
      idempotency_key: `content-publication:${publicationId}:${locale}`,
      request_id: requestId,
      correlation_id: correlationId,
      occurred_at: at,
      available_at: at,
      created_at: at,
    });
  if (baseTable !== undefined)
    await client.query(
      `UPDATE public.${baseTable} SET status='active', published_revision_id=$2,version=version+1,updated_at=$3 WHERE id=$1`,
      [entityId, revisionId, at],
    );
  return publicationId;
}

async function seedMedia(client, editor, reviewer, index, width, height) {
  const assetId = id(),
    revisionId = id();
  await insert(client, "media_assets", {
    id: assetId,
    checksum_sha256: hash(`original:${index}`),
    mime_type: "image/webp",
    width,
    height,
    byte_size: 20000,
    object_key: `catalog-fixture/original-${index}.webp`,
    processing_status: "READY",
    rights_status: "APPROVED",
    rights_reference: "Fictional local test data",
    created_at: createdAt,
  });
  for (const format of ["WEBP", "AVIF", "JPEG"])
    await insert(client, "media_variants", {
      id: id(),
      media_asset_id: assetId,
      format,
      width,
      height,
      byte_size: 10000,
      checksum_sha256: hash(`derivative:${index}:${format}`),
      object_key: `catalog-fixture/${index}.${format.toLowerCase()}`,
      status: "READY",
      created_at: createdAt,
    });
  await insert(client, "media_metadata_revisions", {
    id: revisionId,
    media_asset_id: assetId,
    revision: 1,
    lifecycle: "DRAFT",
    presentation_kind: "INFORMATIVE",
    focal_x: 0.5,
    focal_y: 0.5,
    created_by: editor,
    created_at: createdAt,
  });
  const english = { alt: `Fictional catalog image ${index}` };
  const englishHash = computeMediaTranslationContentHash(english);
  for (const locale of SUPPORTED_LOCALES) {
    const content = { alt: `${locale}: ${english.alt}` };
    if (locale === "en") content.alt = english.alt;
    await translation(
      client,
      {
        table: "media_metadata_revision_translations",
        parent: "media_metadata_revision_id",
        parentId: revisionId,
        reviews: "media_metadata_translation_reviews",
        reviewParent: "media_metadata_translation_id",
      },
      {
        locale,
        contentHash: computeMediaTranslationContentHash(content),
        englishHash,
        columns: content,
      },
      editor,
      reviewer,
    );
  }
  await publish(client, {
    kind: "MEDIA_METADATA",
    entityId: assetId,
    revisionId,
    editor,
    revisionTable: "media_metadata_revisions",
    headTable: "media_metadata_publication_heads",
    ownerColumn: "media_asset_id",
    revisionColumn: "media_metadata_revision_id",
  });
  return { assetId, revisionId };
}

const specialNames = new Map([
  [99, "İris Ýến"],
  [100, "ＡＲＩＡ"],
  [101, "น้ำดาว"],
  [102, "100%_Real"],
]);

const localizedArtistNames = new Map(
  [
    { artist: 105, locale: "ja", name: "Luna Stage" },
    { artist: 106, locale: "th", name: "The Luna" },
    { artist: 107, locale: "es", name: "Luna" },
    { artist: 107, locale: "pt", name: "Luna" },
    { artist: 110, locale: "en", name: "Nova" },
    { artist: 110, locale: "zh-CN", name: "星河" },
    { artist: 110, locale: "th", name: "โนวา" },
    { artist: 110, locale: "vi", name: "Ngân Hà" },
    { artist: 110, locale: "ja", name: "ノヴァ" },
    { artist: 110, locale: "es", name: "Estrella del Río" },
    { artist: 110, locale: "pt", name: "Estrela do Céu" },
  ].map(({ artist, locale, name }) => [`${artist}:${locale}`, name]),
);

export async function seedUnpublishedArtistSearchFixture(client, idol, editor) {
  const revisionId = id(),
    translationId = id();
  const query = "未公開サーチ証拠";
  const fields = {
    displayName: query,
    shortBio: "Private fixture draft.",
    fullBio: "A draft which must not enter the public search index results.",
    seoTitle: "Private draft",
    seoDescription: "Unpublished search fixture.",
  };
  const contentHash = computeIdolTranslationContentHash(fields);
  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO public.idol_revisions(id,idol_id,revision,lifecycle,theme_accent,hero_text_tone,display_order,created_by,created_at) SELECT $1,idol_id,revision+1,'DRAFT',theme_accent,hero_text_tone,display_order,$3,created_at FROM public.idol_revisions WHERE id=$2",
      [revisionId, idol.revisionId, editor],
    );
    await insert(client, "idol_revision_translations", {
      id: translationId,
      idol_revision_id: revisionId,
      locale: "ja",
      source_hash: contentHash,
      translated_from_source_hash: contentHash,
      origin: "HUMAN",
      editor_id: editor,
      edited_at: editedAt,
      display_name: fields.displayName,
      short_bio: fields.shortBio,
      full_bio: fields.fullBio,
      seo_title: fields.seoTitle,
      seo_description: fields.seoDescription,
    });
    await insert(client, "idol_translation_reviews", {
      id: id(),
      idol_translation_id: translationId,
      sequence: 1,
      status: "DRAFT",
      created_at: editedAt,
    });
    await insert(client, "idol_translation_search_projections", {
      idol_translation_id: translationId,
      source_hash: contentHash,
      algorithm_version: 1,
      normalized_name: normalizeArtistSearchName(query),
    });
    await client.query(
      "UPDATE public.idols SET draft_revision_id=$2,version=version+1 WHERE id=$1",
      [idol.id, revisionId],
    );
    await client.query("COMMIT");
    return { query, revisionId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function seedIdol(client, editor, reviewer, media, index) {
  const idolId = id(),
    revisionId = id();
  const name =
    localizedArtistNames.get(`${index}:en`) ??
    specialNames.get(index) ??
    `Performer ${String(index + 1).padStart(3, "0")}`;
  await insert(client, "idols", {
    id: idolId,
    handle: `performer-${index + 1}`,
    status: "draft",
    accepting_gifts: false,
    created_at: createdAt,
    updated_at: createdAt,
  });
  await insert(client, "idol_revisions", {
    id: revisionId,
    idol_id: idolId,
    revision: 1,
    lifecycle: "DRAFT",
    theme_accent: "#BFA46D",
    hero_text_tone: "light",
    display_order: index,
    created_by: editor,
    created_at: createdAt,
  });
  await client.query(
    "UPDATE public.idols SET draft_revision_id=$2 WHERE id=$1",
    [idolId, revisionId],
  );
  const english = {
    displayName: name,
    shortBio: "Fictional performer for integration tests.",
    fullBio:
      "A fictional performer created for deterministic local catalog testing.",
    seoTitle: `Performer ${index + 1}`,
    seoDescription: "Fictional performer catalog fixture.",
  };
  const englishHash = computeIdolTranslationContentHash(english);
  for (const locale of SUPPORTED_LOCALES) {
    const content = {
      ...english,
      displayName: localizedArtistNames.get(`${index}:${locale}`) ?? name,
      shortBio: `${locale}: ${english.shortBio}`,
    };
    if (locale === "en") content.shortBio = english.shortBio;
    const contentHash = computeIdolTranslationContentHash(content);
    const translationId = await translation(
      client,
      {
        table: "idol_revision_translations",
        parent: "idol_revision_id",
        parentId: revisionId,
        reviews: "idol_translation_reviews",
        reviewParent: "idol_translation_id",
      },
      {
        locale,
        contentHash,
        englishHash,
        columns: {
          display_name: content.displayName,
          short_bio: content.shortBio,
          full_bio: content.fullBio,
          seo_title: content.seoTitle,
          seo_description: content.seoDescription,
        },
      },
      editor,
      reviewer,
    );
    await insert(client, "idol_translation_search_projections", {
      idol_translation_id: translationId,
      source_hash: contentHash,
      algorithm_version: 1,
      normalized_name: normalizeArtistSearchName(content.displayName),
    });
  }
  for (const [position, role] of [
    "PORTRAIT",
    "HERO_DESKTOP",
    "HERO_MOBILE",
  ].entries())
    await insert(client, "idol_revision_media", {
      idol_revision_id: revisionId,
      role,
      media_asset_id: media[position].assetId,
      media_metadata_revision_id: media[position].revisionId,
      sort_order: 0,
    });
  const publicationId = await publish(client, {
    kind: "IDOL",
    entityId: idolId,
    revisionId,
    editor,
    revisionTable: "idol_revisions",
    headTable: "idol_publication_heads",
    ownerColumn: "idol_id",
    revisionColumn: "idol_revision_id",
    baseTable: "idols",
  });
  await client.query(
    "UPDATE public.idols SET accepting_gifts=true,version=version+1 WHERE id=$1",
    [idolId],
  );
  return {
    id: idolId,
    revisionId,
    publicationId,
    name,
    names: Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [
        locale,
        localizedArtistNames.get(`${index}:${locale}`) ?? name,
      ]),
    ),
  };
}

async function seedGift(
  client,
  editor,
  reviewer,
  media,
  idols,
  locationId,
  index,
) {
  const giftId = id(),
    revisionId = id(),
    variants = [];
  await insert(client, "gifts", {
    id: giftId,
    handle: `gift-${index + 1}`,
    status: "draft",
    created_at: createdAt,
    updated_at: createdAt,
  });
  await insert(client, "gift_revisions", {
    id: revisionId,
    gift_id: giftId,
    revision: 1,
    lifecycle: "DRAFT",
    category: index % 2 === 0 ? "FLOWERS" : "OTHER",
    delivery_minimum: 1,
    delivery_maximum: 3,
    delivery_unit: "DAY",
    requires_safety_notice: false,
    created_by: editor,
    created_at: createdAt,
  });
  await client.query(
    "UPDATE public.gifts SET draft_revision_id=$2 WHERE id=$1",
    [giftId, revisionId],
  );
  await insert(client, "gift_revision_contents", {
    gift_revision_id: revisionId,
    component_code: "TEST_GIFT",
    quantity: 1,
    unit: "ITEM",
  });
  for (let position = 0; position < 2; position++) {
    const variantId = id(),
      inventoryItemId = id(),
      sku = `CATALOG-${index + 1}-${position + 1}`;
    const policy =
      index === 2 ? "PREORDER" : index === 3 ? "PROCURE_ON_DEMAND" : "TRACKED";
    await insert(client, "gift_variants", {
      id: variantId,
      gift_id: giftId,
      sku,
      status: "active",
      inventory_policy: policy,
      created_at: createdAt,
      updated_at: createdAt,
    });
    await insert(client, "gift_variant_idol_eligibility", {
      gift_variant_id: variantId,
      idol_id: idols[position].id,
      created_at: createdAt,
    });
    if (policy === "TRACKED") {
      await insert(client, "inventory_items", {
        id: inventoryItemId,
        gift_variant_id: variantId,
        sku,
        policy,
        status: "ACTIVE",
        created_at: createdAt,
      });
      const onHand = index === 0 ? 0 : 10;
      await insert(client, "inventory_balances", {
        inventory_item_id: inventoryItemId,
        location_id: locationId,
        on_hand: onHand,
        reserved: 0,
        version: 1,
        updated_at: createdAt,
      });
      await insert(client, "inventory_ledger", {
        id: id(),
        inventory_item_id: inventoryItemId,
        location_id: locationId,
        balance_version_before: 0,
        balance_version_after: 1,
        delta_on_hand: onHand,
        delta_reserved: 0,
        reason_code: "INITIALIZE",
        source_type: "ADJUSTMENT",
        source_id: id(),
        idempotency_key: `catalog-initialize:${inventoryItemId}`,
        actor_kind: "SYSTEM",
        task_name: "catalog-directory-fixture",
        occurred_at: createdAt,
      });
    }
    variants.push({ id: variantId, inventoryItemId, sku, policy, position });
  }
  const english = {
    title: `Fictional gift ${index + 1}`,
    shortDescription: "Fictional gift for local tests.",
    description: "A fictional gift used for deterministic integration testing.",
    fulfillmentDescription: "Prepared for the selected fictional performer.",
    seoTitle: `Fictional gift ${index + 1}`,
    seoDescription: "Fictional gift catalog fixture.",
    variantLabels: variants.map((variant) => ({
      giftVariantId: variant.id,
      label: `Option ${variant.position + 1}`,
    })),
  };
  const englishHash = computeGiftTranslationContentHash(english);
  for (const locale of SUPPORTED_LOCALES) {
    const content = {
      ...english,
      shortDescription: `${locale}: ${english.shortDescription}`,
    };
    if (locale === "en") content.shortDescription = english.shortDescription;
    const translationId = await translation(
      client,
      {
        table: "gift_revision_translations",
        parent: "gift_revision_id",
        parentId: revisionId,
        reviews: "gift_translation_reviews",
        reviewParent: "gift_translation_id",
      },
      {
        locale,
        contentHash: computeGiftTranslationContentHash(content),
        englishHash,
        columns: {
          title: content.title,
          short_description: content.shortDescription,
          description: content.description,
          fulfillment_description: content.fulfillmentDescription,
          seo_title: content.seoTitle,
          seo_description: content.seoDescription,
        },
      },
      editor,
      reviewer,
    );
    for (const label of content.variantLabels)
      await insert(client, "gift_variant_labels", {
        gift_translation_id: translationId,
        gift_variant_id: label.giftVariantId,
        label: label.label,
      });
  }
  await insert(client, "gift_revision_media", {
    gift_revision_id: revisionId,
    role: "PRIMARY",
    media_asset_id: media.assetId,
    media_metadata_revision_id: media.revisionId,
    sort_order: 0,
  });
  const publicationId = await publish(client, {
    kind: "GIFT",
    entityId: giftId,
    revisionId,
    editor,
    revisionTable: "gift_revisions",
    headTable: "gift_publication_heads",
    ownerColumn: "gift_id",
    revisionColumn: "gift_revision_id",
    baseTable: "gifts",
  });
  return { id: giftId, revisionId, publicationId, variants };
}

async function seedPrices(
  client,
  editor,
  gifts,
  market,
  currency,
  multiplier,
  priceValidFrom = createdAt,
) {
  const marketId = id(),
    bookId = id(),
    publicationId = id(),
    auditId = id(),
    requestId = id(),
    correlationId = id();
  await insert(client, "markets", {
    id: marketId,
    market,
    default_currency: currency,
    status: "ACTIVE",
    created_at: createdAt,
    updated_at: createdAt,
  });
  await insert(client, "price_books", {
    id: bookId,
    market_id: marketId,
    market,
    currency,
    revision: 1,
    lifecycle: "DRAFT",
    valid_from: createdAt,
    created_by: editor,
    created_at: createdAt,
  });
  const priceIds = [];
  for (const [index, gift] of gifts.entries())
    for (const variant of gift.variants) {
      const priceId = id();
      // Paired gifts have equal prices to exercise the UUID tiebreaker.
      const amount =
        (1000 + Math.floor(index / 2) * 100 + variant.position * 10000) *
        multiplier;
      await insert(client, "prices", {
        id: priceId,
        price_book_id: bookId,
        price_book_revision: 1,
        market,
        currency,
        gift_variant_id: variant.id,
        revision: 1,
        amount_minor: amount,
        valid_from: priceValidFrom,
        status: "DRAFT",
        created_at: createdAt,
      });
      priceIds.push(priceId);
    }
  await client.query(
    "UPDATE public.price_books SET lifecycle='VALIDATED',validated_at=$2 WHERE id=$1",
    [bookId, reviewedAt],
  );
  await client.query(
    "UPDATE public.price_books SET lifecycle='PUBLISHED',published_at=$2 WHERE id=$1",
    [bookId, publishedAt],
  );
  await client.query(
    "UPDATE public.prices SET status='PUBLISHED' WHERE price_book_id=$1",
    [bookId],
  );
  await insert(client, "audit_logs", {
    id: auditId,
    actor_type: "ADMIN",
    actor_id: editor,
    action: "PRICE_BOOK_PUBLISH",
    subject_type: "PRICE_BOOK_PUBLICATION",
    subject_id: publicationId,
    reason_code: "TEST_FIXTURE",
    request_id: requestId,
    correlation_id: correlationId,
    outcome: "SUCCEEDED",
    created_at: publishedAt,
  });
  await insert(client, "price_book_publications", {
    id: publicationId,
    price_book_id: bookId,
    price_book_revision: 1,
    market_id: marketId,
    market,
    currency,
    action: "PUBLISH",
    manifest_hash: hash(bookId),
    published_by: editor,
    audit_log_id: auditId,
    published_at: publishedAt,
    idempotency_key: `catalog-price-publication:${publicationId}`,
  });
  await insert(client, "price_book_publication_heads", {
    id: id(),
    market_id: marketId,
    market,
    currency,
    publication_id: publicationId,
    price_book_id: bookId,
    price_book_revision: 1,
    created_at: publishedAt,
    updated_at: publishedAt,
  });
  await insert(client, "outbox_events", {
    id: id(),
    event_type: "PRICE_BOOK_PUBLISHED",
    aggregate_type: "PRICE_BOOK",
    aggregate_id: bookId,
    aggregate_version: 1,
    primary_subject_id: publicationId,
    secondary_subject_id: bookId,
    market,
    currency,
    idempotency_key: `price-book-publication:${publicationId}`,
    request_id: requestId,
    correlation_id: correlationId,
    occurred_at: publishedAt,
    available_at: publishedAt,
    created_at: publishedAt,
  });
  return { marketId, bookId, publicationId, priceIds };
}

export async function seedTemporalCatalogPrices(
  client,
  editor,
  gift,
  activationDelaySeconds = 2,
) {
  await client.query("BEGIN");
  try {
    const result = await client.query(
      "SELECT (transaction_timestamp() + $1::integer * interval '1 second')::text AS effective_at",
      [activationDelaySeconds],
    );
    const effectiveAt = result.rows[0].effective_at;
    const prices = await seedPrices(
      client,
      editor,
      [gift],
      "CATALOG_TIME",
      "USD",
      1,
      effectiveAt,
    );
    await client.query("COMMIT");
    return { ...prices, effectiveAt };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** Real transactions and all production triggers remain enabled throughout seeding. */
export async function seedCatalogDirectoryFixtures(client, count = 120) {
  sequence = 1;
  await client.query("BEGIN");
  try {
    const editor = id(),
      reviewer = id();
    for (const [index, adminId] of [editor, reviewer].entries())
      await insert(client, "admin_identities", {
        id: adminId,
        issuer: "catalog-fixture",
        external_subject_hash: Buffer.from(hash(`admin:${index}`), "hex"),
        status: "ACTIVE",
        mfa_required: true,
        created_at: createdAt,
        updated_at: createdAt,
      });
    const media = [];
    for (const [index, [width, height]] of [
      [1600, 2000],
      [2400, 1350],
      [1080, 1350],
      [1200, 1200],
    ].entries())
      media.push(
        await seedMedia(client, editor, reviewer, index, width, height),
      );
    const idols = [];
    for (let index = 0; index < count; index++)
      idols.push(await seedIdol(client, editor, reviewer, media, index));
    const locationId = id();
    await insert(client, "inventory_locations", {
      id: locationId,
      location_key: "CATALOG_TEST",
      status: "ACTIVE",
      created_at: createdAt,
    });
    const gifts = [];
    for (let index = 0; index < count; index++)
      gifts.push(
        await seedGift(
          client,
          editor,
          reviewer,
          media[3],
          idols,
          locationId,
          index,
        ),
      );
    const prices = await seedPrices(client, editor, gifts, "CATALOG", "USD", 1);
    const otherPrices = await seedPrices(
      client,
      editor,
      gifts,
      "CATALOG_OTHER",
      "JPY",
      3,
    );
    await client.query("COMMIT");
    return {
      idols,
      gifts,
      editor,
      reviewer,
      media,
      locationId,
      prices,
      otherPrices,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
