import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  contentAuthoringContentSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import { workspaceTranslations } from "./admin-workspace-fixtures.mjs";
import { giftStorefrontCopy as copy } from "./gift-storefront-copy.mjs";

export const giftStorefrontMarkets = [
  { market: "GLOBAL", currency: "USD" },
  { market: "JAPAN", currency: "JPY" },
];
const prefix = "/api/v1/admin/gift-commerce/";

async function seedArtists({ workspaceRoot, content, publishMedia, progress }) {
  const families = [];
  for (const [name, desktop, mobile] of [
    [
      "Mira Vale",
      "ui-composites/fictional-performer-hero-desktop.png",
      "ui-composites/fictional-performer-hero-mobile.png",
    ],
    [
      "Kai Ren",
      "ui-brand/performer-daylight-desktop.webp",
      "ui-brand/performer-daylight-mobile.webp",
    ],
  ]) {
    progress(`processing original fictional ${name} independent media`);
    const file = (value) =>
      path.join(workspaceRoot, "apps/storefront/public", value);
    families.push({
      name,
      portrait: await publishMedia(
        file(mobile),
        "PORTRAIT",
        `${name} portrait`,
      ),
      desktop: await publishMedia(
        file(desktop),
        "HERO_DESKTOP",
        `${name} independent desktop`,
      ),
      mobile: await publishMedia(
        file(mobile),
        "HERO_MOBILE",
        `${name} independent mobile`,
      ),
    });
  }
  const artists = [];
  for (let index = 0; index < 3; index++) {
    const family = families[index % 2];
    const name = index === 2 ? "Studio Guest" : family.name;
    const handle = ["mira-vale", "kai-ren", "studio-guest"][index];
    const created = await content.write("/api/v1/admin/catalog/idols/create", {
      handle,
      expectedBaseVersion: 0,
    });
    const owner = { kind: "IDOL", idolId: created.idolId };
    const revisionId = await content.author(owner, {
      kind: "IDOL",
      structure: {
        themeAccent: "#CCAE7F",
        heroTextTone: "light",
        displayOrder: index,
      },
      media: [
        ["PORTRAIT", family.portrait],
        ["HERO_DESKTOP", family.desktop],
        ["HERO_MOBILE", family.mobile],
      ].map(([role, image], sortOrder) => ({
        role,
        mediaAssetId: image.assetId,
        mediaMetadataRevisionId: image.revisionId,
        sortOrder,
      })),
      translations: workspaceTranslations((locale) => ({
        displayName: name,
        shortBio: copy[locale].bio,
        fullBio: `<p>${copy[locale].story}</p>`,
        seoTitle: name,
        seoDescription: copy[locale].bio,
      })),
    });
    await content.approve(owner, revisionId);
    // Keep the real future effective time, then leave a clear TEST-only margin before publication.
    await content.publish(owner, revisionId);
    const current = await content.request("/api/v1/admin/catalog/owners/read", {
      target: owner,
      locale: "en",
    });
    await content.write("/api/v1/admin/catalog/idols/status", {
      idolId: created.idolId,
      status: "active",
      acceptingGifts: true,
      expectedBaseVersion: current.owner.baseVersion,
    });
    artists.push({
      id: created.idolId,
      owner,
      revisionId,
      handle,
      name,
      acceptingGifts: true,
    });
  }
  return artists;
}

function details(image) {
  return {
    blocks: [
      { id: "introduction", kind: "HEADING", level: 2 },
      { id: "care", kind: "PARAGRAPH" },
      {
        id: "steps",
        kind: "LIST",
        style: "ORDERED",
        itemIds: ["prepare", "deliver"],
      },
      {
        id: "specifications",
        kind: "SPECIFICATIONS",
        itemIds: ["material", "recipient"],
      },
      {
        id: "artwork",
        kind: "MEDIA",
        mediaAssetId: image.assetId,
        mediaMetadataRevisionId: image.revisionId,
        captionEnabled: true,
      },
    ],
    translations: SUPPORTED_LOCALES.map((locale) => ({
      locale,
      origin: "HUMAN",
      blocks: [
        {
          blockId: "introduction",
          kind: "HEADING",
          text: copy[locale].heading,
        },
        { blockId: "care", kind: "PARAGRAPH", text: copy[locale].care },
        {
          blockId: "steps",
          kind: "LIST",
          items: [
            { itemId: "prepare", text: copy[locale].materialValue },
            { itemId: "deliver", text: copy[locale].recipientValue },
          ],
        },
        {
          blockId: "specifications",
          kind: "SPECIFICATIONS",
          items: [
            {
              itemId: "material",
              label: copy[locale].material,
              value: copy[locale].materialValue,
            },
            {
              itemId: "recipient",
              label: copy[locale].recipient,
              value: copy[locale].recipientValue,
            },
          ],
        },
        {
          blockId: "artwork",
          kind: "MEDIA",
          mediaMetadataRevisionId: image.revisionId,
          caption: copy[locale].caption,
        },
      ],
    })),
  };
}

