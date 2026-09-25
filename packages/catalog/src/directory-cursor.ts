import { createHash } from "node:crypto";
import {
  idolDirectoryCursorEncodingInputSchema,
  idolDirectoryCursorDecodingInputSchema,
  idolDirectoryCursorSchema,
  type IdolDirectoryCursor,
} from "@fan-support/contracts";
import { createIdolDiscoveryPlan } from "./discovery.js";

export function createIdolDirectoryQueryHash(input: unknown): string {
  const { query, searchTerm } = createIdolDiscoveryPlan(input);
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: 1,
        locale: query.locale,
        searchTerm: searchTerm ?? null,
        limit: query.limit,
      }),
    )
    .digest("hex");
}

/** A cursor is bounded public navigation state. It grants no read permission. */
export function createIdolDirectoryCursor(input: unknown): string {
  const { query, catalogVersion, afterId } =
    idolDirectoryCursorEncodingInputSchema.parse(input);
  const cursor = idolDirectoryCursorSchema.parse({
    schemaVersion: 1,
    queryHash: createIdolDirectoryQueryHash(query),
    catalogVersion,
    afterId: afterId.toLowerCase(),
  });
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeIdolDirectoryCursor(
  input: unknown,
): IdolDirectoryCursor | undefined {
  const parsed = idolDirectoryCursorDecodingInputSchema.safeParse(input);
  if (!parsed.success) return undefined;
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(parsed.data.cursor, "base64url").toString("utf8"),
    );
    const cursor = idolDirectoryCursorSchema.safeParse(decoded);
    if (
      !cursor.success ||
      cursor.data.queryHash !== createIdolDirectoryQueryHash(parsed.data.query)
    )
      return undefined;
    // Reject aliases, padding, duplicate keys, extra fields, invalid UTF-8 and alternate JSON representations.
    const canonical = createIdolDirectoryCursor({
      schemaVersion: 1,
      query: parsed.data.query,
      catalogVersion: cursor.data.catalogVersion,
      afterId: cursor.data.afterId,
    });
    return canonical === parsed.data.cursor ? cursor.data : undefined;
  } catch {
    return undefined;
  }
}
