import { z } from "zod";

import { priceBookSchema } from "./catalog.js";
import { minorAmountSchema } from "./commerce.js";
import { contentTimestampSchema } from "./content-lifecycle.js";
import {
  adminIdentityIdSchema,
  giftVariantIdSchema,
  idempotencyKeySchema,
  inventoryItemIdSchema,
  inventoryLedgerEntryIdSchema,
  inventoryLocationIdSchema,
  priceBookIdSchema,
  priceIdSchema,
} from "./identifiers.js";
import { schemaVersionSchema } from "./versioning.js";

const positiveVersionSchema = z.number().int().positive();
const inventoryQuantitySchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const priceBookRevisionSchema = priceBookSchema
  .superRefine((value, context) => {
    if (
      value.validUntil !== undefined &&
      Date.parse(value.validFrom) >= Date.parse(value.validUntil)
    ) {
      context.addIssue({
        code: "custom",
        message: "price-book validity start must precede its end",
        path: ["validUntil"],
      });
    }
  })
  .meta({
    "x-runtime-invariants": ["validFrom is earlier than validUntil"],
  });

export const priceSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: priceIdSchema,
    revision: positiveVersionSchema,
    priceBookId: priceBookIdSchema,
    priceBookRevision: positiveVersionSchema,
    giftVariantId: giftVariantIdSchema,
    unitAmountMinor: minorAmountSchema,
    validFrom: contentTimestampSchema,
    validUntil: contentTimestampSchema.optional(),
  })
  .superRefine((value, context) => {
    if (
      value.validUntil !== undefined &&
      Date.parse(value.validFrom) >= Date.parse(value.validUntil)
    ) {
      context.addIssue({
        code: "custom",
        message: "price validity start must precede its end",
        path: ["validUntil"],
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "amount and validity are immutable within one price revision",
      "validFrom is earlier than validUntil",
    ],
  });

export const inventoryLocationSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: inventoryLocationIdSchema,
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$/u),
  status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]),
});

export const inventoryItemSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: inventoryItemIdSchema,
  giftVariantId: giftVariantIdSchema,
  sku: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/u),
  policy: z.enum(["TRACKED", "PROCURE_ON_DEMAND", "PREORDER"]),
  status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]),
});

export const inventoryBalanceSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    inventoryItemId: inventoryItemIdSchema,
    inventoryLocationId: inventoryLocationIdSchema,
    onHand: inventoryQuantitySchema,
    reserved: inventoryQuantitySchema,
    version: positiveVersionSchema,
  })
  .superRefine((value, context) => {
    if (value.reserved > value.onHand) {
      context.addIssue({
        code: "custom",
        message: "reserved inventory cannot exceed on-hand inventory",
        path: ["reserved"],
      });
    }
  })
  .meta({
    "x-runtime-invariants": [
      "onHand >= 0",
      "reserved >= 0",
      "reserved <= onHand",
      "available = onHand - reserved",
    ],
  });

const inventoryLedgerActorSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("ADMIN"),
    adminIdentityId: adminIdentityIdSchema,
  }),
  z.strictObject({
    kind: z.literal("SYSTEM"),
    taskName: z.string().min(1).max(128),
  }),
  z.strictObject({
    kind: z.literal("IMPORT"),
    importBatchId: z.uuid(),
  }),
]);

export const inventoryLedgerEntrySchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: inventoryLedgerEntryIdSchema,
  inventoryItemId: inventoryItemIdSchema,
  inventoryLocationId: inventoryLocationIdSchema,
  deltaOnHand: z
    .number()
    .int()
    .min(-Number.MAX_SAFE_INTEGER)
    .max(Number.MAX_SAFE_INTEGER),
  deltaReserved: z
    .number()
    .int()
    .min(-Number.MAX_SAFE_INTEGER)
    .max(Number.MAX_SAFE_INTEGER),
  reasonCode: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Z][A-Z0-9_]*$/u),
  idempotencyKey: idempotencyKeySchema,
  actor: inventoryLedgerActorSchema,
  occurredAt: contentTimestampSchema,
});

export type PriceBookRevision = z.infer<typeof priceBookRevisionSchema>;
export type Price = z.infer<typeof priceSchema>;
export type InventoryLocation = z.infer<typeof inventoryLocationSchema>;
export type InventoryItem = z.infer<typeof inventoryItemSchema>;
export type InventoryBalance = z.infer<typeof inventoryBalanceSchema>;
export type InventoryLedgerEntry = z.infer<typeof inventoryLedgerEntrySchema>;
