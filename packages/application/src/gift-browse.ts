import { createCatalogPageInfo } from "@fan-support/catalog";
import {
  DEFAULT_LOCALE,
  giftBrowseQuerySchema,
  giftBrowseResponseSchema,
  giftBrowseSnapshotSchema,
  type GiftBrowseResponse,
  type GiftDirectoryRecord,
} from "@fan-support/contracts";
import {
  projectDailyPublication,
  selectPublishedGift,
} from "@fan-support/content";
import type {
  ContentReadTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";

const unavailable = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "CATALOG_UNAVAILABLE",
} as const;

function projectGift(record: GiftDirectoryRecord) {
  if (record.schemaVersion === 1)
    return selectPublishedGift(record.selection, record.source);
  const response = projectDailyPublication(record.context);
  return response.outcome === "SUCCESS" && response.content.kind === "GIFT"
    ? { success: true as const, value: response.content.view }
    : { success: false as const };
}

/** Projects only proven published content, without resolving prices or mutating shopping context. */
export function createGiftBrowseUseCase({
  transactions,
}: Readonly<{ transactions: ContentReadTransactionManager }>) {
  return async (input: unknown): Promise<GiftBrowseResponse> => {
    const parsed = giftBrowseQuerySchema.safeParse(input);
    if (!parsed.success)
      return { schemaVersion: 1, outcome: "FAILURE", code: "INVALID_QUERY" };
    const query = parsed.data;
    try {
      const result = await transactions.runInContentReadTransaction(
        async ({ catalogDirectory }) => {
          const snapshot = giftBrowseSnapshotSchema.parse(
            await catalogDirectory.browseGifts({ schemaVersion: 1, query }),
          );
          if (snapshot.outcome === "FAILURE") return snapshot;
          if (
            snapshot.items.length !==
            Math.min(
              query.pageSize,
              Math.max(
                0,
                snapshot.totalItems - (query.page - 1) * query.pageSize,
              ),
            )
          )
            return unavailable;
          const { giftKinds } = snapshot;
          if (
            query.kind !== undefined &&
            (giftKinds === undefined ||
              giftKinds.some((giftKind) => giftKind !== query.kind))
          )
            return unavailable;
          const items = [];
          for (const [index, record] of snapshot.items.entries()) {
            const projected = projectGift(record);
            if (!projected.success) return unavailable;
            const gift = projected.value;
            const context = gift.localeContext;
            const resolvedLocaleMatches =
              context.schemaVersion === 2
                ? context.resolvedLocale === context.sourceLocale &&
                  context.fallbackUsed ===
                    (query.locale !== context.sourceLocale)
                : context.fallbackUsed
                  ? query.locale !== DEFAULT_LOCALE &&
                    context.resolvedLocale === DEFAULT_LOCALE &&
                    typeof context.translationRevision === "string" &&
                    context.translationRevision.trim().length > 0
                  : context.resolvedLocale === query.locale;
            if (
              context.requestedLocale !== query.locale ||
              !resolvedLocaleMatches ||
              (query.category !== undefined && gift.category !== query.category)
            )
              return unavailable;
            items.push(
              giftKinds === undefined
                ? gift
                : { ...gift, giftKind: giftKinds[index] ?? null },
            );
          }
          return JSON.parse(
            JSON.stringify(
              giftBrowseResponseSchema.parse({
                schemaVersion: 1,
                outcome: "SUCCESS",
                catalogVersion: snapshot.catalogVersion,
                items,
                pageInfo: createCatalogPageInfo({
                  schemaVersion: 1,
                  page: query.page,
                  pageSize: query.pageSize,
                  totalItems: snapshot.totalItems,
                }),
              }),
            ),
          ) as JsonValue;
        },
      );
      return giftBrowseResponseSchema.parse(result);
    } catch {
      return unavailable;
    }
  };
}