function variantPlans(index, artists) {
  const both = artists.slice(0, 2).map((artist) => artist.id);
  if (index === 0)
    return [
      {
        policy: "PROCURE_ON_DEMAND",
        eligible: both,
        quantity: null,
        amounts: [1500, 15000],
      },
      {
        policy: "TRACKED",
        eligible: [artists[0].id],
        quantity: 5,
        amounts: [1200, 12000],
      },
      {
        policy: "PREORDER",
        eligible: both,
        quantity: null,
        amounts: [1800, 18000],
      },
    ];
  const policy = [1, 2, 6].includes(index)
    ? "TRACKED"
    : index === 3
      ? "PREORDER"
      : "PROCURE_ON_DEMAND";
  const quantity = index === 1 ? 1 : index === 2 ? 0 : index === 6 ? 18 : null;
  const eligible =
    index === 4
      ? [artists[0].id]
      : index === 5
        ? [artists[1].id]
        : index === 7
          ? [artists[2].id]
          : both;
  return [
    {
      policy,
      eligible,
      quantity,
      amounts: [((index % 6) + 1) * 500, (6 - (index % 6)) * 1000],
    },
  ];
}

async function seedGifts({
  workspaceRoot,
  content,
  publishMedia,
  client,
  artists,
  check,
  progress,
}) {
  const media = [];
  for (const [name, file] of [
    ["Rose Palace", "gift-rose-palace.webp"],
    ["Blue Orbit", "gift-blue-orbit.webp"],
    ["Ruby Bouquet", "gift-ruby-bouquet.webp"],
  ]) {
    progress(`processing original fictional ${name} gift artwork`);
    media.push({
      name,
      ...(await publishMedia(
        path.join(workspaceRoot, "apps/storefront/public/ui-brand", file),
        "GIFT_PRIMARY",
        name,
      )),
    });
  }
  const gifts = [];
  const read = async (giftId) =>
    (await content.request(prefix + "gifts/read", { giftId, locale: "en" }))
      .value;
  for (let index = 0; index < 27; index++) {
    progress(`authoring real gift ${index + 1}/27`);
    const handle = `studio-gift-${String(index + 1).padStart(3, "0")}`;
    const created = await content.write(prefix + "gifts/create", {
      handle,
      expectedBaseVersion: 0,
    });
    const owner = { kind: "GIFT", giftId: created.giftId };
    const item = {
      id: created.giftId,
      owner,
      handle,
      index,
      status: index === 26 ? "draft" : "active",
      variants: [],
    };
    gifts.push(item);
    if (index === 26) continue;
    for (const [ordinal, plan] of variantPlans(index, artists).entries()) {
      const current = await read(item.id);
      const variant = await content.write(prefix + "variants/save", {
        giftId: item.id,
        giftVariantId: null,
        expectedBaseVersion: current.gift.version,
        expectedVariantVersion: 0,
        sku: `GIFT-STOREFRONT-TEST-${index + 1}-${ordinal + 1}`,
        status: "draft",
        inventoryPolicy: plan.policy,
        eligibleIdolIds: plan.eligible,
      });
      item.variants.push({ id: variant.giftVariantId, ...plan });
    }
    const image = media[index % media.length];
    const name = `${image.name} ${String(index + 1).padStart(2, "0")}`;
    const category = ["FLOWERS", "ACCESSORY", "OTHER"][index % 3];
    const giftKind = ["VIRTUAL", "PHYSICAL", "WISH", "MERCHANDISE", "OTHER"][
      index % 5
    ];
    const value = contentAuthoringContentSchema.parse({
      kind: "GIFT",
      structure: {
        category,
        contents: [{ componentCode: "STUDIO_GIFT", quantity: 1, unit: "ITEM" }],
        deliveryEstimate: { minimum: 3, maximum: 14, unit: "DAY" },
        requiresSafetyNotice: false,
        shippingMode: "internal_to_idol",
      },
      media: [
        {
          role: "PRIMARY",
          mediaAssetId: image.assetId,
          mediaMetadataRevisionId: image.revisionId,
          sortOrder: 0,
        },
      ],
      translations: workspaceTranslations((locale) => ({
        title: name,
        subtitle: copy[locale].subtitle,
        shortDescription: copy[locale].subtitle,
        description: copy[locale].care,
        fulfillmentDescription: copy[locale].care,
        variantLabels: item.variants.map((variant) => ({
          giftVariantId: variant.id,
          label:
            variant.policy === "TRACKED"
              ? copy[locale].limited
              : variant.policy === "PREORDER"
                ? copy[locale].preorder
                : copy[locale].edition,
        })),
        seoTitle: name,
        seoDescription: copy[locale].subtitle,
      })),
      ...(index === 0 ? { details: details(image) } : {}),
    });
    let current = await read(item.id);
    const saved = await content.write(prefix + "content/save", {
      expectedBaseVersion: current.gift.version,
      giftKind,
      authoring: {
        schemaVersion: 1,
        action: "CREATE",
        target: owner,
        expectedVersion: 0,
        content: value,
      },
    });
    Object.assign(item, {
      revisionId: saved.giftRevisionId,
      giftKind,
      category,
      name,
      image,
      hasDetails: index === 0,
    });
    for (const variant of item.variants) {
      current = await read(item.id);
      const existing = current.variants.find(
        (candidate) => candidate.id === variant.id,
      );
      await content.write(prefix + "variants/save", {
        giftId: item.id,
        giftVariantId: variant.id,
        expectedBaseVersion: current.gift.version,
        expectedVariantVersion: existing.version,
        sku: existing.sku,
        status: "active",
        inventoryPolicy: existing.inventoryPolicy,
        eligibleIdolIds: existing.eligibleIdolIds,
      });
    }
  }
  progress("reading actual PostgreSQL price activation time");
  const at = (
    await client.query(
      "SELECT to_char((clock_timestamp()-interval '1 minute') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at",
    )
  ).rows[0].at;
  const books = [];
  for (const [index, scope] of giftStorefrontMarkets.entries()) {
    progress(`creating complete TEST price book ${index + 1}/2`);
    const book = await content.write(
      prefix + "prices/create",
      {
        ...scope,
        expectedBookRevision: 0,
        expectedHeadVersion: 0,
        source: null,
        validFrom: at,
        validUntil: null,
        changes: gifts.flatMap((gift) =>
          gift.variants.map((variant) => ({
            giftVariantId: variant.id,
            unitAmountMinor: variant.amounts[index],
          })),
        ),
      },
      "manager",
    );
    progress(`publishing complete TEST price book ${index + 1}/2`);
    const published = await content.write(
      prefix + "prices/publish",
      {
        ...scope,
        priceBookId: book.priceBookId,
        revision: book.revision,
        expectedHeadVersion: 0,
        expectedContentHash: book.contentHash,
      },
      "manager",
    );
    books.push({ ...scope, ...book, headVersion: published.headVersion });
  }
  progress("creating actual inventory location");
  const location = await content.write(
    prefix + "inventory/locations/create",
    { code: "GIFT_STOREFRONT_TEST", expectedVersion: 0 },
    "manager",
  );
  for (const gift of gifts) {
    if (!gift.revisionId) continue;
    progress(`stock, review and publication for gift ${gift.index + 1}/26`);
    const current = await read(gift.id);
    for (const variant of gift.variants) {
      const canonical = current.variants.find(
        (value) => value.id === variant.id,
      );
      check(
        variant.policy === "TRACKED" || canonical.inventoryItemId === null,
        "nontracked variants have no fabricated inventory identities",
      );
      if (variant.policy !== "TRACKED") continue;
      const adjustment = {
        giftVariantId: variant.id,
        inventoryLocationId: location.inventoryLocationId,
        expectedVariantVersion: canonical.version,
      };
      const added = await content.write(
        prefix + "inventory/adjust",
        {
          ...adjustment,
          expectedBalanceVersion: 0,
          deltaOnHand: Math.max(1, variant.quantity),
        },
        "manager",
      );
      const balance =
        variant.quantity === 0
          ? await content.write(
              prefix + "inventory/adjust",
              {
                ...adjustment,
                expectedBalanceVersion: added.balanceVersion,
                deltaOnHand: -1,
              },
              "manager",
            )
          : added;
      variant.balanceVersion = balance.balanceVersion;
      const stocked = (await read(gift.id)).variants.find(
        (value) => value.id === variant.id,
      );
      check(
        stocked.inventoryItemId !== null,
        "normal first adjustment creates the tracked inventory identity",
      );
      variant.inventoryItemId = stocked.inventoryItemId;
    }
    await content.approve(gift.owner, gift.revisionId);
    if (gift.hasDetails)
      await content.approveExtension({
        schemaVersion: 1,
        kind: "GIFT_DETAILS",
        giftRevisionId: gift.revisionId,
      });
    const published = await content.publish(gift.owner, gift.revisionId);
    gift.publicationId = published.publicationId;
  }
  progress(
    "proving tracked availability is one location's maximum, never a sum",
  );
  const secondLocation = await content.write(
    prefix + "inventory/locations/create",
    { code: "GIFT_STOREFRONT_SECOND_TEST", expectedVersion: 0 },
    "manager",
  );
  const trackedFirst = gifts[0].variants[1];
  const trackedCurrent = (await read(gifts[0].id)).variants.find(
    (value) => value.id === trackedFirst.id,
  );
  await content.write(
    prefix + "inventory/adjust",
    {
      giftVariantId: trackedFirst.id,
      inventoryLocationId: secondLocation.inventoryLocationId,
      expectedVariantVersion: trackedCurrent.version,
      expectedBalanceVersion: 0,
      deltaOnHand: 3,
    },
    "manager",
  );
  for (const [index, status] of [
    [24, "paused"],
    [25, "archived"],
  ]) {
    const gift = gifts[index],
      current = await read(gift.id);
    await content.write(
      prefix + "gifts/status",
      { giftId: gift.id, expectedBaseVersion: current.gift.version, status },
      "manager",
    );
    gift.status = status;
  }
  return {
    gifts,
    books,
    locationId: location.inventoryLocationId,
    secondLocationId: secondLocation.inventoryLocationId,
  };
}

