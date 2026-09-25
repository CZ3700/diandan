import { z } from "zod";

import { inventoryReservationSchema } from "./catalog.js";
import { currencySchema, marketSchema } from "./commerce.js";
import {
  canonicalRequestHashSchema,
  idempotencyActorSchema,
  idempotencyOperationSchema,
  inventoryReservationCreationApplySchema,
  inventoryReservationTransitionApplySchema,
  safeResultRefSchema,
} from "./domain-rules.js";
import { eventEnvelopeSchema } from "./envelopes.js";
import {
  eventIdSchema,
  idempotencyKeySchema,
  inventoryItemIdSchema,
  inventoryLocationIdSchema,
  inventoryReservationIdSchema,
} from "./identifiers.js";
import {
  portErrorBaseShape,
  portTimestampSchema,
  validatePortErrorPolicy,
} from "./port-common.js";
import {
  inventoryBalanceSchema,
  inventoryItemSchema,
  inventoryLedgerEntrySchema,
  inventoryLocationSchema,
} from "./pricing-inventory-content.js";
import { schemaVersionSchema } from "./versioning.js";

export const transactionOptionsSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  isolationLevel: z.enum(["READ_COMMITTED", "SERIALIZABLE"]),
});

export const persistencePortOperationSchema = z.enum([
  "BEGIN_IDEMPOTENCY",
  "COMPLETE_IDEMPOTENCY",
  "APPEND_OUTBOX_EVENT",
  "LOAD_INVENTORY_FOR_UPDATE",
  "APPLY_INVENTORY_RESERVATION_CREATION",
  "APPLY_INVENTORY_RESERVATION_TRANSITION",
]);
export const persistencePortErrorCodeSchema = z.enum([
  "INVALID_COMMAND",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "INTEGRITY_VIOLATION",
  "TRANSACTION_ABORTED",
  "TRANSACTION_OUTCOME_UNKNOWN",
  "TEMPORARY_UNAVAILABLE",
  "CONFIGURATION_ERROR",
  "UNEXPECTED_ADAPTER_FAILURE",
]);
export const persistencePortErrorSchema = z
  .strictObject({
    ...portErrorBaseShape,
    code: persistencePortErrorCodeSchema,
  })
  .superRefine((error, context) =>
    validatePortErrorPolicy(error, context, {
      retryableCodes: [
        "TRANSACTION_ABORTED",
        "TEMPORARY_UNAVAILABLE",
        "UNEXPECTED_ADAPTER_FAILURE",
      ],
      reconcileCodes: ["TRANSACTION_OUTCOME_UNKNOWN"],
    }),
  );

export const persistenceTransactionFailureSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("RUN_TRANSACTION"),
  outcome: z.literal("FAILURE"),
  error: persistencePortErrorSchema,
});

const idempotencyIdentityShape = {
  actor: idempotencyActorSchema,
  idempotencyOperation: idempotencyOperationSchema,
  idempotencyKey: idempotencyKeySchema,
  canonicalRequestHash: canonicalRequestHashSchema,
} as const;

const beginIdempotencyCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("BEGIN_IDEMPOTENCY"),
  ...idempotencyIdentityShape,
  expiresAt: portTimestampSchema,
});
const completeIdempotencyCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("COMPLETE_IDEMPOTENCY"),
  ...idempotencyIdentityShape,
  status: z.enum(["SUCCEEDED", "FAILED"]),
  safeResultReference: safeResultRefSchema,
});
const appendOutboxEventCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("APPEND_OUTBOX_EVENT"),
  event: eventEnvelopeSchema,
  aggregateVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  primarySubjectId: z.uuid(),
  secondarySubjectId: z.uuid().optional(),
  market: marketSchema.optional(),
  currency: currencySchema.optional(),
  idempotencyKey: idempotencyKeySchema,
  availableAt: portTimestampSchema,
});

