import {
  catalogVersionSchema,
  giftBrowseReadCommandSchema,
  giftBrowseSnapshotSchema,
  giftIdSchema,
} from "@fan-support/contracts";
import type { CatalogDirectoryRepository } from "@fan-support/persistence-port";
import { loadGiftDirectoryRecords } from "./catalog-publication-loader.js";
import { catalogRecord, catalogRows } from "./catalog-publication-mapper.js";
import { buildGiftBrowseQuery } from "./gift-browse-sql.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

export function createGiftBrowseRepository(
  client: TransactionClient,
  dependencies: Readonly<{
    transactionScope: TransactionScopeControl;
    publicMediaBaseUrl: string;
  }>,
): Pick<CatalogDirectoryRepository, "browseGifts"> {
  return {
    browseGifts: (input) =>
      dependencies.transactionScope.trackOperation(async () => {
        try {
          const parsed = giftBrowseReadCommandSchema.safeParse(input);
          if (!parsed.success)
            return {
              schemaVersion: 1,
              outcome: "FAILURE",
              code: "INVALID_QUERY",
            };
          const { query } = parsed.data;
          const statement = buildGiftBrowseQuery(query);
          const rows = catalogRows(
            catalogRecord(await client.query(statement.text, statement.values))[
              "rows"
            ],
          );
          if (rows.length !== 1) throw new Error("CATALOG_BROWSE_INVALID");
          const row = rows[0]!;
          const catalogVersion = catalogVersionSchema.parse(
            row["catalog_version"],
          );
          const count = row["total_items"];
          if (
            typeof count !== "string" ||
            !/^(0|[1-9]\d*)$/u.test(count) ||
            !Number.isSafeInteger(Number(count))
          )
            throw new Error("CATALOG_BROWSE_INVALID");
          const totalItems = Number(count);
          if (!Array.isArray(row["ids"]))
            throw new Error("CATALOG_BROWSE_INVALID");
          const ids = row["ids"].map((id: unknown) =>
            giftIdSchema.parse(id).toLowerCase(),
          );
          const offset = (query.page - 1) * query.pageSize;
          if (
            ids.length !==
              Math.min(query.pageSize, Math.max(0, totalItems - offset)) ||
            new Set(ids).size !== ids.length
          )
            throw new Error("CATALOG_BROWSE_INVALID");
          const items =
            ids.length === 0
              ? []
              : await loadGiftDirectoryRecords(
                  client,
                  ids,
                  query.locale,
                  dependencies.publicMediaBaseUrl,
                  dependencies.transactionScope,
                  { verifiedLocaleFallback: true },
                );
          if (
            items.length !== ids.length ||
            items.some(
              (item, index) =>
                (item.schemaVersion === 3
                  ? item.context.current.document.ownerId
                  : item.source.base.id
                ).toLowerCase() !== ids[index],
            )
          )
            throw new Error("CATALOG_BROWSE_INVALID");
          return giftBrowseSnapshotSchema.parse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            catalogVersion,
            totalItems,
            items,
          });
        } catch (error: unknown) {
          throw persistenceTransactionFailureFromPostgres(error);
        }
      }),
  };
}
