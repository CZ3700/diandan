import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const schemaVersion = () => smallint("schema_version").notNull().default(1);
const requiredVersion = (name: string) =>
  bigint(name, { mode: "number" }).notNull();
const version = (name = "version") => requiredVersion(name).default(1);
const quantity = (name: string) => bigint(name, { mode: "number" }).notNull();
const timestampWithTimezone = (name: string) =>
  timestamp(name, { mode: "string", withTimezone: true });
const requiredTimestamp = (name: string) =>
  timestampWithTimezone(name).notNull();
const transactionTimestamp = (name: string) =>
  requiredTimestamp(name).default(sql`transaction_timestamp()`);
const binary = customType<{ data: Uint8Array }>({
  dataType: () => "bytea",
});
const encryptedBytes = customType<{ data: Uint8Array }>({
  dataType: () => "ciphertext_bytes",
});

export const idempotencyRecords = pgTable("idempotency_records", {
  id: uuid("id").primaryKey(),
  schemaVersion: schemaVersion(),
  actor: text("actor").notNull(),
  operation: text("operation").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  canonicalRequestHash: text("canonical_request_hash").notNull(),
  status: text("status")
    .$type<"IN_PROGRESS" | "SUCCEEDED" | "FAILED">()
    .notNull(),
  safeResultReference: text("safe_result_reference"),
  expiresAt: requiredTimestamp("expires_at"),
  createdAt: transactionTimestamp("created_at"),
  updatedAt: transactionTimestamp("updated_at"),
});

export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").primaryKey(),
  schemaVersion: schemaVersion(),
  eventType: text("event_type").notNull(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: uuid("aggregate_id").notNull(),
  aggregateVersion: requiredVersion("aggregate_version"),
  primarySubjectId: uuid("primary_subject_id").notNull(),
  secondarySubjectId: uuid("secondary_subject_id"),
  locale: text("locale"),
  market: text("market"),
  currency: text("currency"),
  idempotencyKey: text("idempotency_key").notNull(),
  correlationId: uuid("correlation_id").notNull(),
  causationId: uuid("causation_id"),
  requestId: uuid("request_id").notNull(),
  traceId: text("trace_id"),
  occurredAt: requiredTimestamp("occurred_at"),
  availableAt: requiredTimestamp("available_at"),
  createdAt: transactionTimestamp("created_at"),
  payloadStatus: text("payload_status"),
});

export const inventoryLocations = pgTable("inventory_locations", {
  id: uuid("id").primaryKey(),
  schemaVersion: schemaVersion(),
  locationKey: text("location_key").notNull(),
  status: text("status").$type<"ACTIVE" | "PAUSED" | "ARCHIVED">().notNull(),
  createdAt: transactionTimestamp("created_at"),
});

export const inventoryItems = pgTable("inventory_items", {
  id: uuid("id").primaryKey(),
  schemaVersion: schemaVersion(),
  giftVariantId: uuid("gift_variant_id").notNull(),
  sku: text("sku").notNull(),
  policy: text("policy")
    .$type<"TRACKED" | "PROCURE_ON_DEMAND" | "PREORDER">()
    .notNull(),
  status: text("status").$type<"ACTIVE" | "PAUSED" | "ARCHIVED">().notNull(),
  createdAt: transactionTimestamp("created_at"),
});

export const inventoryBalances = pgTable("inventory_balances", {
  schemaVersion: schemaVersion(),
  inventoryItemId: uuid("inventory_item_id").notNull(),
  locationId: uuid("location_id").notNull(),
  onHand: quantity("on_hand").default(0),
  reserved: quantity("reserved").default(0),
  version: version(),
  updatedAt: transactionTimestamp("updated_at"),
});

export const inventoryReservations = pgTable("inventory_reservations", {
  id: uuid("id").primaryKey(),
  schemaVersion: schemaVersion(),
  inventoryItemId: uuid("inventory_item_id").notNull(),
  giftVariantId: uuid("gift_variant_id").notNull(),
  locationId: uuid("location_id").notNull(),
  checkoutSessionId: uuid("checkout_session_id").notNull(),
  checkoutQuoteId: uuid("checkout_quote_id").notNull(),
  cartItemId: uuid("cart_item_id").notNull(),
  lockedOrderId: uuid("locked_order_id"),
  quantity: quantity("quantity"),
  status: text("status")
    .$type<"ACTIVE" | "COMMITTED" | "RELEASED" | "EXPIRED">()
    .notNull(),
  version: version(),
  expiresAt: requiredTimestamp("expires_at"),
  createdAt: transactionTimestamp("created_at"),
  updatedAt: transactionTimestamp("updated_at"),
  committedAt: timestampWithTimezone("committed_at"),
  releasedAt: timestampWithTimezone("released_at"),
  expiredAt: timestampWithTimezone("expired_at"),
});