const inventoryLockTargetSchema = z.strictObject({
  inventoryItemId: inventoryItemIdSchema,
  inventoryLocationId: inventoryLocationIdSchema,
  reservationId: inventoryReservationIdSchema.optional(),
});
const loadInventoryCommandSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    operation: z.literal("LOAD_INVENTORY_FOR_UPDATE"),
    targets: z.array(inventoryLockTargetSchema).min(1).max(100),
  })
  .superRefine((command, context) => {
    const seen = new Set<string>();
    command.targets.forEach((target, index) => {
      const key = `${String(target.inventoryItemId).toLowerCase()}:${String(target.inventoryLocationId).toLowerCase()}`;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["targets", index],
          message: "inventory lock targets must be unique",
        });
      }
      seen.add(key);
    });
  });
const applyReservationCreationCommandSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    operation: z.literal("APPLY_INVENTORY_RESERVATION_CREATION"),
    decision: inventoryReservationCreationApplySchema,
    ledgerEntry: inventoryLedgerEntrySchema,
  })
  .superRefine((command, context) => {
    if (
      String(command.ledgerEntry.inventoryItemId) !==
        String(command.decision.inventoryItemId) ||
      String(command.ledgerEntry.inventoryLocationId) !==
        String(command.decision.inventoryLocationId) ||
      command.ledgerEntry.deltaOnHand !==
        command.decision.ledgerDelta.deltaOnHand ||
      command.ledgerEntry.deltaReserved !==
        command.decision.ledgerDelta.deltaReserved ||
      command.ledgerEntry.reasonCode !== command.decision.reasonCode
    ) {
      context.addIssue({
        code: "custom",
        path: ["ledgerEntry"],
        message: "ledger entry must match the creation decision",
      });
    }
  });
const applyReservationTransitionCommandSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    operation: z.literal("APPLY_INVENTORY_RESERVATION_TRANSITION"),
    decision: inventoryReservationTransitionApplySchema,
    ledgerEntry: inventoryLedgerEntrySchema,
  })
  .superRefine((command, context) => {
    if (
      String(command.ledgerEntry.inventoryItemId) !==
        String(command.decision.inventoryItemId) ||
      String(command.ledgerEntry.inventoryLocationId) !==
        String(command.decision.inventoryLocationId) ||
      command.ledgerEntry.deltaOnHand !==
        command.decision.ledgerDelta.deltaOnHand ||
      command.ledgerEntry.deltaReserved !==
        command.decision.ledgerDelta.deltaReserved ||
      command.ledgerEntry.reasonCode !== command.decision.reasonCode
    ) {
      context.addIssue({
        code: "custom",
        path: ["ledgerEntry"],
        message: "ledger entry must match the transition decision",
      });
    }
  });

export const persistencePortCommandSchema = z.union([
  beginIdempotencyCommandSchema,
  completeIdempotencyCommandSchema,
  appendOutboxEventCommandSchema,
  loadInventoryCommandSchema,
  applyReservationCreationCommandSchema,
  applyReservationTransitionCommandSchema,
]);

const failureSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: persistencePortOperationSchema,
  outcome: z.literal("FAILURE"),
  error: persistencePortErrorSchema,
});
const beginIdempotencySuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("BEGIN_IDEMPOTENCY"),
  outcome: z.literal("SUCCESS"),
  value: z.discriminatedUnion("decision", [
    z.strictObject({ decision: z.literal("STARTED") }),
    z.strictObject({ decision: z.literal("IN_PROGRESS") }),
    z.strictObject({
      decision: z.literal("REPLAY"),
      safeResultReference: safeResultRefSchema,
    }),
    z.strictObject({ decision: z.literal("CONFLICT") }),
  ]),
});
const completeIdempotencySuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("COMPLETE_IDEMPOTENCY"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({ completed: z.literal(true) }),
});
const appendOutboxEventSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("APPEND_OUTBOX_EVENT"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({ eventId: eventIdSchema, appended: z.literal(true) }),
});
const lockedInventoryItemSchema = z.strictObject({
  inventoryItem: inventoryItemSchema,
  inventoryLocation: inventoryLocationSchema,
  balance: inventoryBalanceSchema,
  reservation: inventoryReservationSchema.nullable(),
});
const loadInventorySuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("LOAD_INVENTORY_FOR_UPDATE"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    items: z.array(lockedInventoryItemSchema).min(1).max(100),
  }),
});
const inventoryWriteValueSchema = z.strictObject({
  balance: inventoryBalanceSchema,
  reservation: inventoryReservationSchema,
  ledgerEntry: inventoryLedgerEntrySchema,
});
const applyReservationCreationSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("APPLY_INVENTORY_RESERVATION_CREATION"),
  outcome: z.literal("SUCCESS"),
  value: inventoryWriteValueSchema,
});
const applyReservationTransitionSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("APPLY_INVENTORY_RESERVATION_TRANSITION"),
  outcome: z.literal("SUCCESS"),
  value: inventoryWriteValueSchema,
});

