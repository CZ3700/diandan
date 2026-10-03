import { z } from "zod";
import {
  adminLedgerCommandSchema,
  adminLedgerTimeZoneSchema,
} from "./admin-ledger.js";
import { adminOrdersAccessSchema } from "./admin-orders-persistence.js";

/**
 * The store sees token digests only; the ledger time zone is deployment configuration, never caller input.
 * A message read's second step reuses the orders confirmation (`AdminOrdersConfirmPrivate`).
 */
export const adminLedgerStoreRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  access: adminOrdersAccessSchema,
  command: adminLedgerCommandSchema,
  timeZone: adminLedgerTimeZoneSchema,
});

export type AdminLedgerStoreRequest = z.infer<
  typeof adminLedgerStoreRequestSchema
>;
