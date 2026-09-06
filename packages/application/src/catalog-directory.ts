import {
  createCatalogPageInfo,
  createGiftDiscoveryPlan,
  createIdolDirectoryCursor,
  createIdolDiscoveryPlan,
  decodeIdolDirectoryCursor,
} from "@fan-support/catalog";
import {
  catalogDirectoryFailureSchema,
  giftDirectoryResponseSchema,
  giftDirectorySnapshotSchema,
  giftDiscoveryQuerySchema,
  idolDirectoryResponseSchema,
  idolDirectorySnapshotSchema,
  idolDiscoveryQuerySchema,
  type CatalogDirectoryFailure,
  type GiftDirectoryResponse,
  type IdolDirectoryResponse,
} from "@fan-support/contracts";
import { selectPublishedGift, selectPublishedIdol } from "@fan-support/content";
import type {
  ContentReadTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";

export type CatalogDirectoryDependencies = Readonly<{
  transactions: ContentReadTransactionManager;
}>;

export type CatalogDirectoryUseCases = Readonly<{
  readIdols(input: unknown): Promise<IdolDirectoryResponse>;
  readGifts(input: unknown): Promise<GiftDirectoryResponse>;
}>;

function failure(
  code: CatalogDirectoryFailure["code"],
): CatalogDirectoryFailure {
  return catalogDirectoryFailureSchema.parse({
    schemaVersion: 1,
    outcome: "FAILURE",
    code,
  });
}

function hasExactLocale(
  context: Readonly<{
    requestedLocale: string;
    resolvedLocale: string;
    fallbackUsed: boolean;
  }>,
  locale: string,
): boolean {
  return (
    context.requestedLocale === locale &&
    context.resolvedLocale === locale &&
    !context.fallbackUsed
  );
}

/** Schema-validated DTOs can represent omitted optional fields as undefined. */
function publicJson(
  value: IdolDirectoryResponse | GiftDirectoryResponse,
): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function createCatalogDirectoryUseCases(
  dependencies: CatalogDirectoryDependencies,
): CatalogDirectoryUseCases {
  return Object.freeze({
    async readIdols(input: unknown): Promise<IdolDirectoryResponse> {
      const parsed = idolDiscoveryQuerySchema.safeParse(input);
      if (!parsed.success) return failure("INVALID_QUERY");
      const query = parsed.data;
      const continuation =
        query.after === undefined
          ? undefined
          : decodeIdolDirectoryCursor({
              schemaVersion: 1,
              query,
              cursor: query.after,
            });
      if (query.after !== undefined && continuation === undefined)
        return failure("INVALID_CURSOR");
      try {
        const plan = createIdolDiscoveryPlan(query);
        const result =
          await dependencies.transactions.runInContentReadTransaction(
            async ({ catalogDirectory }) => {
              const snapshot = idolDirectorySnapshotSchema.parse(
                await catalogDirectory.readIdols({
                  schemaVersion: 1,
                  plan,
                  ...(continuation === undefined ? {} : { continuation }),
                }),
              );
              if (snapshot.outcome === "FAILURE") return snapshot;
              if (
                snapshot.items.length > query.limit ||
                (snapshot.hasNextPage && snapshot.items.length !== query.limit)
              ) {
                return failure("CATALOG_UNAVAILABLE");
              }
              const items = [];
              const ids = new Set<string>();
              for (const record of snapshot.items) {
                const projected = selectPublishedIdol(
                  record.selection,
                  record.source,
                );
                if (
                  !projected.success ||
                  !hasExactLocale(
                    projected.value.localeContext,
                    query.locale,
                  ) ||
                  ids.has(projected.value.id.toLowerCase())
                ) {
                  return failure("CATALOG_UNAVAILABLE");
                }
                ids.add(projected.value.id.toLowerCase());
                items.push(projected.value);
              }
              const last = items.at(-1);
              return publicJson(
                idolDirectoryResponseSchema.parse({
                  schemaVersion: 1,
                  outcome: "SUCCESS",
                  catalogVersion: snapshot.catalogVersion,
                  items,
                  pageInfo: {
                    schemaVersion: 1,
                    hasNextPage: snapshot.hasNextPage,
                    endCursor:
                      snapshot.hasNextPage && last !== undefined
                        ? createIdolDirectoryCursor({
                            schemaVersion: 1,
                            query,
                            catalogVersion: snapshot.catalogVersion,
                            afterId: last.id,
                          })
                        : null,
                  },
                }),
              );
            },
          );
        return idolDirectoryResponseSchema.parse(result);
      } catch {
        return failure("CATALOG_UNAVAILABLE");
      }
    },
    async readGifts(input: unknown): Promise<GiftDirectoryResponse> {
      const parsed = giftDiscoveryQuerySchema.safeParse(input);
      if (!parsed.success) return failure("INVALID_QUERY");
      const query = parsed.data;
      try {
        const plan = createGiftDiscoveryPlan(query);
        const result =
          await dependencies.transactions.runInContentReadTransaction(
            async ({ catalogDirectory }) => {
              const snapshot = giftDirectorySnapshotSchema.parse(
                await catalogDirectory.readGifts({ schemaVersion: 1, plan }),
              );
              if (snapshot.outcome === "FAILURE") return snapshot;
              if (
                snapshot.items.length !==
                Math.min(
                  query.pageSize,
                  Math.max(0, snapshot.totalItems - plan.offset),
                )
              ) {
                return failure("CATALOG_UNAVAILABLE");
              }
              const items = [];
              const ids = new Set<string>();
              for (const entry of snapshot.items) {
                const projected = selectPublishedGift(
                  entry.record.selection,
                  entry.record.source,
                );
                if (
                  !projected.success ||
                  !hasExactLocale(
                    projected.value.localeContext,
                    query.locale,
                  ) ||
                  ids.has(projected.value.id.toLowerCase()) ||
                  entry.offer.market !== query.market ||
                  entry.offer.currency !== query.currency
                ) {
                  return failure("CATALOG_UNAVAILABLE");
                }
                ids.add(projected.value.id.toLowerCase());
                items.push({
                  schemaVersion: 1 as const,
                  gift: projected.value,
                  offer: entry.offer,
                });
              }
              return publicJson(
                giftDirectoryResponseSchema.parse({
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
              );
            },
          );
        return giftDirectoryResponseSchema.parse(result);
      } catch {
        return failure("CATALOG_UNAVAILABLE");
      }
    },
  });
}