export const persistencePortResponseSchema = z.union([
  beginIdempotencySuccessSchema,
  completeIdempotencySuccessSchema,
  appendOutboxEventSuccessSchema,
  loadInventorySuccessSchema,
  applyReservationCreationSuccessSchema,
  applyReservationTransitionSuccessSchema,
  failureSchema,
]);

export type TransactionOptions = z.infer<typeof transactionOptionsSchema>;
export type PersistencePortCommand = z.infer<
  typeof persistencePortCommandSchema
>;
export type PersistencePortResponse = z.infer<
  typeof persistencePortResponseSchema
>;
export type PersistencePortError = z.infer<typeof persistencePortErrorSchema>;
export type PersistencePortFailure = z.infer<typeof failureSchema>;
export type PersistenceTransactionFailure = z.infer<
  typeof persistenceTransactionFailureSchema
>;
type PersistenceFailureFor<
  Operation extends PersistencePortCommand["operation"],
> = Omit<PersistencePortFailure, "operation"> &
  Readonly<{ operation: Operation }>;
export type BeginIdempotencyCommand = z.infer<
  typeof beginIdempotencyCommandSchema
>;
export type BeginIdempotencyResponse =
  | Extract<PersistencePortResponse, { operation: "BEGIN_IDEMPOTENCY" }>
  | PersistenceFailureFor<"BEGIN_IDEMPOTENCY">;
export type CompleteIdempotencyCommand = z.infer<
  typeof completeIdempotencyCommandSchema
>;
export type CompleteIdempotencyResponse =
  | Extract<PersistencePortResponse, { operation: "COMPLETE_IDEMPOTENCY" }>
  | PersistenceFailureFor<"COMPLETE_IDEMPOTENCY">;
export type AppendOutboxEventCommand = z.infer<
  typeof appendOutboxEventCommandSchema
>;
export type AppendOutboxEventResponse =
  | Extract<PersistencePortResponse, { operation: "APPEND_OUTBOX_EVENT" }>
  | PersistenceFailureFor<"APPEND_OUTBOX_EVENT">;
export type LoadInventoryForUpdateCommand = z.infer<
  typeof loadInventoryCommandSchema
>;
export type LoadInventoryForUpdateResponse =
  | Extract<PersistencePortResponse, { operation: "LOAD_INVENTORY_FOR_UPDATE" }>
  | PersistenceFailureFor<"LOAD_INVENTORY_FOR_UPDATE">;
export type ApplyInventoryReservationCreationCommand = z.infer<
  typeof applyReservationCreationCommandSchema
>;
export type ApplyInventoryReservationCreationResponse =
  | Extract<
      PersistencePortResponse,
      { operation: "APPLY_INVENTORY_RESERVATION_CREATION" }
    >
  | PersistenceFailureFor<"APPLY_INVENTORY_RESERVATION_CREATION">;
export type ApplyInventoryReservationTransitionCommand = z.infer<
  typeof applyReservationTransitionCommandSchema
>;
export type ApplyInventoryReservationTransitionResponse =
  | Extract<
      PersistencePortResponse,
      { operation: "APPLY_INVENTORY_RESERVATION_TRANSITION" }
    >
  | PersistenceFailureFor<"APPLY_INVENTORY_RESERVATION_TRANSITION">;
