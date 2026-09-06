import {
  CATALOG_DISCOVERY_LIMITS,
  artistSearchProjectionInputSchema,
  catalogPageInfoSchema,
  catalogPageRequestSchema,
  changeGiftDiscoveryQuerySchema,
  giftDiscoveryPlanSchema,
  giftDiscoveryQuerySchema,
  idolDiscoveryPlanSchema,
  idolDiscoveryQuerySchema,
} from "@fan-support/contracts";
import type {
  CatalogPageInfo,
  GiftDiscoveryPlan,
  GiftDiscoveryQuery,
  IdolDiscoveryPlan,
} from "@fan-support/contracts";

/** Plans are executed by the repository, before loading images or full content. */
export function createGiftDiscoveryPlan(input: unknown): GiftDiscoveryPlan {
  const query = giftDiscoveryQuerySchema.parse(input);
  let primaryOrder: GiftDiscoveryPlan["orderBy"][number];
  switch (query.sort) {
    case "RECOMMENDED":
      primaryOrder = { field: "PUBLISHED_AT", direction: "DESC" };
      break;
    case "PRICE_ASC":
      primaryOrder = { field: "PRICE_MINOR", direction: "ASC", nulls: "LAST" };
      break;
    case "PRICE_DESC":
      primaryOrder = { field: "PRICE_MINOR", direction: "DESC", nulls: "LAST" };
      break;
  }
  return giftDiscoveryPlanSchema.parse({
    schemaVersion: 1,
    query,
    offset: (query.page - 1) * query.pageSize,
    take: query.pageSize,
    orderBy: [primaryOrder, { field: "ID", direction: "ASC" }],
  });
}

export function normalizeArtistSearchName(input: unknown): string {
  const value = artistSearchProjectionInputSchema.parse(input);
  // Fold ASCII width/case only; broad compatibility decomposition also changes
  // Thai vowel sequences. Keep the published name and its marks untouched.
  return value
    .normalize("NFC")
    .replace(/[\uFF01-\uFF5E]/gu, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0),
    )
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

export function createIdolDiscoveryPlan(input: unknown): IdolDiscoveryPlan {
  const query = idolDiscoveryQuerySchema.parse(input);
  const searchTerm =
    query.q === undefined ? undefined : normalizeArtistSearchName(query.q);
  return idolDiscoveryPlanSchema.parse({
    schemaVersion: 1,
    query,
    ...(searchTerm === undefined ? {} : { searchTerm }),
    matchPriority: ["EXACT", "PREFIX", "CONTAINS"],
    orderBy: [
      ...(searchTerm === undefined
        ? []
        : [{ field: "MATCH_RANK", direction: "ASC" }]),
      { field: "DISPLAY_ORDER", direction: "ASC" },
      { field: "ID", direction: "ASC" },
    ],
    take: query.limit + 1,
  });
}

/** A presentation change cannot supply a different market or currency. */
export function changeGiftDiscoveryQuery(input: unknown): GiftDiscoveryQuery {
  const { query, changes } = changeGiftDiscoveryQuerySchema.parse(input);
  const next: Record<string, unknown> = { ...query };
  let resetPage = false;
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    const normalized = value === null ? undefined : value;
    if (key !== "locale" && key !== "page" && next[key] !== normalized)
      resetPage = true;
    if (normalized === undefined) delete next[key];
    else next[key] = normalized;
  }
  if (resetPage) next["page"] = 1;
  return giftDiscoveryQuerySchema.parse(next);
}

export function createCatalogPageInfo(input: unknown): CatalogPageInfo {
  const query = catalogPageRequestSchema.parse(input);
  const totalPages = Math.ceil(query.totalItems / query.pageSize);
  return catalogPageInfoSchema.parse({
    ...query,
    totalPages,
    hasPreviousPage: query.page > 1,
    hasNextPage:
      query.page < totalPages &&
      query.page < CATALOG_DISCOVERY_LIMITS.giftPageNumberMaximum,
    paginationLimited:
      totalPages > CATALOG_DISCOVERY_LIMITS.giftPageNumberMaximum,
  });
}
