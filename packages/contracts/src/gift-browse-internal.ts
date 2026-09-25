import { z } from "zod";
import { CATALOG_DISCOVERY_LIMITS } from "./catalog-discovery.js";
import { giftDirectoryRecordSchema } from "./catalog-directory.js";
import {
  catalogDirectoryFailureSchema,
  catalogVersionSchema,
} from "./catalog-directory-public.js";
import { giftBrowseQuerySchema } from "./gift-browse.js";
import { schemaVersionSchema } from "./versioning.js";

export const giftBrowseReadCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  query: giftBrowseQuerySchema,
});
/** Internal publication proof, hydrated only after database pagination. */
export const giftBrowseSnapshotSchema = z.union([
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    catalogVersion: catalogVersionSchema,
    totalItems: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    items: z
      .array(giftDirectoryRecordSchema)
      .max(CATALOG_DISCOVERY_LIMITS.giftPageMaximum),
  }),
  catalogDirectoryFailureSchema,
]);

export type GiftBrowseReadCommand = z.infer<typeof giftBrowseReadCommandSchema>;
export type GiftBrowseSnapshot = z.infer<typeof giftBrowseSnapshotSchema>;
