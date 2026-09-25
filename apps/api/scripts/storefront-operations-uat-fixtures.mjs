import { randomUUID } from "node:crypto";
import { operationsMaterials } from "./storefront-operations-uat-materials.mjs";

/** Baselines and reusable resources only; measured edits/create/import/publish stay human actions. */
export async function prepareOperationsMaterials({
  fixtures,
  request,
  publish,
  createMediaAsset,
  check,
}) {
  const gifts = await request("/api/v1/admin/catalog/owners/list", {
    schemaVersion: 1,
    kind: "GIFT",
    locale: "en",
    page: 1,
    pageSize: 10,
  });
  check(
    gifts.totalItems === 0 && gifts.items.length === 0,
    "UAT starts with no pre-created measured gift",
  );
  const current = await request("/api/v1/admin/content-authoring/read", {
    schemaVersion: 1,
    target: fixtures.idol.owner,
    revisionId: fixtures.idol.revisionId,
  });
  const home = await request("/api/v1/admin/content-authoring/read", {
    schemaVersion: 1,
    target: fixtures.homepage.owner,
    revisionId: fixtures.homepage.revisionId,
  });
  // Establish the unchanged old home. No replacement media is attached before the human starts.
  const baseline = await publish(
    fixtures.homepage.owner,
    fixtures.homepage.revisionId,
  );
  const media = {};
  for (const [name, width, height, hue, role] of [
    ["UAT replacement desktop", 2400, 1350, 150, "HERO_DESKTOP"],
    ["UAT replacement mobile", 1080, 1350, 40, "HERO_MOBILE"],
    ["UAT replacement portrait", 1600, 2000, 345, "PORTRAIT"],
    ["UAT gift primary", 1600, 1600, 180, "GIFT_PRIMARY"],
  ]) {
    const resource = await createMediaAsset(name, width, height, hue, role);
    check(
      !fixtures.media.some((old) => old.assetId === resource.assetId),
      "replacement resources differ from original published images",
    );
    media[role] = { label: name, ...resource };
  }
  const context = await request(
    "/api/v1/admin/gift-commerce/context/read",
    { schemaVersion: 1 },
    { actor: "manager" },
  );
  const market = context.markets.find(
    (item) => item.market === "GLOBAL" && item.currencies.includes("USD"),
  );
  check(
    Boolean(market),
    "task price scope is present in actual TEST PostgreSQL configuration",
  );
  const suffix = randomUUID().slice(0, 8);
  return {
    ...operationsMaterials(),
    preparedAt: new Date().toISOString(),
    baseline: {
      homepage: {
        ...fixtures.homepage,
        contentHash: home.snapshot.contentHash,
        publicationId: baseline.publicationId,
      },
      idol: {
        ...fixtures.idol,
        label: "Luna Mira",
        handle: "luna-mira",
        contentHash: current.snapshot.contentHash,
      },
      originalMedia: fixtures.media,
    },
    replacementMedia: media,
    measuredGift: {
      existsBeforeStart: false,
      handle: `uat-studio-gift-${suffix}`,
      type: "PHYSICAL",
      category: "OTHER",
      contents: [{ componentCode: "ITEM", quantity: 1, unit: "ITEM" }],
      deliveryEstimate: { minimum: 1, maximum: 7, unit: "DAY" },
      shippingMode: "internal_to_idol",
      requiresSafetyNotice: false,
      inventoryPolicy: "PROCURE_ON_DEMAND",
      sku: `UAT-STUDIO-${suffix.toUpperCase()}`,
      eligibleIdolId: fixtures.idol.owner.idolId,
      eligibleIdolLabel: "Luna Mira",
      market: market.market,
      currency: "USD",
      amountInUi: "10.00",
      validFrom:
        "Choose a time at or before now in the Admin local datetime field; leave validUntil empty.",
      variantLabelSource:
        "texts.<locale>.variantLabel; use the new real variant ID from Admin export, never invent an ID.",
    },
  };
}