async function seedPolicies({ content, client, progress }) {
  const policies = [];
  for (const [index, kind] of [
    "TERMS",
    "PRIVACY",
    "REFUND",
    "DELIVERY",
  ].entries()) {
    const policyKey = kind.toLowerCase(),
      owner = { kind: "POLICY", policyKey };
    progress(`publishing actual TEST ${policyKey} policy`);
    await content.write("/api/v1/admin/resources/policies/register", {
      policyKey,
      kind,
      expectedVersion: 0,
    });
    const effectiveAt = (
      await client.query(
        "SELECT to_char((clock_timestamp()+interval '2 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at",
      )
    ).rows[0].at;
    const revisionId = await content.author(owner, {
      kind: "POLICY",
      structure: { kind, effectiveAt },
      translations: workspaceTranslations((locale) => ({
        title: copy[locale].policyTitles[index],
        summary: copy[locale].subtitle,
        body: `<p>${copy[locale].care}</p>`,
      })),
    });
    await content.approve(owner, revisionId);
    const deadline = globalThis.performance.now() + 10000;
    while (
      !(
        await client.query(
          "SELECT clock_timestamp()>=$1::timestamptz+interval '1 second' AS ready",
          [effectiveAt],
        )
      ).rows[0].ready
    ) {
      if (globalThis.performance.now() >= deadline)
        throw new Error("Policy effective-time wait exceeded fixture deadline");
      await delay(100);
    }
    const published = await content.publish(owner, revisionId);
    policies.push({
      policyKey,
      kind,
      owner,
      revisionId,
      publicationId: published.publicationId,
    });
  }
  return policies;
}

export async function seedGiftStorefront(input) {
  const artists = await seedArtists(input);
  const commerce = await seedGifts({ ...input, artists });
  const paused = artists[2];
  const current = await input.content.request(
    "/api/v1/admin/catalog/owners/read",
    { target: paused.owner, locale: "en" },
  );
  await input.content.write("/api/v1/admin/catalog/idols/status", {
    idolId: paused.id,
    status: "paused",
    acceptingGifts: false,
    expectedBaseVersion: current.owner.baseVersion,
  });
  paused.acceptingGifts = false;
  const policies = await seedPolicies(input);
  return { artists, ...commerce, policies, markets: giftStorefrontMarkets };
}