export const inventoryLedger = pgTable("inventory_ledger", {
  id: uuid("id").primaryKey(),
  schemaVersion: schemaVersion(),
  inventoryItemId: uuid("inventory_item_id").notNull(),
  locationId: uuid("location_id").notNull(),
  reservationId: uuid("reservation_id"),
  balanceVersionBefore: quantity("balance_version_before"),
  balanceVersionAfter: requiredVersion("balance_version_after"),
  deltaOnHand: quantity("delta_on_hand"),
  deltaReserved: quantity("delta_reserved"),
  reasonCode: text("reason_code").notNull(),
  sourceType: text("source_type")
    .$type<"RESERVATION" | "PAYMENT" | "EXPIRY" | "RECONCILE" | "ADJUSTMENT">()
    .notNull(),
  sourceId: uuid("source_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  actorKind: text("actor_kind")
    .$type<"ADMIN" | "SYSTEM" | "IMPORT">()
    .notNull(),
  adminIdentityId: uuid("admin_identity_id"),
  taskName: text("task_name"),
  importBatchId: uuid("import_batch_id"),
  occurredAt: transactionTimestamp("occurred_at"),
});

export const paymentAttempts = pgTable("payment_attempts", {
  id: uuid("id").primaryKey(),
  schemaVersion: schemaVersion(),
  orderId: uuid("order_id").notNull(),
  providerAccountId: uuid("provider_account_id").notNull(),
  environment: text("environment").$type<"TEST" | "LIVE">().notNull(),
  configVersionId: uuid("config_version_id").notNull(),
  configVersion: requiredVersion("config_version"),
  routeRuleId: uuid("route_rule_id").notNull(),
  ruleVersion: requiredVersion("rule_version"),
  paymentMethod: text("payment_method").notNull(),
  status: text("status")
    .$type<
      | "CREATED"
      | "REQUIRES_ACTION"
      | "PROCESSING"
      | "SUCCEEDED"
      | "FAILED"
      | "CANCELED"
      | "EXPIRED"
      | "UNKNOWN"
    >()
    .notNull(),
  amountMinor: quantity("amount_minor"),
  currency: text("currency").notNull(),
  requestedLocale: text("requested_locale").notNull(),
  providerLocale: text("provider_locale").notNull(),
  providerLocaleFallbackUsed: boolean(
    "provider_locale_fallback_used",
  ).notNull(),
  merchantReference: text("merchant_reference").notNull(),
  providerIdempotencyKey: text("provider_idempotency_key").notNull(),
  externalReference: text("external_reference"),
  providerCallStarted: boolean("provider_call_started")
    .notNull()
    .default(false),
  actionType: text("action_type").$type<
    | "REDIRECT"
    | "PROVIDER_HOSTED_IFRAME"
    | "PROVIDER_COMPONENT"
    | "QR_CODE"
    | "WAIT"
  >(),
  actionCiphertext: encryptedBytes("action_ciphertext"),
  actionEncryptedDataKey: binary("action_encrypted_data_key"),
  actionKeyVersion: text("action_key_version"),
  actionExpiresAt: timestampWithTimezone("action_expires_at"),
  actionPollAfterMs: integer("action_poll_after_ms"),
  returnStateDigest: binary("return_state_digest").notNull(),
  returnStateExpiresAt: requiredTimestamp("return_state_expires_at"),
  statusEvidenceKind: text("status_evidence_kind").notNull(),
  providerEventId: uuid("provider_event_id"),
  evidenceAuditLogId: uuid("evidence_audit_log_id"),
  evidenceReasonCode: text("evidence_reason_code"),
  refundOccupiedMinor: quantity("refund_occupied_minor").default(0),
  version: version(),
  createdAt: transactionTimestamp("created_at"),
  updatedAt: transactionTimestamp("updated_at"),
  succeededAt: timestampWithTimezone("succeeded_at"),
  terminatedAt: timestampWithTimezone("terminated_at"),
});

export const webhookPayloads = pgTable("webhook_payloads", {
  id: uuid("id").primaryKey(),
  schemaVersion: schemaVersion(),
  payloadCiphertext: encryptedBytes("payload_ciphertext"),
  encryptedDataKey: binary("encrypted_data_key"),
  encryptionKeyVersion: text("encryption_key_version"),
  payloadSha256: text("payload_sha256").notNull(),
  status: text("status").$type<"RETAINED" | "PURGED">().notNull(),
  retentionExpiresAt: requiredTimestamp("retention_expires_at"),
  createdAt: transactionTimestamp("created_at"),
  purgedAt: timestampWithTimezone("purged_at"),
});
