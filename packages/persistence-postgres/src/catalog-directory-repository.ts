import {
  createGiftDiscoveryPlan,
  createIdolDiscoveryPlan,
  decodeIdolDirectoryCursor,
} from "@fan-support/catalog";
import {
  catalogVersionSchema,
  giftDirectoryReadCommandSchema,
  giftDirectorySnapshotSchema,
  giftIdSchema,
  idolDirectoryReadCommandSchema,
  idolDirectorySnapshotSchema,
  idolIdSchema,
} from "@fan-support/contracts";
import type {
  CatalogDirectoryFailure,
  GiftDirectorySnapshot,
  IdolDirectorySnapshot,
} from "@fan-support/contracts";
import type { CatalogDirectoryRepository } from "@fan-support/persistence-port";
import {
  buildGiftDirectoryQuery,
  buildIdolDirectoryQuery,
} from "./catalog-directory-sql.js";
import {
  loadGiftDirectoryRecords,
  loadIdolDirectoryRecords,
} from "./catalog-publication-loader.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

function failure(
  code: CatalogDirectoryFailure["code"],
): CatalogDirectoryFailure {
  return { schemaVersion: 1, outcome: "FAILURE", code };
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("invalid catalog database response");
  return value as Readonly<Record<string, unknown>>;
}

function oneRow(result: unknown): Readonly<Record<string, unknown>> {
  const rows = record(result)["rows"];
  if (!Array.isArray(rows) || rows.length !== 1)
    throw new Error("invalid catalog database row count");
  return record(rows[0]);
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new Error("invalid catalog database collection");
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw new Error("invalid catalog database flag");
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/u.test(value))
    throw new Error("invalid catalog database integer");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new Error("catalog database integer exceeds safe range");
  return parsed;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createCatalogDirectoryRepository(
  client: TransactionClient,
  dependencies: Readonly<{
    transactionScope: TransactionScopeControl;
    publicMediaBaseUrl: string;
  }>,
): CatalogDirectoryRepository {
  function run<Result>(work: () => Promise<Result>): Promise<Result> {
    return dependencies.transactionScope.trackOperation(async () => {
      try {
        return await work();
      } catch (error: unknown) {
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  }

  return {
    readIdols: (input) =>
      run(async (): Promise<IdolDirectorySnapshot> => {
        const parsed = idolDirectoryReadCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_QUERY");
        const { plan, continuation } = parsed.data;
        if (!same(plan, createIdolDiscoveryPlan(plan.query)))
          return failure("INVALID_QUERY");
        if (plan.query.after === undefined) {
          if (continuation !== undefined) return failure("INVALID_CURSOR");
        } else {
          const decoded = decodeIdolDirectoryCursor({
            schemaVersion: 1,
            query: plan.query,
            cursor: plan.query.after,
          });
          if (
            decoded === undefined ||
            continuation === undefined ||
            !same(decoded, continuation)
          )
            return failure("INVALID_CURSOR");
        }
        const statement = buildIdolDirectoryQuery({
          locale: plan.query.locale,
          searchTerm: plan.searchTerm ?? null,
          take: plan.take,
          anchorId: plan.query.anchorId ?? null,
          afterId: continuation?.afterId ?? null,
        });
        const row = oneRow(
          await client.query(statement.text, statement.values),
        );
        const catalogVersion = catalogVersionSchema.parse(
          row["catalog_version"],
        );
        if (
          continuation !== undefined &&
          continuation.catalogVersion !== catalogVersion
        )
          return failure("CATALOG_CHANGED");
        if (!boolean(row["projection_complete"]))
          return failure("CATALOG_UNAVAILABLE");
        if (!boolean(row["anchor_found"])) return failure("ANCHOR_NOT_FOUND");
        if (!boolean(row["cursor_found"])) return failure("INVALID_CURSOR");
        const ids = array(row["ids"]).map((value) => idolIdSchema.parse(value));
        if (ids.length > plan.take || new Set(ids).size !== ids.length)
          return failure("CATALOG_UNAVAILABLE");
        const selectedIds = ids.slice(0, plan.query.limit);
        const items = await loadIdolDirectoryRecords(
          client,
          selectedIds,
          plan.query.locale,
          dependencies.publicMediaBaseUrl,
          dependencies.transactionScope,
        );
        if (
          items.length !== selectedIds.length ||
          items.some(
            (item, index) => item.source.base.id !== selectedIds[index],
          )
        )
          return failure("CATALOG_UNAVAILABLE");
        return idolDirectorySnapshotSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          catalogVersion,
          items,
          hasNextPage: ids.length > plan.query.limit,
        });
      }),

    readGifts: (input) =>
      run(async (): Promise<GiftDirectorySnapshot> => {
        const parsed = giftDirectoryReadCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_QUERY");
        const { plan } = parsed.data;
        if (!same(plan, createGiftDiscoveryPlan(plan.query)))
          return failure("INVALID_QUERY");
        const query = plan.query;
        const statement = buildGiftDirectoryQuery({
          locale: query.locale,
          market: query.market,
          currency: query.currency,
          idolId: query.idolId ?? null,
          category: query.category ?? null,
          priceMinMinor: query.priceMinMinor ?? null,
          priceMaxMinor: query.priceMaxMinor ?? null,
          availability: query.availability,
          sort: query.sort,
          take: plan.take,
          offset: plan.offset,
        });
        const row = oneRow(
          await client.query(statement.text, statement.values),
        );
        const catalogVersion = catalogVersionSchema.parse(
          row["catalog_version"],
        );
        const totalItems = integer(row["total_items"]);
        const window = array(row["items"]).map((value) => {
          const item = record(value);
          return {
            id: giftIdSchema.parse(item["id"]),
            priceMinor:
              item["priceMinor"] === null ? null : integer(item["priceMinor"]),
          };
        });
        if (
          window.length > plan.take ||
          window.length !==
            Math.min(plan.take, Math.max(0, totalItems - plan.offset)) ||
          new Set(window.map((item) => item.id)).size !== window.length
        )
          return failure("CATALOG_UNAVAILABLE");
        const ids = window.map((item) => item.id);
        const records = await loadGiftDirectoryRecords(
          client,
          ids,
          query.locale,
          dependencies.publicMediaBaseUrl,
          dependencies.transactionScope,
        );
        if (
          records.length !== ids.length ||
          records.some((item, index) => item.source.base.id !== ids[index])
        )
          return failure("CATALOG_UNAVAILABLE");
        return giftDirectorySnapshotSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          catalogVersion,
          totalItems,
          items: records.map((record, index) => ({
            schemaVersion: 1,
            record,
            offer: {
              schemaVersion: 1,
              market: query.market,
              currency: query.currency,
              priceMinor: window[index]!.priceMinor,
              purchasable: window[index]!.priceMinor !== null,
            },
          })),
        });
      }),
  };
}
