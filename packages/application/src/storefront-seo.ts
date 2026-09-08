import {
  STOREFRONT_SEO_LIMITS,
  publishedContentContextResponseSchema,
  storefrontSeoReadCommandSchema,
  storefrontSeoResponseSchema,
  storefrontSeoSnapshotSchema,
  type StorefrontSeoCursorPayload,
  type StorefrontSeoFailure,
  type StorefrontSeoLocator,
  type StorefrontSeoResponse,
  type StorefrontSeoSnapshot,
} from "@fan-support/contracts";
import {
  createStorefrontSeoCursor,
  decodeStorefrontSeoCursor,
  projectStorefrontSeoEntity,
  sameStorefrontSeoLocator,
} from "@fan-support/content";
import type {
  JsonValue,
  StorefrontSeoRepository,
  StorefrontSeoTransactionManager,
} from "@fan-support/persistence-port";

const failure = (code: StorefrontSeoFailure["code"]): StorefrontSeoFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});
const unavailable = failure("CONTENT_UNAVAILABLE");
async function entity(
  repository: StorefrontSeoRepository,
  locator: StorefrontSeoLocator,
  expectedKey?: string,
) {
  const loaded = publishedContentContextResponseSchema.parse(
    await repository.loadEntity(locator),
  );
  if (loaded.outcome === "FAILURE") return expectedKey ? unavailable : loaded;
  const context = loaded.context;
  let key: string | undefined;
  if (context.schemaVersion === 3) {
    const document = context.current.document;
    key =
      document.kind === "HOMEPAGE"
        ? "0:homepage"
        : document.kind === "IDOL"
          ? `1:${document.ownerId.toLowerCase()}`
          : document.kind === "GIFT"
            ? `2:${document.ownerId.toLowerCase()}`
            : undefined;
  } else {
    const candidate = context.canonical.candidate;
    key =
      candidate.objectKind === "HOMEPAGE"
        ? "0:homepage"
        : candidate.objectKind === "IDOL"
          ? `1:${candidate.base.id.toLowerCase()}`
          : candidate.objectKind === "GIFT"
            ? `2:${candidate.base.id.toLowerCase()}`
            : candidate.objectKind === "POLICY"
              ? `3:${candidate.revision.policyKey}`
              : undefined;
  }
  if (expectedKey !== undefined && key !== expectedKey) return unavailable;
  const projected = projectStorefrontSeoEntity(loaded.context);
  return projected.outcome === "SUCCESS" &&
    !sameStorefrontSeoLocator(locator, projected.entity.locator)
    ? unavailable
    : projected;
}
function catalog(
  snapshot: Extract<StorefrontSeoSnapshot, { operation: "CATALOG" }>,
  cursor: StorefrontSeoCursorPayload | undefined,
): StorefrontSeoResponse {
  const { boundaries, hasNextPage, catalogVersion } = snapshot;
  if (
    (hasNextPage && boundaries.length !== STOREFRONT_SEO_LIMITS.catalog) ||
    boundaries.some(
      (row, index) =>
        row.firstKey > row.lastKey ||
        (row.afterKey !== null && row.afterKey >= row.firstKey) ||
        (index === 0
          ? cursor?.afterKey
            ? row.firstKey <= cursor.afterKey
            : row.afterKey !== null
          : row.afterKey !== boundaries[index - 1]!.lastKey) ||
        ((hasNextPage || index < boundaries.length - 1) &&
          row.itemCount !== STOREFRONT_SEO_LIMITS.index),
    )
  )
    return unavailable;
  return {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_SEO_CATALOG",
    catalogVersion,
    shards: boundaries.map((row) => ({
      cursor: createStorefrontSeoCursor({
        schemaVersion: 1,
        operation: "INDEX",
        catalogVersion,
        afterKey: row.afterKey,
      }),
      itemCount: row.itemCount,
    })),
    pageInfo: {
      hasNextPage,
      endCursor: hasNextPage
        ? createStorefrontSeoCursor({
            schemaVersion: 1,
            operation: "CATALOG",
            catalogVersion,
            afterKey: boundaries.at(-1)!.firstKey,
          })
        : null,
    },
  };
}
async function index(
  repository: StorefrontSeoRepository,
  snapshot: Extract<StorefrontSeoSnapshot, { operation: "INDEX" }>,
  cursor: StorefrontSeoCursorPayload | undefined,
): Promise<StorefrontSeoResponse> {
  const { candidates, catalogVersion, hasNextPage } = snapshot;
  if (
    (hasNextPage && candidates.length !== STOREFRONT_SEO_LIMITS.index) ||
    candidates.some((row, index) => {
      const previous =
        index === 0 ? cursor?.afterKey : candidates[index - 1]!.key;
      return previous != null && row.key <= previous;
    })
  )
    return unavailable;
  const items = [];
  for (const candidate of candidates) {
    const result = await entity(repository, candidate.locator, candidate.key);
    if (result.outcome !== "SUCCESS") return unavailable;
    items.push(result.entity);
  }
  return {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_SEO_INDEX",
    catalogVersion,
    items,
    pageInfo: {
      hasNextPage,
      endCursor: hasNextPage
        ? createStorefrontSeoCursor({
            schemaVersion: 1,
            operation: "INDEX",
            catalogVersion,
            afterKey: candidates.at(-1)!.key,
          })
        : null,
    },
  };
}
export function createStorefrontSeoUseCases({
  transactions,
}: Readonly<{ transactions: StorefrontSeoTransactionManager }>) {
  return Object.freeze({
    async execute(input: unknown): Promise<StorefrontSeoResponse> {
      const parsed = storefrontSeoReadCommandSchema.safeParse(input);
      if (!parsed.success) return failure("INVALID_QUERY");
      const command = parsed.data;
      const cursor =
        command.operation === "ENTITY" || command.cursor === undefined
          ? undefined
          : decodeStorefrontSeoCursor(command.cursor, command.operation);
      if (
        command.operation !== "ENTITY" &&
        command.cursor !== undefined &&
        !cursor
      )
        return failure("INVALID_CURSOR");
      try {
        return storefrontSeoResponseSchema.parse(
          await transactions.runInStorefrontSeoTransaction(
            async ({ storefrontSeo }) => {
              let result: StorefrontSeoResponse;
              if (command.operation === "ENTITY")
                result = await entity(storefrontSeo, command.locator);
              else {
                const snapshot = storefrontSeoSnapshotSchema.parse(
                  await (command.operation === "INDEX"
                    ? storefrontSeo.readIndex(cursor)
                    : storefrontSeo.readCatalog(cursor)),
                );
                if (snapshot.outcome === "FAILURE") return snapshot;
                if (snapshot.operation !== command.operation)
                  return unavailable;
                if (cursor && cursor.catalogVersion !== snapshot.catalogVersion)
                  return failure("CATALOG_CHANGED");
                result =
                  snapshot.operation === "INDEX"
                    ? await index(storefrontSeo, snapshot, cursor)
                    : catalog(snapshot, cursor);
              }
              return JSON.parse(JSON.stringify(result)) as JsonValue;
            },
          ),
        );
      } catch {
        return unavailable;
      }
    },
  });
}
