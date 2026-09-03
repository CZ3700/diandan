#!/usr/bin/env node

import path from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import {
  EphemeralPostgresError,
  MigrationExecutionError,
  MigrationManifestError,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const expectedMigrationVersions = [
  "0001",
  "0002",
  "0003",
  "0004",
  "0005",
  "0006",
];
const lockObservationTimeoutMs = 10_000;

const ids = Object.freeze({
  admin: "10000000-0000-4000-8000-000000000001",
  configVersion: "10000000-0000-4000-8000-000000000002",
  merchant: "10000000-0000-4000-8000-000000000003",
  providerAccount: "10000000-0000-4000-8000-000000000004",
  providerHealthEvent: "10000000-0000-4000-8000-000000000040",
  webhookEndpointAudit: "10000000-0000-4000-8000-000000000043",
  providerConfig: "10000000-0000-4000-8000-000000000005",
  routeRule: "10000000-0000-4000-8000-000000000006",
  webhookEndpoint: "10000000-0000-4000-8000-000000000007",
  activeOrder: "10000000-0000-4000-8000-000000000010",
  capturedOrder: "10000000-0000-4000-8000-000000000011",
  capturedAttempt: "10000000-0000-4000-8000-000000000012",
  auditLog: "10000000-0000-4000-8000-000000000013",
  inventoryLedger: "10000000-0000-4000-8000-000000000014",
  webhookPayload: "10000000-0000-4000-8000-000000000015",
  webhookInbox: "10000000-0000-4000-8000-000000000016",
  seededOutbox: "10000000-0000-4000-8000-000000000017",
  inventoryItem: "10000000-0000-4000-8000-000000000018",
  inventoryLocation: "10000000-0000-4000-8000-000000000019",
  activeAttemptA: "20000000-0000-4000-8000-000000000001",
  activeAttemptB: "20000000-0000-4000-8000-000000000002",
  activeAttemptEventA: "20000000-0000-4000-8000-000000000003",
  activeAttemptOutboxA: "20000000-0000-4000-8000-000000000004",
  refundA: "30000000-0000-4000-8000-000000000001",
  refundB: "30000000-0000-4000-8000-000000000002",
  refundItemA: "30000000-0000-4000-8000-000000000003",
  refundEventA: "30000000-0000-4000-8000-000000000004",
  refundOutboxA: "30000000-0000-4000-8000-000000000005",
  refundOrderItemA: "30000000-0000-4000-8000-000000000006",
  refundAuditA: "30000000-0000-4000-8000-000000000007",
  refundAuditB: "30000000-0000-4000-8000-000000000008",
  mismatchRefund: "40000000-0000-4000-8000-000000000001",
  mismatchRefundProviderEvent: "40000000-0000-4000-8000-000000000002",
  mismatchRefundAssociation: "40000000-0000-4000-8000-000000000003",
  mismatchDispute: "40000000-0000-4000-8000-000000000004",
  mismatchDisputeProviderEvent: "40000000-0000-4000-8000-000000000005",
  mismatchDisputeAssociation: "40000000-0000-4000-8000-000000000006",
  mismatchWebhookInbox: "40000000-0000-4000-8000-000000000007",
  mismatchWebhookPayload: "40000000-0000-4000-8000-000000000016",
  reconcileEvent: "40000000-0000-4000-8000-000000000008",
  reconcileStatusOutbox: "40000000-0000-4000-8000-000000000009",
  reconcileOrderOutbox: "40000000-0000-4000-8000-000000000010",
  mismatchRefundEvent: "40000000-0000-4000-8000-000000000011",
  mismatchRefundOutbox: "40000000-0000-4000-8000-000000000012",
  mismatchDisputeEvent: "40000000-0000-4000-8000-000000000013",
  mismatchDisputeOutbox: "40000000-0000-4000-8000-000000000014",
  mismatchRefundAudit: "40000000-0000-4000-8000-000000000015",
  shadowOrder: "50000000-0000-4000-8000-000000000001",
  shadowAttempt: "50000000-0000-4000-8000-000000000002",
  lateSuccessProviderEvent: "50000000-0000-4000-8000-000000000003",
  lateSuccessAssociation: "50000000-0000-4000-8000-000000000004",
  lateSuccessAudit: "50000000-0000-4000-8000-000000000005",
  lateSuccessAttemptEvent: "50000000-0000-4000-8000-000000000006",
  lateSuccessStatusOutbox: "50000000-0000-4000-8000-000000000007",
  lateSuccessOrderOutbox: "50000000-0000-4000-8000-000000000008",
});

class ConstraintHarnessError extends Error {}

function fail(message) {
  throw new ConstraintHarnessError(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(message);
  }
}

function assertDatabaseError(error, { code, messageIncludes, label }) {
  if (
    typeof error !== "object" ||
    error === null ||
    error.code !== code ||
    typeof error.message !== "string" ||
    !error.message.includes(messageIncludes)
  ) {
    const actualCode =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "unknown";
    const actualMessage =
      typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : "unknown";
    fail(
      `${label} returned an unexpected database error (${actualCode}: ${actualMessage})`,
    );
  }
}

async function expectDatabaseFailure(client, query, expectation) {
  let failure;
  try {
    await client.query(query);
  } catch (error) {
    failure = error;
  }
  if (failure === undefined) {
    fail(`${expectation.label} unexpectedly succeeded`);
  }
  assertDatabaseError(failure, expectation);
}

async function expectTransactionFailure(client, operation, expectation) {
  let failure;
  await client.query("BEGIN");
  try {
    await operation();
    await client.query("COMMIT");
  } catch (error) {
    failure = error;
  } finally {
    await rollbackQuietly(client);
  }
  if (failure === undefined) {
    fail(`${expectation.label} unexpectedly committed`);
  }
  assertDatabaseError(failure, expectation);
}

async function rollbackQuietly(client) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Closing the isolated connection is the final cleanup fallback.
  }
}

async function runCommittedTransaction(client, operation) {
  await client.query("BEGIN");
  try {
    await operation();
    await client.query("COMMIT");
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  }
}

async function endQuietly(client) {
  try {
    await client.end();
  } catch {
    // The ephemeral PostgreSQL harness owns process-level cleanup.
  }
}

async function observeLockWait(observer, workerPid, workerState, label) {
  const deadline = Date.now() + lockObservationTimeoutMs;
  while (Date.now() < deadline) {
    const result = await observer.query(
      `SELECT wait_event_type
         FROM pg_stat_activity
        WHERE pid = $1`,
      [workerPid],
    );
    if (result.rows[0]?.wait_event_type === "Lock") {
      return;
    }
    if (workerState.settled) {
      fail(`${label} settled before PostgreSQL exposed its lock wait`);
    }
    await yieldToEventLoop();
  }
  fail(`${label} did not reach an observable PostgreSQL lock wait`);
}

function trackQuery(queryPromise) {
  const state = { settled: false };
  const outcome = queryPromise.then(
    (result) => {
      state.settled = true;
      return { ok: true, result };
    },
    (error) => {
      state.settled = true;
      return { ok: false, error };
    },
  );
  return { state, outcome };
}

function createSuccessScenario(namespace, options) {
  const scenarioId = (value) =>
    `${namespace}-0000-4000-8000-${String(value).padStart(12, "0")}`;
  return Object.freeze({
    id: scenarioId,
    namespace,
    policies: options.policies,
    reservationStatuses: options.reservationStatuses ?? [],
    previousAttemptStatus: options.previousAttemptStatus ?? "PROCESSING",
    fulfillmentStatus: options.fulfillmentStatus ?? "PENDING",
    cart: scenarioId(1),
    order: scenarioId(2),
    attempt: scenarioId(3),
    providerEvent: scenarioId(4),
    association: scenarioId(5),
    orderEvent: scenarioId(6),
    initialAttemptEvent: scenarioId(7),
    successAttemptEvent: scenarioId(8),
    statusOutbox: scenarioId(9),
    orderOutbox: scenarioId(10),
    audit: scenarioId(11),
    request: scenarioId(12),
    correlation: scenarioId(13),
    orderCreatedEvent: scenarioId(14),
    orderCheckoutEvent: scenarioId(15),
    orderPendingEvent: scenarioId(16),
    unknownAttemptEvent: scenarioId(17),
    createdStatusOutbox: scenarioId(18),
    unknownStatusOutbox: scenarioId(19),
    webhookPayload: scenarioId(20),
    scenarioWebhookInbox: scenarioId(21),
    policyAcceptance: scenarioId(22),
  });
}

function successScenarioItemIds(scenario, index) {
  const offset = 100 + index * 20;
  return Object.freeze({
    orderItem: scenario.id(offset),
    cartItem: scenario.id(offset + 1),
    supportIntent: scenario.id(offset + 2),
    idol: scenario.id(offset + 3),
    idolTranslation: scenario.id(offset + 4),
    idolAsset: scenario.id(offset + 5),
    idolMetadata: scenario.id(offset + 6),
    idolAltTranslation: scenario.id(offset + 7),
    gift: scenario.id(offset + 8),
    giftVariant: scenario.id(offset + 9),
    giftTranslation: scenario.id(offset + 10),
    giftAsset: scenario.id(offset + 11),
    giftMetadata: scenario.id(offset + 12),
    giftAltTranslation: scenario.id(offset + 13),
    price: scenario.id(offset + 14),
    fulfillment: scenario.id(offset + 15),
    reservation: scenario.id(offset + 16),
    inventoryItem: scenario.id(offset + 17),
    inventoryLocation: scenario.id(offset + 18),
  });
}

function successScenarioTransitionIds(scenario, index) {
  const offset = 500 + index * 10;
  return Object.freeze({
    initialFulfillmentEvent: scenario.id(offset),
    terminalFulfillmentEvent: scenario.id(offset + 1),
    fulfillmentOutbox: scenario.id(offset + 2),
    initialLedger: scenario.id(offset + 3),
    reservationLedger: scenario.id(offset + 4),
    terminalLedger: scenario.id(offset + 5),
    fulfillmentProfile: scenario.id(offset + 6),
    checkoutQuoteLine: scenario.id(offset + 7),
  });
}

async function seedUnknownPaymentSuccessScenario(client, scenario) {
  const itemRows = scenario.policies.map((policy, index) => ({
    policy,
    reservationStatus: scenario.reservationStatuses[index] ?? null,
    ids: successScenarioItemIds(scenario, index),
    transitionIds: successScenarioTransitionIds(scenario, index),
  }));
  const subtotalMinor = itemRows.length * 1000;
  const tokenHex = scenario.namespace.at(-1);
  const variantValues = itemRows
    .map(
      ({ policy, ids: itemIds }, index) =>
        `('${itemIds.giftVariant}', '${itemIds.gift}', ` +
        `'UNKNOWN-SUCCESS-${scenario.namespace}-${index + 1}', 'active', '${policy}')`,
    )
    .join(",\n");
  const orderItemValues = itemRows
    .map(
      ({ ids: itemIds }, index) => `(
        '${itemIds.orderItem}', '${scenario.order}', '${itemIds.cartItem}',
        '${itemIds.supportIntent}', '${itemIds.idol}',
        'unknown-success-idol-${index + 1}', 'Unknown Success Idol ${index + 1}',
        '${itemIds.idolTranslation}', 'en', 'en', false,
        '${itemIds.idolAsset}', repeat('a', 64), 'unknown-success/idol-${index + 1}.webp',
        '${itemIds.idolMetadata}', 'Unknown success idol portrait ${index + 1}',
        '${itemIds.idolAltTranslation}', 'en', 'en', false,
        '${itemIds.gift}', '${itemIds.giftVariant}', 'Unknown Success Gift ${index + 1}',
        '${itemIds.giftTranslation}', 'en', 'en', false,
        '${itemIds.giftAsset}', repeat('b', 64), 'unknown-success/gift-${index + 1}.webp',
        '${itemIds.giftMetadata}', 'Unknown success gift image ${index + 1}',
        '${itemIds.giftAltTranslation}', 'en', 'en', false,
        '${itemIds.price}', 1, 1, 1000, 1000, 0, 0, 1000, 'USD', 'anonymous'
      )`,
    )
    .join(",\n");
  const fulfillmentValues = itemRows
    .map(
      ({ ids: itemIds, transitionIds }) =>
        `('${itemIds.fulfillment}', '${scenario.order}', '${itemIds.orderItem}', ` +
        `'${itemIds.idol}', '${transitionIds.fulfillmentProfile}', 'PENDING', NULL)`,
    )
    .join(",\n");
  const fulfillmentEventValues = itemRows
    .map(
      ({ ids: itemIds, transitionIds }) => `(
        '${transitionIds.initialFulfillmentEvent}', '${itemIds.fulfillment}',
        '${scenario.order}', 1, NULL, 'PENDING', 'SYSTEM',
        'FULFILLMENT_CREATED', '${scenario.request}', '${scenario.correlation}'
      )`,
    )
    .join(",\n");
  const fulfillmentProfileValues = itemRows
    .map(
      ({ ids: itemIds, transitionIds }) => `(
        '${transitionIds.fulfillmentProfile}', '${itemIds.idol}', 1, 'ACTIVE',
        decode(repeat('ab', 16), 'hex'), decode(repeat('cd', 16), 'hex'),
        'unknown-success-v1', '${ids.admin}'
      )`,
    )
    .join(",\n");
  const cartItemValues = itemRows
    .map(
      ({ ids: itemIds }) => `(
        '${itemIds.cartItem}', '${scenario.cart}', '${itemIds.giftVariant}',
        '${itemIds.price}', 1, 'anonymous', false,
        '${scenario.request}', '${scenario.correlation}'
      )`,
    )
    .join(",\n");
  const checkoutQuoteLineValues = itemRows
    .map(
      ({ ids: itemIds, transitionIds }) => `(
        '${transitionIds.checkoutQuoteLine}', '${scenario.id(80)}',
        '${scenario.id(81)}', '${itemIds.cartItem}', '${itemIds.giftVariant}',
        '${itemIds.price}', 1, 1, 1000, 1000, 0, 0, 1000
      )`,
    )
    .join(",\n");
  const trackedRows = itemRows.filter(({ policy }) => policy === "TRACKED");

  for (const { reservationStatus } of trackedRows) {
    if (!["ACTIVE", "EXPIRED"].includes(reservationStatus)) {
      fail(
        "UNKNOWN success fixture requires ACTIVE or EXPIRED tracked reservations",
      );
    }
  }

  await client.query("SET LOCAL session_replication_role = replica");
  await client.query(`
    INSERT INTO gift_variants (
      id, gift_id, sku, status, inventory_policy
    ) VALUES ${variantValues};

    INSERT INTO carts (
      id, token_digest, token_pepper_version, presentation_locale,
      market, currency, status, version, expires_at, locked_order_id
    ) VALUES (
      '${scenario.cart}', decode(repeat('${tokenHex}', 64), 'hex'),
      'unknown-success-v1', 'en', 'US', 'USD', 'LOCKED', 1,
      transaction_timestamp() + interval '1 hour', '${scenario.order}'
    );

    INSERT INTO orders (
      id, public_order_id, checkout_session_id, checkout_quote_id, cart_id,
      customer_contact_id, presentation_locale, market, currency,
      quote_revision, quote_expires_at, subtotal_minor, total_amount_minor,
      order_status, payment_status, dispute_status, fulfillment_status,
      current_payment_attempt_id, version
    ) VALUES (
      '${scenario.order}', '${scenario.id(70)}', '${scenario.id(80)}',
      '${scenario.id(81)}', '${scenario.cart}', '${scenario.id(82)}',
      'en', 'US', 'USD', 1, transaction_timestamp() + interval '1 hour',
      ${subtotalMinor}, ${subtotalMinor}, 'PENDING_PAYMENT', 'PENDING', 'NONE',
      'PENDING', '${scenario.attempt}', 3
    );

    INSERT INTO checkout_sessions (
      id, cart_id, quote_id, cart_version, status, market, currency,
      quote_revision, quote_expires_at, subtotal_minor, total_amount_minor,
      expires_at
    ) VALUES (
      '${scenario.id(80)}', '${scenario.cart}', '${scenario.id(81)}', 1,
      'PAYMENT_PENDING', 'US', 'USD', 1,
      transaction_timestamp() + interval '1 hour', ${subtotalMinor},
      ${subtotalMinor}, transaction_timestamp() + interval '1 hour'
    );

    INSERT INTO cart_items (
      id, cart_id, gift_variant_id, observed_price_id, quantity,
      display_mode, has_fan_message, request_id, correlation_id
    ) VALUES ${cartItemValues};

    INSERT INTO checkout_quote_lines (
      id, checkout_session_id, checkout_quote_id, cart_item_id,
      gift_variant_id, price_id, price_revision, quantity,
      unit_amount_minor, line_subtotal_minor, tax_amount_minor,
      discount_amount_minor, line_total_minor
    ) VALUES ${checkoutQuoteLineValues};

    INSERT INTO order_items (
      id, order_id, cart_item_id, support_intent_id, idol_id,
      idol_handle, idol_display_name, idol_translation_revision_id,
      idol_translation_requested_locale, idol_translation_resolved_locale,
      idol_translation_fallback_used, idol_portrait_asset_id,
      idol_portrait_checksum_sha256, idol_portrait_object_key,
      idol_portrait_metadata_revision_id, idol_portrait_alt,
      idol_portrait_alt_translation_revision_id,
      idol_portrait_alt_requested_locale, idol_portrait_alt_resolved_locale,
      idol_portrait_alt_fallback_used, gift_id, gift_variant_id, gift_title,
      gift_translation_revision_id, gift_translation_requested_locale,
      gift_translation_resolved_locale, gift_translation_fallback_used,
      gift_image_asset_id, gift_image_checksum_sha256, gift_image_object_key,
      gift_image_metadata_revision_id, gift_image_alt,
      gift_image_alt_translation_revision_id,
      gift_image_alt_requested_locale, gift_image_alt_resolved_locale,
      gift_image_alt_fallback_used, price_id, price_revision, quantity,
      unit_amount_minor, line_subtotal_minor, tax_amount_minor,
      discount_amount_minor, line_total_minor, currency, display_mode
    ) VALUES ${orderItemValues};

    INSERT INTO policy_acceptances (
      id, order_id, policy_key, policy_revision_id,
      policy_translation_revision_id, locale, accepted_at
    ) VALUES (
      '${scenario.policyAcceptance}', '${scenario.order}', 'terms',
      '${scenario.id(83)}', '${scenario.id(84)}', 'en', transaction_timestamp()
    );

    INSERT INTO idol_fulfillment_profiles (
      id, idol_id, profile_version, status, profile_ciphertext,
      encrypted_data_key, encryption_key_version, created_by
    ) VALUES ${fulfillmentProfileValues};

    INSERT INTO fulfillments (
      id, order_id, order_item_id, idol_id, fulfillment_profile_id,
      status, hold_reason_code
    ) VALUES ${fulfillmentValues};

    INSERT INTO fulfillment_events (
      id, fulfillment_id, order_id, sequence, from_status, to_status,
      authority_kind, reason_code, request_id, correlation_id
    ) VALUES ${fulfillmentEventValues};

    INSERT INTO order_events (
      id, order_id, sequence, event_type,
      from_order_status, to_order_status, from_payment_status, to_payment_status,
      from_dispute_status, to_dispute_status,
      from_fulfillment_status, to_fulfillment_status,
      from_payment_attempt_id, to_payment_attempt_id,
      authority_kind, reason_code, request_id, correlation_id
    ) VALUES
      (
        '${scenario.orderCreatedEvent}', '${scenario.order}', 1, 'ORDER_CREATED',
        NULL, 'DRAFT', NULL, 'UNPAID', NULL, 'NONE', NULL, 'PENDING',
        NULL, NULL, 'CHECKOUT', 'ORDER_CREATED',
        '${scenario.request}', '${scenario.correlation}'
      ),
      (
        '${scenario.orderCheckoutEvent}', '${scenario.order}', 2, 'LIFECYCLE_CHANGED',
        'DRAFT', 'PENDING_PAYMENT', 'UNPAID', 'UNPAID', 'NONE', 'NONE',
        'PENDING', 'PENDING', NULL, NULL, 'CHECKOUT', 'ORDER_CHECKOUT_CREATED',
        '${scenario.request}', '${scenario.correlation}'
      ),
      (
        '${scenario.orderPendingEvent}', '${scenario.order}', 3, 'PAYMENT_STATUS_CHANGED',
        'PENDING_PAYMENT', 'PENDING_PAYMENT', 'UNPAID', 'PENDING', 'NONE', 'NONE',
        'PENDING', 'PENDING', NULL, '${scenario.attempt}', 'CHECKOUT',
        'ORDER_PAYMENT_ATTEMPT_CREATED', '${scenario.request}', '${scenario.correlation}'
      );

    SET LOCAL session_replication_role = origin;

    INSERT INTO payment_attempts (
      id, order_id, provider_account_id, environment, config_version_id,
      config_version, route_rule_id, rule_version, payment_method, status,
      amount_minor, currency, requested_locale, provider_locale,
      provider_locale_fallback_used, merchant_reference,
      provider_idempotency_key, external_reference, provider_call_started,
      return_state_digest, return_state_expires_at, status_evidence_kind, version
    ) VALUES (
      '${scenario.attempt}', '${scenario.order}', '${ids.providerAccount}', 'TEST',
      '${ids.configVersion}', 1, '${ids.routeRule}', 1, 'card', 'CREATED',
      ${subtotalMinor}, 'USD', 'en', 'en', false, '${scenario.attempt}',
      '${scenario.attempt}', NULL, false,
      decode(repeat('6', 64), 'hex'), transaction_timestamp() + interval '1 hour',
      'ATTEMPT_CREATED', 1
    );

    INSERT INTO payment_attempt_events (
      id, payment_attempt_id, sequence, from_status, to_status,
      reason_code, evidence_kind, request_id, correlation_id
    ) VALUES (
      '${scenario.initialAttemptEvent}', '${scenario.attempt}', 1, NULL,
      'CREATED', 'ATTEMPT_CREATED', 'ATTEMPT_CREATED',
      '${scenario.request}', '${scenario.correlation}'
    );

    INSERT INTO outbox_events (
      id, event_type, aggregate_type, aggregate_id, aggregate_version,
      primary_subject_id, secondary_subject_id, locale, market, currency,
      idempotency_key, correlation_id, request_id, occurred_at, available_at
    ) VALUES (
      '${scenario.createdStatusOutbox}', 'PAYMENT_STATUS_CHANGED',
      'PAYMENT_ATTEMPT', '${scenario.attempt}', 1, '${scenario.attempt}',
      '${scenario.order}', 'en', 'US', 'USD',
      'payment-created:${scenario.attempt}', '${scenario.correlation}',
      '${scenario.request}', transaction_timestamp(), transaction_timestamp()
    );
  `);

  await client.query("SET LOCAL session_replication_role = replica");
  for (const {
    reservationStatus,
    ids: itemIds,
    transitionIds,
  } of trackedRows) {
    const expiresInFuture = reservationStatus === "ACTIVE";
    await client.query(`
      INSERT INTO inventory_items (
        id, gift_variant_id, sku, policy, status
      ) VALUES (
        '${itemIds.inventoryItem}', '${itemIds.giftVariant}',
        'UNKNOWN-SUCCESS-${scenario.namespace}-${itemIds.inventoryItem}',
        'TRACKED', 'ACTIVE'
      );

      INSERT INTO inventory_locations (id, location_key, status)
      VALUES (
        '${itemIds.inventoryLocation}',
        'UNKS_${scenario.namespace}_${itemIds.inventoryLocation.slice(-4)}',
        'ACTIVE'
      );

      INSERT INTO inventory_balances (
        inventory_item_id, location_id, on_hand, reserved, version
      ) VALUES (
        '${itemIds.inventoryItem}', '${itemIds.inventoryLocation}',
        10, 1, 2
      );

      INSERT INTO inventory_reservations (
        id, inventory_item_id, gift_variant_id, location_id,
        checkout_session_id, checkout_quote_id, cart_item_id, locked_order_id,
        quantity, status, version, created_at, expires_at, updated_at,
        committed_at, released_at, expired_at
      ) VALUES (
        '${itemIds.reservation}', '${itemIds.inventoryItem}', '${itemIds.giftVariant}',
        '${itemIds.inventoryLocation}', '${scenario.id(80)}', '${scenario.id(81)}',
        '${itemIds.cartItem}', '${scenario.order}', 1, 'ACTIVE', 1,
        transaction_timestamp() - interval '2 hours',
        transaction_timestamp() ${expiresInFuture ? "+ interval '1 hour'" : "- interval '1 hour'"},
        transaction_timestamp() - interval '30 minutes', NULL, NULL, NULL
      );

      INSERT INTO inventory_ledger (
        id, inventory_item_id, location_id, reservation_id,
        balance_version_before, balance_version_after, delta_on_hand,
        delta_reserved, reason_code, source_type, source_id,
        idempotency_key, actor_kind, task_name
      ) VALUES
        (
          '${transitionIds.initialLedger}', '${itemIds.inventoryItem}',
          '${itemIds.inventoryLocation}', NULL, 0, 1, 10, 0,
          'INITIALIZE', 'ADJUSTMENT', '${transitionIds.initialLedger}',
          'unknown-success-initial:${scenario.namespace}:${itemIds.inventoryItem}',
          'SYSTEM', 'postgres-constraints'
        ),
        (
          '${transitionIds.reservationLedger}', '${itemIds.inventoryItem}',
          '${itemIds.inventoryLocation}', '${itemIds.reservation}', 1, 2, 0, 1,
          'RESERVATION_CREATED', 'RESERVATION', '${itemIds.reservation}',
          'unknown-success-reserve:${scenario.namespace}:${itemIds.inventoryItem}',
          'SYSTEM', 'postgres-constraints'
        );
    `);
  }
  await client.query("SET LOCAL session_replication_role = origin");
}

async function seedPaymentSuccessScenario(client, scenario) {
  if (scenario.previousAttemptStatus === "UNKNOWN") {
    await seedUnknownPaymentSuccessScenario(client, scenario);
    return;
  }
  const itemRows = scenario.policies.map((policy, index) => ({
    policy,
    reservationStatus: scenario.reservationStatuses[index] ?? null,
    ids: successScenarioItemIds(scenario, index),
  }));
  const subtotalMinor = itemRows.length * 1000;
  const priorReason =
    scenario.previousAttemptStatus === "UNKNOWN"
      ? "NETWORK_UNCERTAINTY"
      : "CREATE_RESULT";
  const orderEventType =
    scenario.previousAttemptStatus === "UNKNOWN"
      ? "LATE_PAYMENT_RECOVERED"
      : "PAYMENT_STATUS_CHANGED";
  const orderEventFromStatus =
    scenario.previousAttemptStatus === "UNKNOWN"
      ? "CANCELED"
      : "PENDING_PAYMENT";
  const tokenHex = scenario.namespace.at(-1);

  const variantValues = itemRows
    .map(
      ({ policy, ids: itemIds }, index) =>
        `('${itemIds.giftVariant}', '${itemIds.gift}', ` +
        `'SCENARIO-${scenario.namespace}-${index + 1}', 'active', '${policy}')`,
    )
    .join(",\n");
  const orderItemValues = itemRows
    .map(
      ({ ids: itemIds }, index) => `(
        '${itemIds.orderItem}', '${scenario.order}', '${itemIds.cartItem}',
        '${itemIds.supportIntent}', '${itemIds.idol}',
        'scenario-idol-${index + 1}', 'Scenario Idol ${index + 1}',
        '${itemIds.idolTranslation}', 'en', 'en', false,
        '${itemIds.idolAsset}', repeat('a', 64), 'scenario/idol-${index + 1}.webp',
        '${itemIds.idolMetadata}', 'Scenario idol portrait ${index + 1}',
        '${itemIds.idolAltTranslation}', 'en', 'en', false,
        '${itemIds.gift}', '${itemIds.giftVariant}', 'Scenario Gift ${index + 1}',
        '${itemIds.giftTranslation}', 'en', 'en', false,
        '${itemIds.giftAsset}', repeat('b', 64), 'scenario/gift-${index + 1}.webp',
        '${itemIds.giftMetadata}', 'Scenario gift image ${index + 1}',
        '${itemIds.giftAltTranslation}', 'en', 'en', false,
        '${itemIds.price}', 1, 1, 1000, 1000, 0, 0, 1000, 'USD', 'anonymous'
      )`,
    )
    .join(",\n");
  const fulfillmentValues = itemRows
    .map(({ ids: itemIds }) => {
      const holdReason =
        scenario.fulfillmentStatus === "ON_HOLD"
          ? "'INVENTORY_UNAVAILABLE'"
          : "NULL";
      return `('${itemIds.fulfillment}', '${scenario.order}', '${itemIds.orderItem}',
        '${itemIds.idol}', '${scenario.id(90)}', '${scenario.fulfillmentStatus}', ${holdReason})`;
    })
    .join(",\n");
  const reservationValues = itemRows
    .filter(({ reservationStatus }) => reservationStatus !== null)
    .map(({ reservationStatus, ids: itemIds }) => {
      const committedAt =
        reservationStatus === "COMMITTED" ? "transaction_timestamp()" : "NULL";
      const expiredAt =
        reservationStatus === "EXPIRED"
          ? "transaction_timestamp() - interval '30 minutes'"
          : "NULL";
      return `(
        '${itemIds.reservation}', '${itemIds.inventoryItem}', '${itemIds.giftVariant}',
        '${itemIds.inventoryLocation}', '${scenario.id(80)}', '${scenario.id(81)}',
        '${itemIds.cartItem}', '${scenario.order}', 1, '${reservationStatus}', 2,
        transaction_timestamp() - interval '2 hours',
        transaction_timestamp() - interval '1 hour', transaction_timestamp(),
        ${committedAt}, NULL, ${expiredAt}
      )`;
    });

  await client.query("SET LOCAL session_replication_role = replica");
  await client.query(`
    INSERT INTO gift_variants (
      id, gift_id, sku, status, inventory_policy
    ) VALUES ${variantValues};

    INSERT INTO carts (
      id, token_digest, token_pepper_version, presentation_locale,
      market, currency, status, version, expires_at, locked_order_id
    ) VALUES (
      '${scenario.cart}', decode(repeat('${tokenHex}', 64), 'hex'),
      'scenario-v1', 'en', 'US', 'USD', 'CONVERTED', 2,
      transaction_timestamp() + interval '1 hour', '${scenario.order}'
    );

    INSERT INTO orders (
      id, public_order_id, checkout_session_id, checkout_quote_id, cart_id,
      customer_contact_id, presentation_locale, market, currency,
      quote_revision, quote_expires_at, subtotal_minor, total_amount_minor,
      order_status, payment_status, dispute_status, fulfillment_status,
      current_payment_attempt_id, version
    ) VALUES (
      '${scenario.order}', '${scenario.id(70)}', '${scenario.id(80)}',
      '${scenario.id(81)}', '${scenario.cart}', '${scenario.id(82)}',
      'en', 'US', 'USD', 1, transaction_timestamp() + interval '1 hour',
      ${subtotalMinor}, ${subtotalMinor}, 'OPEN', 'PAID', 'NONE',
      '${scenario.fulfillmentStatus}', '${scenario.attempt}', 2
    );

    INSERT INTO order_items (
      id, order_id, cart_item_id, support_intent_id, idol_id,
      idol_handle, idol_display_name, idol_translation_revision_id,
      idol_translation_requested_locale, idol_translation_resolved_locale,
      idol_translation_fallback_used, idol_portrait_asset_id,
      idol_portrait_checksum_sha256, idol_portrait_object_key,
      idol_portrait_metadata_revision_id, idol_portrait_alt,
      idol_portrait_alt_translation_revision_id,
      idol_portrait_alt_requested_locale, idol_portrait_alt_resolved_locale,
      idol_portrait_alt_fallback_used, gift_id, gift_variant_id, gift_title,
      gift_translation_revision_id, gift_translation_requested_locale,
      gift_translation_resolved_locale, gift_translation_fallback_used,
      gift_image_asset_id, gift_image_checksum_sha256, gift_image_object_key,
      gift_image_metadata_revision_id, gift_image_alt,
      gift_image_alt_translation_revision_id,
      gift_image_alt_requested_locale, gift_image_alt_resolved_locale,
      gift_image_alt_fallback_used, price_id, price_revision, quantity,
      unit_amount_minor, line_subtotal_minor, tax_amount_minor,
      discount_amount_minor, line_total_minor, currency, display_mode
    ) VALUES ${orderItemValues};

    INSERT INTO fulfillments (
      id, order_id, order_item_id, idol_id, fulfillment_profile_id,
      status, hold_reason_code
    ) VALUES ${fulfillmentValues};

    INSERT INTO order_events (
      id, order_id, sequence, event_type,
      from_order_status, to_order_status, from_payment_status, to_payment_status,
      from_dispute_status, to_dispute_status,
      from_fulfillment_status, to_fulfillment_status,
      from_payment_attempt_id, to_payment_attempt_id,
      authority_kind, reason_code, provider_event_id, request_id, correlation_id
    ) VALUES (
      '${scenario.orderEvent}', '${scenario.order}', 2, '${orderEventType}',
      '${orderEventFromStatus}', 'OPEN', 'PENDING', 'PAID', 'NONE', 'NONE',
      '${scenario.fulfillmentStatus}', '${scenario.fulfillmentStatus}',
      '${scenario.attempt}', '${scenario.attempt}', 'PROVIDER_EVIDENCE',
      '${orderEventType === "LATE_PAYMENT_RECOVERED" ? "LATE_PAYMENT_INVENTORY_UNAVAILABLE" : "ORDER_PAYMENT_CONFIRMED"}',
      '${scenario.providerEvent}', '${scenario.request}', '${scenario.correlation}'
    );

    INSERT INTO payment_attempts (
      id, order_id, provider_account_id, environment, config_version_id,
      config_version, route_rule_id, rule_version, payment_method, status,
      amount_minor, currency, requested_locale, provider_locale,
      provider_locale_fallback_used, merchant_reference,
      provider_idempotency_key, external_reference, provider_call_started,
      return_state_digest, return_state_expires_at, status_evidence_kind, version
    ) VALUES (
      '${scenario.attempt}', '${scenario.order}', '${ids.providerAccount}', 'TEST',
      '${ids.configVersion}', 1, '${ids.routeRule}', 1, 'card',
      '${scenario.previousAttemptStatus}', ${subtotalMinor}, 'USD', 'en', 'en', false,
      '${scenario.attempt}', '${scenario.attempt}',
      'capture.${scenario.namespace}', true, decode(repeat('6', 64), 'hex'),
      transaction_timestamp() + interval '1 hour', '${priorReason}', 1
    );

    INSERT INTO payment_attempt_events (
      id, payment_attempt_id, sequence, from_status, to_status,
      reason_code, evidence_kind, request_id, correlation_id
    ) VALUES (
      '${scenario.initialAttemptEvent}', '${scenario.attempt}', 1, NULL,
      '${scenario.previousAttemptStatus}', '${priorReason}', '${priorReason}',
      '${scenario.request}', '${scenario.correlation}'
    );

    INSERT INTO provider_events (
      id, provider_account_id, environment, provider_event_id,
      evidence_kind, webhook_inbox_id, event_type, normalized_status, external_payment_reference,
      amount_minor, currency, occurred_at
    ) VALUES (
      '${scenario.providerEvent}', '${ids.providerAccount}', 'TEST',
      'scenario.${scenario.namespace}', 'VERIFIED_WEBHOOK', '${ids.webhookInbox}', 'PAYMENT_STATUS',
      'SUCCEEDED', 'capture.${scenario.namespace}', ${subtotalMinor}, 'USD',
      transaction_timestamp()
    );

    INSERT INTO provider_event_associations (
      id, provider_event_id, association_status, payment_attempt_id, reason_code
    ) VALUES (
      '${scenario.association}', '${scenario.providerEvent}', 'MATCHED',
      '${scenario.attempt}', 'MATCHED_BY_REFERENCE'
    );
  `);
  if (reservationValues.length > 0) {
    await client.query(`
      INSERT INTO inventory_reservations (
        id, inventory_item_id, gift_variant_id, location_id,
        checkout_session_id, checkout_quote_id, cart_item_id, locked_order_id,
        quantity, status, version, created_at, expires_at, updated_at,
        committed_at, released_at, expired_at
      ) VALUES ${reservationValues.join(",\n")}
    `);
  }
  await client.query("SET LOCAL session_replication_role = origin");
}

async function transitionPaymentAttemptToUnknown(client, scenario) {
  await client.query(
    `UPDATE payment_attempts
        SET status = 'UNKNOWN', provider_call_started = true,
            external_reference = $2, status_evidence_kind = 'NETWORK_UNCERTAINTY',
            version = 2,
            updated_at = greatest(transaction_timestamp(), updated_at + interval '1 microsecond')
      WHERE id = $1`,
    [scenario.attempt, `capture.${scenario.namespace}`],
  );
  await client.query(
    `INSERT INTO payment_attempt_events (
       id, payment_attempt_id, sequence, from_status, to_status,
       reason_code, evidence_kind, request_id, correlation_id
     ) VALUES (
       $1, $2, 2, 'CREATED', 'UNKNOWN', 'NETWORK_UNCERTAINTY',
       'NETWORK_UNCERTAINTY', $3, $4
     )`,
    [
      scenario.unknownAttemptEvent,
      scenario.attempt,
      scenario.request,
      scenario.correlation,
    ],
  );
  await client.query(
    `INSERT INTO outbox_events (
       id, event_type, aggregate_type, aggregate_id, aggregate_version,
       primary_subject_id, secondary_subject_id, locale, market, currency,
       idempotency_key, correlation_id, request_id, occurred_at, available_at
     ) VALUES (
       $1, 'PAYMENT_STATUS_CHANGED', 'PAYMENT_ATTEMPT', $2, 2,
       $2, $3, 'en', 'US', 'USD', $4, $5, $6,
       transaction_timestamp(), transaction_timestamp()
     )`,
    [
      scenario.unknownStatusOutbox,
      scenario.attempt,
      scenario.order,
      `payment-unknown:${scenario.attempt}`,
      scenario.correlation,
      scenario.request,
    ],
  );
}

async function expireUnknownSuccessReservations(client, scenario) {
  const trackedRows = scenario.policies
    .map((policy, index) => ({
      policy,
      targetStatus: scenario.reservationStatuses[index] ?? null,
      ids: successScenarioItemIds(scenario, index),
      transitionIds: successScenarioTransitionIds(scenario, index),
    }))
    .filter(
      ({ policy, targetStatus }) =>
        policy === "TRACKED" && targetStatus === "EXPIRED",
    );

  for (const { ids: itemIds, transitionIds } of trackedRows) {
    await client.query(
      `UPDATE inventory_reservations
          SET status = 'EXPIRED', version = 2,
              updated_at = greatest(transaction_timestamp(), updated_at + interval '1 microsecond'),
              expired_at = greatest(transaction_timestamp(), created_at)
        WHERE id = $1`,
      [itemIds.reservation],
    );
    await client.query(
      `UPDATE inventory_balances
          SET reserved = reserved - 1, version = 3,
              updated_at = transaction_timestamp()
        WHERE inventory_item_id = $1 AND location_id = $2`,
      [itemIds.inventoryItem, itemIds.inventoryLocation],
    );
    await client.query(
      `INSERT INTO inventory_ledger (
         id, inventory_item_id, location_id, reservation_id,
         balance_version_before, balance_version_after, delta_on_hand,
         delta_reserved, reason_code, source_type, source_id,
         idempotency_key, actor_kind, task_name
       ) VALUES (
         $1, $2, $3, $4, 2, 3, 0, -1, 'RESERVATION_EXPIRED',
         'EXPIRY', $4, $5, 'SYSTEM', 'postgres-constraints'
       )`,
      [
        transitionIds.terminalLedger,
        itemIds.inventoryItem,
        itemIds.inventoryLocation,
        itemIds.reservation,
        `unknown-success-expired:${scenario.namespace}:${itemIds.inventoryItem}`,
      ],
    );
  }
}

async function prepareUnknownPaymentSuccessScenario(client, scenario) {
  await runCommittedTransaction(client, async () => {
    await seedUnknownPaymentSuccessScenario(client, scenario);
  });
  await runCommittedTransaction(client, async () => {
    await transitionPaymentAttemptToUnknown(client, scenario);
  });
  if (scenario.reservationStatuses.includes("EXPIRED")) {
    await runCommittedTransaction(client, async () => {
      await expireUnknownSuccessReservations(client, scenario);
    });
  }
}

async function applyUnknownPaymentSuccess(
  client,
  scenario,
  { includeLateAudit },
) {
  const itemRows = scenario.policies.map((policy, index) => ({
    policy,
    reservationStatus: scenario.reservationStatuses[index] ?? null,
    ids: successScenarioItemIds(scenario, index),
    transitionIds: successScenarioTransitionIds(scenario, index),
  }));
  const unavailable = itemRows.some(({ reservationStatus }) =>
    ["EXPIRED", "RELEASED"].includes(reservationStatus),
  );
  const finalFulfillmentStatus = unavailable ? "ON_HOLD" : "PENDING";
  const auditReason = unavailable
    ? "LATE_PAYMENT_INVENTORY_UNAVAILABLE"
    : "PAYMENT_SUCCESS_RECONCILED";

  if (scenario.fulfillmentStatus !== finalFulfillmentStatus) {
    fail(
      "UNKNOWN success fixture fulfillment status does not match inventory state",
    );
  }

  const payloadHash = scenario.namespace.at(-1).repeat(64);
  await client.query(
    `INSERT INTO webhook_payloads (
       id, payload_ciphertext, encrypted_data_key, encryption_key_version,
       payload_sha256, status, retention_expires_at
     ) VALUES (
       $1, decode(repeat('ab', 16), 'hex'), decode(repeat('cd', 16), 'hex'),
       1, $2, 'RETAINED', transaction_timestamp() + interval '7 days'
     )`,
    [scenario.webhookPayload, payloadHash],
  );
  await client.query(
    `INSERT INTO webhook_inbox (
       id, provider_account_id, environment, endpoint_id, provider_event_id,
       webhook_payload_id, payload_sha256, signature_verified,
       verification_key_reference_hash, signature_timestamp
     ) VALUES (
       $1, $2, 'TEST', $3, $4, $5, $6, true, repeat('5', 64),
       transaction_timestamp()
     )`,
    [
      scenario.scenarioWebhookInbox,
      ids.providerAccount,
      ids.webhookEndpoint,
      `unknown-success.${scenario.namespace}`,
      scenario.webhookPayload,
      payloadHash,
    ],
  );
  await client.query(
    `INSERT INTO provider_events (
       id, provider_account_id, environment, provider_event_id,
       evidence_kind, webhook_inbox_id, event_type, normalized_status,
       external_payment_reference, amount_minor, currency, occurred_at
     ) VALUES (
       $1, $2, 'TEST', $3, 'VERIFIED_WEBHOOK', $4, 'PAYMENT_STATUS',
       'SUCCEEDED', $5, $6, 'USD', transaction_timestamp()
     )`,
    [
      scenario.providerEvent,
      ids.providerAccount,
      `unknown-success.${scenario.namespace}`,
      scenario.scenarioWebhookInbox,
      `capture.${scenario.namespace}`,
      itemRows.length * 1000,
    ],
  );
  await client.query(
    `INSERT INTO provider_event_associations (
       id, provider_event_id, association_status, payment_attempt_id, reason_code
     ) VALUES ($1, $2, 'MATCHED', $3, 'MATCHED_BY_REFERENCE')`,
    [scenario.association, scenario.providerEvent, scenario.attempt],
  );

  if (includeLateAudit) {
    await client.query(
      `INSERT INTO audit_logs (
         id, actor_type, task_name, action, subject_type, subject_id,
         reason_code, request_id, correlation_id, outcome
       ) VALUES (
         $1, 'SYSTEM', 'payment-reconcile', 'LATE_PAYMENT_SUCCESS_APPLIED',
         'PAYMENT_ATTEMPT', $2, $3, $4, $5, 'SUCCEEDED'
       )`,
      [
        scenario.audit,
        scenario.attempt,
        auditReason,
        scenario.request,
        scenario.correlation,
      ],
    );
  }

  for (const { reservationStatus, ids: itemIds, transitionIds } of itemRows) {
    if (reservationStatus !== "ACTIVE") {
      continue;
    }
    await client.query(
      `UPDATE inventory_reservations
          SET status = 'COMMITTED', version = 2,
              updated_at = greatest(transaction_timestamp(), updated_at + interval '1 microsecond'),
              committed_at = greatest(transaction_timestamp(), created_at)
        WHERE id = $1`,
      [itemIds.reservation],
    );
    await client.query(
      `UPDATE inventory_balances
          SET on_hand = on_hand - 1, reserved = reserved - 1,
              version = 3, updated_at = transaction_timestamp()
        WHERE inventory_item_id = $1 AND location_id = $2`,
      [itemIds.inventoryItem, itemIds.inventoryLocation],
    );
    await client.query(
      `INSERT INTO inventory_ledger (
         id, inventory_item_id, location_id, reservation_id,
         balance_version_before, balance_version_after, delta_on_hand,
         delta_reserved, reason_code, source_type, source_id,
         idempotency_key, actor_kind, task_name
       ) VALUES (
         $1, $2, $3, $4, 2, 3, -1, -1, 'RESERVATION_COMMITTED',
         'PAYMENT', $5, $6, 'SYSTEM', 'payment-reconcile'
       )`,
      [
        transitionIds.terminalLedger,
        itemIds.inventoryItem,
        itemIds.inventoryLocation,
        itemIds.reservation,
        scenario.order,
        `unknown-success-commit:${scenario.namespace}:${itemIds.inventoryItem}`,
      ],
    );
  }

  if (unavailable) {
    for (const { ids: itemIds, transitionIds } of itemRows) {
      await client.query(
        `UPDATE fulfillments
            SET status = 'ON_HOLD', version = 2,
                hold_reason_code = 'INVENTORY_UNAVAILABLE',
                updated_at = greatest(transaction_timestamp(), updated_at + interval '1 microsecond')
          WHERE id = $1`,
        [itemIds.fulfillment],
      );
      await client.query(
        `INSERT INTO fulfillment_events (
           id, fulfillment_id, order_id, sequence, from_status, to_status,
           authority_kind, reason_code, request_id, correlation_id
         ) VALUES (
           $1, $2, $3, 2, 'PENDING', 'ON_HOLD', 'SYSTEM',
           'INVENTORY_UNAVAILABLE', $4, $5
         )`,
        [
          transitionIds.terminalFulfillmentEvent,
          itemIds.fulfillment,
          scenario.order,
          scenario.request,
          scenario.correlation,
        ],
      );
      await client.query(
        `INSERT INTO outbox_events (
           id, event_type, aggregate_type, aggregate_id, aggregate_version,
           primary_subject_id, secondary_subject_id, locale, market, currency,
           idempotency_key, correlation_id, request_id, occurred_at, available_at
         ) VALUES (
           $1, 'FULFILLMENT_STATUS_CHANGED', 'FULFILLMENT', $2, 2,
           $2, $3, 'en', 'US', 'USD', $4, $5, $6,
           transaction_timestamp(), transaction_timestamp()
         )`,
        [
          transitionIds.fulfillmentOutbox,
          itemIds.fulfillment,
          scenario.order,
          `fulfillment-hold:${itemIds.fulfillment}`,
          scenario.correlation,
          scenario.request,
        ],
      );
    }
  }

  await client.query(
    `UPDATE carts
        SET status = 'CONVERTED', version = 2,
            updated_at = greatest(transaction_timestamp(), updated_at + interval '1 microsecond')
      WHERE id = $1`,
    [scenario.cart],
  );
  await client.query(
    `UPDATE orders
        SET order_status = 'OPEN', payment_status = 'PAID',
            fulfillment_status = $2, version = 4,
            updated_at = greatest(transaction_timestamp(), updated_at + interval '1 microsecond')
      WHERE id = $1`,
    [scenario.order, finalFulfillmentStatus],
  );
  await client.query(
    `INSERT INTO order_events (
       id, order_id, sequence, event_type,
       from_order_status, to_order_status, from_payment_status, to_payment_status,
       from_dispute_status, to_dispute_status,
       from_fulfillment_status, to_fulfillment_status,
       from_payment_attempt_id, to_payment_attempt_id,
       authority_kind, reason_code, provider_event_id, request_id, correlation_id
     ) VALUES (
       $1, $2, 4, 'PAYMENT_STATUS_CHANGED',
       'PENDING_PAYMENT', 'OPEN', 'PENDING', 'PAID', 'NONE', 'NONE',
       'PENDING', $3, $4, $4, 'PROVIDER_EVIDENCE', 'ORDER_PAYMENT_CONFIRMED',
       $5, $6, $7
     )`,
    [
      scenario.orderEvent,
      scenario.order,
      finalFulfillmentStatus,
      scenario.attempt,
      scenario.providerEvent,
      scenario.request,
      scenario.correlation,
    ],
  );
  await client.query(
    `UPDATE payment_attempts
        SET status = 'SUCCEEDED', status_evidence_kind = 'VERIFIED_WEBHOOK',
            provider_event_id = $2, version = 3,
            updated_at = greatest(transaction_timestamp(), updated_at + interval '1 microsecond'),
            succeeded_at = greatest(transaction_timestamp(), created_at)
      WHERE id = $1`,
    [scenario.attempt, scenario.providerEvent],
  );
  await client.query(
    `INSERT INTO payment_attempt_events (
       id, payment_attempt_id, sequence, from_status, to_status,
       reason_code, evidence_kind, provider_event_id, request_id, correlation_id
     ) VALUES (
       $1, $2, 3, 'UNKNOWN', 'SUCCEEDED', 'PROVIDER_SUCCEEDED',
       'VERIFIED_WEBHOOK', $3, $4, $5
     )`,
    [
      scenario.successAttemptEvent,
      scenario.attempt,
      scenario.providerEvent,
      scenario.request,
      scenario.correlation,
    ],
  );
  await client.query(
    `INSERT INTO outbox_events (
       id, event_type, aggregate_type, aggregate_id, aggregate_version,
       primary_subject_id, secondary_subject_id, locale, market, currency,
       idempotency_key, correlation_id, request_id, occurred_at, available_at
     ) VALUES
       (
         $1, 'PAYMENT_STATUS_CHANGED', 'PAYMENT_ATTEMPT', $2, 3,
         $2, $3, 'en', 'US', 'USD', $4, $5, $6,
         transaction_timestamp(), transaction_timestamp()
       ),
       (
         $7, 'ORDER_PAYMENT_CONFIRMED', 'ORDER', $3, 4,
         $3, $2, 'en', 'US', 'USD', $8, $5, $6,
         transaction_timestamp(), transaction_timestamp()
       )`,
    [
      scenario.statusOutbox,
      scenario.attempt,
      scenario.order,
      `payment-status:${scenario.attempt}`,
      scenario.correlation,
      scenario.request,
      scenario.orderOutbox,
      `payment-confirmed:${scenario.order}`,
    ],
  );
}

async function applyPaymentSuccess(client, scenario, { includeLateAudit }) {
  if (scenario.previousAttemptStatus === "UNKNOWN") {
    await applyUnknownPaymentSuccess(client, scenario, { includeLateAudit });
    return;
  }
  if (includeLateAudit) {
    await client.query(
      `INSERT INTO audit_logs (
         id, actor_type, task_name, action, subject_type, subject_id,
         request_id, correlation_id, outcome
       ) VALUES (
         $1, 'SYSTEM', 'payment-reconcile', 'LATE_PAYMENT_SUCCESS_APPLIED', 'PAYMENT_ATTEMPT', $2,
         $3, $4, 'SUCCEEDED'
       )`,
      [
        scenario.audit,
        scenario.attempt,
        scenario.request,
        scenario.correlation,
      ],
    );
  }
  await client.query(
    `UPDATE payment_attempts
        SET status = 'SUCCEEDED', status_evidence_kind = 'VERIFIED_WEBHOOK',
            provider_event_id = $2, version = 2,
            updated_at = greatest(transaction_timestamp(), updated_at + interval '1 microsecond'),
            succeeded_at = greatest(transaction_timestamp(), created_at)
      WHERE id = $1`,
    [scenario.attempt, scenario.providerEvent],
  );
  await client.query(
    `INSERT INTO payment_attempt_events (
       id, payment_attempt_id, sequence, from_status, to_status,
       reason_code, evidence_kind, provider_event_id, request_id, correlation_id
     ) VALUES (
       $1, $2, 2, $3, 'SUCCEEDED', 'PROVIDER_SUCCEEDED',
       'VERIFIED_WEBHOOK', $4, $5, $6
     )`,
    [
      scenario.successAttemptEvent,
      scenario.attempt,
      scenario.previousAttemptStatus,
      scenario.providerEvent,
      scenario.request,
      scenario.correlation,
    ],
  );
  await client.query(
    `INSERT INTO outbox_events (
       id, event_type, aggregate_type, aggregate_id, aggregate_version,
       primary_subject_id, secondary_subject_id, locale, market, currency,
       idempotency_key, correlation_id, request_id, occurred_at, available_at
     ) VALUES
       (
         $1, 'PAYMENT_STATUS_CHANGED', 'PAYMENT_ATTEMPT', $2, 2,
         $2, $3, 'en', 'US', 'USD', $4, $5, $6,
         transaction_timestamp(), transaction_timestamp()
       ),
       (
         $7, 'ORDER_PAYMENT_CONFIRMED', 'ORDER', $3, 2,
         $3, $2, 'en', 'US', 'USD', $8, $5, $6,
         transaction_timestamp(), transaction_timestamp()
       )`,
    [
      scenario.statusOutbox,
      scenario.attempt,
      scenario.order,
      `payment-status:${scenario.attempt}`,
      scenario.correlation,
      scenario.request,
      scenario.orderOutbox,
      `payment-confirmed:${scenario.order}`,
    ],
  );
}

function createUnknownExpiryScenario(namespace, expiryState) {
  const scenarioId = (value) =>
    `${namespace}-0000-4000-8000-${String(value).padStart(12, "0")}`;
  return Object.freeze({
    id: scenarioId,
    namespace,
    expiryState,
    cart: scenarioId(1),
    order: scenarioId(2),
    attempt: scenarioId(3),
    reservation: scenarioId(4),
    inventoryItem: scenarioId(5),
    inventoryLocation: scenarioId(6),
    giftVariant: scenarioId(7),
    checkoutSession: scenarioId(8),
    checkoutQuote: scenarioId(9),
    cartItem: scenarioId(10),
    initialLedger: scenarioId(11),
    reservationLedger: scenarioId(12),
    expiryLedger: scenarioId(13),
    request: scenarioId(14),
    correlation: scenarioId(15),
  });
}

async function seedUnknownExpiryScenario(client, scenario) {
  const expiryExpression =
    scenario.expiryState === "ELAPSED"
      ? "transaction_timestamp() - interval '1 hour'"
      : "transaction_timestamp() + interval '1 hour'";
  const tokenHex = scenario.namespace.at(-1);
  await client.query("SET LOCAL session_replication_role = replica");
  await client.query(`
    INSERT INTO carts (
      id, token_digest, token_pepper_version, presentation_locale,
      market, currency, status, version, expires_at, locked_order_id
    ) VALUES (
      '${scenario.cart}', decode(repeat('${tokenHex}', 64), 'hex'),
      'unknown-v1', 'en', 'US', 'USD', 'LOCKED', 1,
      transaction_timestamp() + interval '2 hours', '${scenario.order}'
    );

    INSERT INTO orders (
      id, public_order_id, checkout_session_id, checkout_quote_id, cart_id,
      customer_contact_id, presentation_locale, market, currency,
      quote_revision, quote_expires_at, subtotal_minor, total_amount_minor,
      order_status, payment_status, dispute_status, fulfillment_status,
      current_payment_attempt_id
    ) VALUES (
      '${scenario.order}', '${scenario.id(50)}', '${scenario.checkoutSession}',
      '${scenario.checkoutQuote}', '${scenario.cart}', '${scenario.id(51)}',
      'en', 'US', 'USD', 1, transaction_timestamp() + interval '2 hours',
      1000, 1000, 'PENDING_PAYMENT', 'PENDING', 'NONE', 'PENDING',
      '${scenario.attempt}'
    );

    INSERT INTO payment_attempts (
      id, order_id, provider_account_id, environment, config_version_id,
      config_version, route_rule_id, rule_version, payment_method, status,
      amount_minor, currency, requested_locale, provider_locale,
      provider_locale_fallback_used, merchant_reference,
      provider_idempotency_key, external_reference, provider_call_started,
      return_state_digest, return_state_expires_at, status_evidence_kind
    ) VALUES (
      '${scenario.attempt}', '${scenario.order}', '${ids.providerAccount}', 'TEST',
      '${ids.configVersion}', 1, '${ids.routeRule}', 1, 'card', 'UNKNOWN',
      1000, 'USD', 'en', 'en', false, '${scenario.attempt}', '${scenario.attempt}',
      'unknown.${scenario.namespace}', true, decode(repeat('7', 64), 'hex'),
      transaction_timestamp() + interval '2 hours', 'NETWORK_UNCERTAINTY'
    );

    INSERT INTO gift_variants (
      id, gift_id, sku, status, inventory_policy
    ) VALUES (
      '${scenario.giftVariant}', '${scenario.id(52)}',
      'UNKNOWN-${scenario.namespace}', 'active', 'TRACKED'
    );

    INSERT INTO inventory_items (
      id, gift_variant_id, sku, policy, status
    ) VALUES (
      '${scenario.inventoryItem}', '${scenario.giftVariant}',
      'UNKNOWN-${scenario.namespace}', 'TRACKED', 'ACTIVE'
    );

    INSERT INTO inventory_locations (id, location_key, status)
    VALUES ('${scenario.inventoryLocation}', 'UNKNOWN_${scenario.namespace}', 'ACTIVE');

    INSERT INTO checkout_sessions (
      id, cart_id, quote_id, cart_version, status, market, currency,
      quote_revision, quote_expires_at, subtotal_minor, total_amount_minor,
      expires_at
    ) VALUES (
      '${scenario.checkoutSession}', '${scenario.cart}', '${scenario.checkoutQuote}',
      1, 'PAYMENT_PENDING', 'US', 'USD', 1,
      transaction_timestamp() + interval '2 hours', 1000, 1000,
      transaction_timestamp() + interval '2 hours'
    );

    INSERT INTO cart_items (
      id, cart_id, gift_variant_id, observed_price_id, quantity,
      display_mode, has_fan_message, request_id, correlation_id
    ) VALUES (
      '${scenario.cartItem}', '${scenario.cart}', '${scenario.giftVariant}',
      '${scenario.id(53)}', 1, 'anonymous', false,
      '${scenario.request}', '${scenario.correlation}'
    );

    INSERT INTO inventory_balances (
      inventory_item_id, location_id, on_hand, reserved, version
    ) VALUES ('${scenario.inventoryItem}', '${scenario.inventoryLocation}', 10, 1, 2);

    INSERT INTO inventory_reservations (
      id, inventory_item_id, gift_variant_id, location_id,
      checkout_session_id, checkout_quote_id, cart_item_id, locked_order_id,
      quantity, status, version, created_at, expires_at, updated_at
    ) VALUES (
      '${scenario.reservation}', '${scenario.inventoryItem}', '${scenario.giftVariant}',
      '${scenario.inventoryLocation}', '${scenario.checkoutSession}',
      '${scenario.checkoutQuote}', '${scenario.cartItem}', '${scenario.order}',
      1, 'ACTIVE', 1, transaction_timestamp() - interval '2 hours',
      ${expiryExpression}, transaction_timestamp() - interval '1 hour'
    );

    INSERT INTO inventory_ledger (
      id, inventory_item_id, location_id, reservation_id,
      balance_version_before, balance_version_after, delta_on_hand,
      delta_reserved, reason_code, source_type, source_id,
      idempotency_key, actor_kind, task_name
    ) VALUES
      (
        '${scenario.initialLedger}', '${scenario.inventoryItem}',
        '${scenario.inventoryLocation}', NULL, 0, 1, 10, 0,
        'INITIALIZE', 'ADJUSTMENT', '${scenario.initialLedger}',
        'unknown-initial:${scenario.namespace}', 'SYSTEM', 'postgres-constraints'
      ),
      (
        '${scenario.reservationLedger}', '${scenario.inventoryItem}',
        '${scenario.inventoryLocation}', '${scenario.reservation}', 1, 2, 0, 1,
        'RESERVATION_CREATED', 'RESERVATION', '${scenario.reservation}',
        'unknown-reserve:${scenario.namespace}', 'SYSTEM', 'postgres-constraints'
      );
  `);
  await client.query("SET LOCAL session_replication_role = origin");
}

async function expireUnknownReservation(client, scenario) {
  await client.query(
    `UPDATE inventory_reservations
        SET status = 'EXPIRED', version = 2,
            updated_at = greatest(transaction_timestamp(), updated_at + interval '1 microsecond'),
            expired_at = greatest(transaction_timestamp(), created_at)
      WHERE id = $1`,
    [scenario.reservation],
  );
  await client.query(
    `UPDATE inventory_balances
        SET reserved = 0, version = 3, updated_at = transaction_timestamp()
      WHERE inventory_item_id = $1 AND location_id = $2`,
    [scenario.inventoryItem, scenario.inventoryLocation],
  );
  await client.query(
    `INSERT INTO inventory_ledger (
       id, inventory_item_id, location_id, reservation_id,
       balance_version_before, balance_version_after, delta_on_hand,
       delta_reserved, reason_code, source_type, source_id,
       idempotency_key, actor_kind, task_name
     ) VALUES (
       $1, $2, $3, $4, 2, 3, 0, -1, 'RESERVATION_EXPIRED',
       'EXPIRY', $4, $5, 'SYSTEM', 'postgres-constraints'
     )`,
    [
      scenario.expiryLedger,
      scenario.inventoryItem,
      scenario.inventoryLocation,
      scenario.reservation,
      `unknown-expiry:${scenario.namespace}`,
    ],
  );
}

async function seedConstraintFixtures(client) {
  await client.query(`
    BEGIN;
    SET LOCAL session_replication_role = replica;

    INSERT INTO admin_identities (
      id, issuer, external_subject_hash, status, mfa_required
    ) VALUES (
      '${ids.admin}', 'constraint-harness', decode(repeat('10', 32), 'hex'), 'ACTIVE', true
    );

    INSERT INTO config_versions (
      id, config_kind, version, lifecycle, created_by, published_at
    ) VALUES (
      '${ids.configVersion}', 'PAYMENT_ROUTING', 1, 'PUBLISHED',
      '${ids.admin}', transaction_timestamp()
    );

    INSERT INTO merchant_entities (
      id, entity_key, legal_country, status
    ) VALUES (
      '${ids.merchant}', 'constraint-merchant', 'US', 'ACTIVE'
    );

    INSERT INTO payment_provider_accounts (
      id, merchant_entity_id, adapter_key, environment,
      account_reference_digest, credential_secret_ref, status
    ) VALUES (
      '${ids.providerAccount}', '${ids.merchant}', 'constraint-adapter', 'TEST',
      decode(repeat('20', 32), 'hex'),
      'secret-ref:v1:aws-sm:constraint/provider', 'ACTIVE'
    );

    INSERT INTO payment_provider_health_events (
      id, provider_account_id, sequence, from_status, to_status,
      observer_kind, task_name, reason_code, request_id, correlation_id
    ) VALUES (
      '${ids.providerHealthEvent}', '${ids.providerAccount}', 1, NULL, 'HEALTHY',
      'SYSTEM', 'postgres-constraints', 'INITIAL_HEALTH',
      '10000000-0000-4000-8000-000000000041',
      '10000000-0000-4000-8000-000000000042'
    );

    INSERT INTO audit_logs (
      id, actor_type, task_name, action, subject_type, subject_id, reason_code,
      request_id, correlation_id, outcome
    ) VALUES (
      '${ids.webhookEndpointAudit}', 'SYSTEM', 'postgres-constraints',
      'PAYMENT_WEBHOOK_ENDPOINT_ACTIVATED', 'PAYMENT_WEBHOOK_ENDPOINT',
      '${ids.webhookEndpoint}', 'INITIAL_ENDPOINT',
      '10000000-0000-4000-8000-000000000041',
      '10000000-0000-4000-8000-000000000042', 'SUCCEEDED'
    );

    INSERT INTO payment_webhook_endpoints (
      id, provider_account_id, environment, verification_secret_ref,
      verification_key_reference_hash, status, active_from,
      lifecycle_audit_log_id
    ) VALUES (
      '${ids.webhookEndpoint}', '${ids.providerAccount}', 'TEST',
      'secret-ref:v1:aws-sm:constraint/webhook', repeat('5', 64),
      'ACTIVE', transaction_timestamp(), '${ids.webhookEndpointAudit}'
    );

    INSERT INTO payment_provider_configs (
      id, config_version_id, config_version, provider_account_id,
      enabled, display_order
    ) VALUES (
      '${ids.providerConfig}', '${ids.configVersion}', 1,
      '${ids.providerAccount}', true, 1
    );

    INSERT INTO payment_route_rules (
      id, config_version_id, provider_config_id, provider_account_id,
      rule_key, rule_version, payment_method, enabled,
      minimum_amount_minor, maximum_amount_minor, priority
    ) VALUES (
      '${ids.routeRule}', '${ids.configVersion}', '${ids.providerConfig}',
      '${ids.providerAccount}', 'constraint.default', 1, 'card', true,
      0, 1000000, 1
    );

    INSERT INTO audit_logs (
      id, actor_type, task_name, action, subject_type, subject_id, reason_code,
      request_id, correlation_id, outcome
    ) VALUES
      (
        '${ids.auditLog}', 'SYSTEM', 'postgres-constraints', 'CONSTRAINT_SEED', 'PAYMENT_ATTEMPT',
        '${ids.capturedAttempt}', 'SEED', NULL, NULL, 'SUCCEEDED'
      ),
      (
        '${ids.refundAuditA}', 'SYSTEM', 'postgres-constraints', 'REFUND_REQUESTED', 'REFUND',
        '${ids.refundA}', 'CUSTOMER_REQUEST',
        '30000000-0000-4000-8000-000000000070',
        '30000000-0000-4000-8000-000000000071', 'SUCCEEDED'
      ),
      (
        '${ids.refundAuditB}', 'SYSTEM', 'postgres-constraints', 'REFUND_REQUESTED', 'REFUND',
        '${ids.refundB}', 'CUSTOMER_REQUEST',
        '30000000-0000-4000-8000-000000000080',
        '30000000-0000-4000-8000-000000000081', 'SUCCEEDED'
      ),
      (
        '${ids.mismatchRefundAudit}', 'SYSTEM', 'postgres-constraints', 'REFUND_REQUESTED', 'REFUND',
        '${ids.mismatchRefund}', 'CUSTOMER_REQUEST',
        '40000000-0000-4000-8000-000000000150',
        '40000000-0000-4000-8000-000000000151', 'SUCCEEDED'
      );

    INSERT INTO orders (
      id, public_order_id, checkout_session_id, checkout_quote_id, cart_id,
      customer_contact_id, presentation_locale, market, currency,
      quote_revision, quote_expires_at, subtotal_minor, total_amount_minor,
      order_status, payment_status, dispute_status, fulfillment_status,
      current_payment_attempt_id
    ) VALUES
      (
        '${ids.activeOrder}', '10000000-0000-4000-8000-000000000110',
        '10000000-0000-4000-8000-000000000111',
        '10000000-0000-4000-8000-000000000112',
        '10000000-0000-4000-8000-000000000113',
        '10000000-0000-4000-8000-000000000114',
        'en', 'US', 'USD', 1, transaction_timestamp() + interval '1 hour',
        1000, 1000, 'PENDING_PAYMENT', 'UNPAID', 'NONE', 'PENDING', NULL
      ),
      (
        '${ids.capturedOrder}', '10000000-0000-4000-8000-000000000120',
        '10000000-0000-4000-8000-000000000121',
        '10000000-0000-4000-8000-000000000122',
        '10000000-0000-4000-8000-000000000123',
        '10000000-0000-4000-8000-000000000124',
        'en', 'US', 'USD', 1, transaction_timestamp() + interval '1 hour',
        1000, 1000, 'OPEN', 'PAID', 'NONE', 'PENDING', '${ids.capturedAttempt}'
      ),
      (
        '${ids.shadowOrder}', '50000000-0000-4000-8000-000000000110',
        '50000000-0000-4000-8000-000000000111',
        '50000000-0000-4000-8000-000000000112',
        '50000000-0000-4000-8000-000000000113',
        '50000000-0000-4000-8000-000000000114',
        'en', 'US', 'USD', 1, transaction_timestamp() + interval '1 hour',
        1000, 1000, 'PENDING_PAYMENT', 'UNPAID', 'NONE', 'PENDING', NULL
      );

    INSERT INTO payment_attempts (
      id, order_id, provider_account_id, environment, config_version_id,
      config_version, route_rule_id, rule_version, payment_method, status,
      amount_minor, currency, requested_locale, provider_locale,
      provider_locale_fallback_used, merchant_reference,
      provider_idempotency_key, external_reference, provider_call_started,
      return_state_digest, return_state_expires_at, status_evidence_kind,
      evidence_audit_log_id, succeeded_at
    ) VALUES (
      '${ids.capturedAttempt}', '${ids.capturedOrder}', '${ids.providerAccount}',
      'TEST', '${ids.configVersion}', 1, '${ids.routeRule}', 1, 'card',
      'SUCCEEDED', 1000, 'USD', 'en', 'en', false,
      '${ids.capturedAttempt}', '${ids.capturedAttempt}', 'capture.constraint', true,
      decode(repeat('30', 32), 'hex'), transaction_timestamp() + interval '1 hour',
      'AUTHENTICATED_RECONCILE', '${ids.auditLog}', transaction_timestamp()
    );

    INSERT INTO order_items (
      id, order_id, cart_item_id, support_intent_id, idol_id,
      idol_handle, idol_display_name, idol_translation_revision_id,
      idol_translation_requested_locale, idol_translation_resolved_locale,
      idol_translation_fallback_used, idol_portrait_asset_id,
      idol_portrait_checksum_sha256, idol_portrait_object_key,
      idol_portrait_metadata_revision_id, idol_portrait_alt,
      idol_portrait_alt_translation_revision_id,
      idol_portrait_alt_requested_locale, idol_portrait_alt_resolved_locale,
      idol_portrait_alt_fallback_used, gift_id, gift_variant_id, gift_title,
      gift_translation_revision_id, gift_translation_requested_locale,
      gift_translation_resolved_locale, gift_translation_fallback_used,
      gift_image_asset_id, gift_image_checksum_sha256, gift_image_object_key,
      gift_image_metadata_revision_id, gift_image_alt,
      gift_image_alt_translation_revision_id,
      gift_image_alt_requested_locale, gift_image_alt_resolved_locale,
      gift_image_alt_fallback_used, price_id, price_revision, quantity,
      unit_amount_minor, line_subtotal_minor, tax_amount_minor,
      discount_amount_minor, line_total_minor, currency, display_mode
    ) VALUES (
      '${ids.refundOrderItemA}', '${ids.capturedOrder}',
      '30000000-0000-4000-8000-000000000101',
      '30000000-0000-4000-8000-000000000102',
      '30000000-0000-4000-8000-000000000103',
      'constraint-idol', 'Constraint Idol',
      '30000000-0000-4000-8000-000000000104', 'en', 'en', false,
      '30000000-0000-4000-8000-000000000105', repeat('a', 64),
      'constraint/idol.webp', '30000000-0000-4000-8000-000000000106',
      'Constraint idol portrait',
      '30000000-0000-4000-8000-000000000107', 'en', 'en', false,
      '30000000-0000-4000-8000-000000000108',
      '30000000-0000-4000-8000-000000000109', 'Constraint Gift',
      '30000000-0000-4000-8000-000000000110', 'en', 'en', false,
      '30000000-0000-4000-8000-000000000111', repeat('b', 64),
      'constraint/gift.webp', '30000000-0000-4000-8000-000000000112',
      'Constraint gift image',
      '30000000-0000-4000-8000-000000000113', 'en', 'en', false,
      '30000000-0000-4000-8000-000000000114', 1, 1,
      1000, 1000, 0, 0, 1000, 'USD', 'anonymous'
    );

    INSERT INTO inventory_ledger (
      id, inventory_item_id, location_id, balance_version_before,
      balance_version_after, delta_on_hand, delta_reserved, reason_code,
      source_type, source_id, idempotency_key, actor_kind, task_name
    ) VALUES (
      '${ids.inventoryLedger}', '${ids.inventoryItem}', '${ids.inventoryLocation}',
      0, 1, 0, 0, 'INITIALIZE', 'ADJUSTMENT', '${ids.inventoryLedger}',
      'constraint-ledger-seed', 'SYSTEM', 'postgres-constraints'
    );

    INSERT INTO webhook_payloads (
      id, payload_ciphertext, encrypted_data_key, encryption_key_version,
      payload_sha256, status, retention_expires_at
    ) VALUES (
      '${ids.webhookPayload}', decode(repeat('40', 16), 'hex'),
      decode(repeat('41', 16), 'hex'), 1, repeat('4', 64), 'RETAINED',
      transaction_timestamp() + interval '1 day'
    );

    INSERT INTO webhook_inbox (
      id, provider_account_id, environment, endpoint_id, provider_event_id,
      webhook_payload_id, payload_sha256, signature_verified,
      verification_key_reference_hash, signature_timestamp
    ) VALUES (
      '${ids.webhookInbox}', '${ids.providerAccount}', 'TEST',
      '${ids.webhookEndpoint}', 'constraint.event.seed', '${ids.webhookPayload}',
      repeat('4', 64), true, repeat('5', 64), transaction_timestamp()
    );

    INSERT INTO outbox_events (
      id, event_type, aggregate_type, aggregate_id, aggregate_version,
      primary_subject_id, secondary_subject_id, locale, market, currency,
      idempotency_key, correlation_id, request_id, occurred_at, available_at
    ) VALUES (
      '${ids.seededOutbox}', 'PAYMENT_STATUS_CHANGED', 'PAYMENT_ATTEMPT',
      '${ids.capturedAttempt}', 1, '${ids.capturedAttempt}', '${ids.capturedOrder}',
      'en', 'US', 'USD', 'constraint-outbox-seed',
      '10000000-0000-4000-8000-000000000170',
      '10000000-0000-4000-8000-000000000171',
      transaction_timestamp(), transaction_timestamp()
    );

    INSERT INTO refunds (
      id, order_id, payment_attempt_id, provider_account_id, environment,
      provider_reference, idempotency_key, requested_audit_log_id,
      captured_currency, currency,
      captured_amount_minor, requested_amount_minor, processed_amount_minor,
      status, status_evidence_kind, version
    ) VALUES (
      '${ids.mismatchRefund}', '${ids.capturedOrder}', '${ids.capturedAttempt}',
      '${ids.providerAccount}', 'TEST', 'refund.amount-mismatch',
      'refund-amount-mismatch', '${ids.mismatchRefundAudit}',
      'USD', 'USD', 1000, 300, 0,
      'SUBMITTING', 'SUBMIT_COMMAND', 2
    );

    INSERT INTO disputes (
      id, order_id, payment_attempt_id, provider_account_id, environment,
      provider_reference, status, amount_minor, currency,
      status_evidence_kind, version, opened_at
    ) VALUES (
      '${ids.mismatchDispute}', '${ids.capturedOrder}', '${ids.capturedAttempt}',
      '${ids.providerAccount}', 'TEST', 'dispute.amount-mismatch', 'OPEN',
      400, 'USD', 'DISPUTE_PLACEHOLDER', 1, transaction_timestamp()
    );

    INSERT INTO provider_events (
      id, provider_account_id, environment, provider_event_id, evidence_kind,
      webhook_inbox_id, event_type, normalized_status,
      external_payment_reference, provider_refund_reference,
      provider_dispute_reference, amount_minor, currency, occurred_at
    ) VALUES
      (
        '${ids.mismatchRefundProviderEvent}', '${ids.providerAccount}', 'TEST',
        'constraint.refund.amount-mismatch', 'VERIFIED_WEBHOOK',
        '${ids.webhookInbox}', 'REFUND_STATUS', 'SUCCEEDED', 'capture.constraint',
        'refund.amount-mismatch', NULL, 301, 'USD', transaction_timestamp()
      ),
      (
        '${ids.mismatchDisputeProviderEvent}', '${ids.providerAccount}', 'TEST',
        'constraint.dispute.amount-mismatch', 'VERIFIED_WEBHOOK',
        '${ids.webhookInbox}', 'DISPUTE_STATUS', 'WON', 'capture.constraint',
        NULL, 'dispute.amount-mismatch', 399, 'USD', transaction_timestamp()
      );

    INSERT INTO provider_event_associations (
      id, provider_event_id, association_status, payment_attempt_id, reason_code
    ) VALUES
      (
        '${ids.mismatchRefundAssociation}', '${ids.mismatchRefundProviderEvent}',
        'MATCHED', '${ids.capturedAttempt}', 'MATCHED_BY_REFERENCE'
      ),
      (
        '${ids.mismatchDisputeAssociation}', '${ids.mismatchDisputeProviderEvent}',
        'MATCHED', '${ids.capturedAttempt}', 'MATCHED_BY_REFERENCE'
      );

    COMMIT;
  `);
}

async function insertCreatedAttempt(
  client,
  attemptId,
  orderId = ids.activeOrder,
) {
  await client.query(
    `INSERT INTO public.payment_attempts (
       id, order_id, provider_account_id, environment, config_version_id,
       config_version, route_rule_id, rule_version, payment_method, status,
       amount_minor, currency, requested_locale, provider_locale,
       provider_locale_fallback_used, merchant_reference,
       provider_idempotency_key, provider_call_started, return_state_digest,
       return_state_expires_at, status_evidence_kind
     ) VALUES (
       $1, $2, $3, 'TEST', $4, 1, $5, 1, 'card', 'CREATED',
       1000, 'USD', 'en', 'en', false, $1::uuid::text, $1::uuid::text,
       false, decode(repeat('50', 32), 'hex'),
       transaction_timestamp() + interval '1 hour', 'ATTEMPT_CREATED'
     )`,
    [attemptId, orderId, ids.providerAccount, ids.configVersion, ids.routeRule],
  );
}

async function assertFunctionSearchPathResistsTempShadow(client) {
  await expectTransactionFailure(
    client,
    async () => {
      await client.query("SET LOCAL search_path = pg_temp, public");
      await client.query(`
        CREATE TEMP TABLE payment_attempt_events (
          payment_attempt_id uuid NOT NULL,
          sequence bigint NOT NULL,
          from_status text,
          to_status text NOT NULL,
          evidence_kind text NOT NULL,
          provider_event_id uuid,
          audit_log_id uuid
        ) ON COMMIT DROP
      `);
      await client.query(
        `INSERT INTO pg_temp.payment_attempt_events (
           payment_attempt_id, sequence, from_status, to_status, evidence_kind
         ) VALUES ($1, 1, NULL, 'CREATED', 'ATTEMPT_CREATED')`,
        [ids.shadowAttempt],
      );
      await insertCreatedAttempt(client, ids.shadowAttempt, ids.shadowOrder);
    },
    {
      code: "23514",
      messageIncludes:
        "payment attempt transition requires one matching append-only event",
      label: "function search_path temp-table shadow",
    },
  );
}

async function assertSourceOutboxProvenanceMismatchRejected(client) {
  await expectTransactionFailure(
    client,
    async () => {
      await insertCreatedAttempt(client, ids.shadowAttempt, ids.shadowOrder);
      await client.query(
        `INSERT INTO payment_attempt_events (
           id, payment_attempt_id, sequence, from_status, to_status,
           reason_code, evidence_kind, request_id, correlation_id
         ) VALUES (
           '51000000-0000-4000-8000-000000000001', $1, 1, NULL, 'CREATED',
           'ATTEMPT_CREATED', 'ATTEMPT_CREATED',
           '51000000-0000-4000-8000-000000000002',
           '51000000-0000-4000-8000-000000000003'
         )`,
        [ids.shadowAttempt],
      );
      await client.query(
        `INSERT INTO outbox_events (
           id, event_type, aggregate_type, aggregate_id, aggregate_version,
           primary_subject_id, secondary_subject_id, locale, market, currency,
           idempotency_key, correlation_id, request_id, occurred_at, available_at
         ) VALUES (
           '51000000-0000-4000-8000-000000000004',
           'PAYMENT_STATUS_CHANGED', 'PAYMENT_ATTEMPT', $1, 1, $1, $2,
           'en', 'US', 'USD', 'provenance-source-mismatch',
           '51000000-0000-4000-8000-000000000005',
           '51000000-0000-4000-8000-000000000002',
           transaction_timestamp(), transaction_timestamp()
         )`,
        [ids.shadowAttempt, ids.shadowOrder],
      );
      await client.query(
        "SET CONSTRAINTS payment_attempt_events_outbox_trigger IMMEDIATE",
      );
    },
    {
      code: "23514",
      messageIncludes:
        "payment state event and outbox record must commit together",
      label: "source to outbox provenance mismatch",
    },
  );
}

async function assertOutboxSourceProvenanceMismatchRejected(client) {
  await expectTransactionFailure(
    client,
    async () => {
      await client.query("SET LOCAL session_replication_role = replica");
      await insertCreatedAttempt(client, ids.shadowAttempt, ids.shadowOrder);
      await client.query(
        `INSERT INTO payment_attempt_events (
           id, payment_attempt_id, sequence, from_status, to_status,
           reason_code, evidence_kind, request_id, correlation_id
         ) VALUES (
           '52000000-0000-4000-8000-000000000001', $1, 1, NULL, 'CREATED',
           'ATTEMPT_CREATED', 'ATTEMPT_CREATED',
           '52000000-0000-4000-8000-000000000002',
           '52000000-0000-4000-8000-000000000003'
         )`,
        [ids.shadowAttempt],
      );
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query(
        `INSERT INTO outbox_events (
           id, event_type, aggregate_type, aggregate_id, aggregate_version,
           primary_subject_id, secondary_subject_id, locale, market, currency,
           idempotency_key, correlation_id, request_id, occurred_at, available_at
         ) VALUES (
           '52000000-0000-4000-8000-000000000004',
           'PAYMENT_STATUS_CHANGED', 'PAYMENT_ATTEMPT', $1, 1, $1, $2,
           'en', 'US', 'USD', 'provenance-outbox-mismatch',
           '52000000-0000-4000-8000-000000000005',
           '52000000-0000-4000-8000-000000000002',
           transaction_timestamp(), transaction_timestamp()
         )`,
        [ids.shadowAttempt, ids.shadowOrder],
      );
      await client.query(
        "SET CONSTRAINTS outbox_events_authority_trigger IMMEDIATE",
      );
    },
    {
      code: "23514",
      messageIncludes: "outbox event has no exact authoritative source",
      label: "outbox to source provenance mismatch",
    },
  );
}

async function insertCreatedAttemptEvidence(client) {
  await client.query(
    `INSERT INTO payment_attempt_events (
       id, payment_attempt_id, sequence, from_status, to_status,
       reason_code, evidence_kind, request_id, correlation_id
     ) VALUES (
       $1, $2, 1, NULL, 'CREATED', 'ATTEMPT_CREATED', 'ATTEMPT_CREATED',
       '20000000-0000-4000-8000-000000000041',
       '20000000-0000-4000-8000-000000000040'
     )`,
    [ids.activeAttemptEventA, ids.activeAttemptA],
  );
  await client.query(
    `INSERT INTO outbox_events (
       id, event_type, aggregate_type, aggregate_id, aggregate_version,
       primary_subject_id, secondary_subject_id, locale, market, currency,
       idempotency_key, correlation_id, request_id, occurred_at, available_at
     ) VALUES (
       $1, 'PAYMENT_STATUS_CHANGED', 'PAYMENT_ATTEMPT', $2, 1,
       $2, $3, 'en', 'US', 'USD', $4,
       '20000000-0000-4000-8000-000000000040',
       '20000000-0000-4000-8000-000000000041',
       transaction_timestamp(), transaction_timestamp()
     )`,
    [
      ids.activeAttemptOutboxA,
      ids.activeAttemptA,
      ids.activeOrder,
      `payment-status:${ids.activeAttemptA}`,
    ],
  );
}

async function runActiveAttemptRace(observer, worker, workerPid) {
  let pendingWorkerQuery;
  try {
    await observer.query("BEGIN");
    await worker.query("BEGIN");

    await insertCreatedAttempt(observer, ids.activeAttemptA);
    await insertCreatedAttemptEvidence(observer);

    pendingWorkerQuery = trackQuery(
      insertCreatedAttempt(worker, ids.activeAttemptB),
    );
    await observeLockWait(
      observer,
      workerPid,
      pendingWorkerQuery.state,
      "second active payment attempt",
    );

    await observer.query("COMMIT");
    const outcome = await pendingWorkerQuery.outcome;
    if (outcome.ok) {
      fail("second active payment attempt unexpectedly committed its insert");
    }
    assertDatabaseError(outcome.error, {
      code: "23514",
      messageIncludes:
        "payment attempt retry requires a payable order and only terminal failed predecessors",
      label: "second active payment attempt",
    });
    await worker.query("ROLLBACK");

    const count = await observer.query(
      `SELECT count(*)::integer AS count
         FROM payment_attempts
        WHERE order_id = $1
          AND status IN ('CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'UNKNOWN')`,
      [ids.activeOrder],
    );
    assertEqual(
      count.rows[0]?.count,
      1,
      "active payment attempt race did not leave exactly one active row",
    );
    const committedAggregate = await observer.query(
      `SELECT count(*)::integer AS count
         FROM payment_attempts attempt
         JOIN payment_attempt_events event
           ON event.payment_attempt_id = attempt.id
          AND event.sequence = attempt.version
          AND event.to_status = attempt.status
         JOIN outbox_events outbox
           ON outbox.event_type = 'PAYMENT_STATUS_CHANGED'
          AND outbox.aggregate_id = attempt.id
          AND outbox.aggregate_version = attempt.version
        WHERE attempt.id = $1
          AND attempt.status = 'CREATED'`,
      [ids.activeAttemptA],
    );
    assertEqual(
      committedAggregate.rows[0]?.count,
      1,
      "normal payment-attempt happy path did not commit its event and outbox",
    );
  } finally {
    await rollbackQuietly(observer);
    if (pendingWorkerQuery !== undefined) {
      await pendingWorkerQuery.outcome;
    }
    await rollbackQuietly(worker);
  }
}

async function insertRequestedRefund(client, refundId, amountMinor) {
  const requestedAuditLogId =
    refundId === ids.refundA ? ids.refundAuditA : ids.refundAuditB;
  await client.query(
    `INSERT INTO refunds (
       id, order_id, payment_attempt_id, provider_account_id, environment,
       provider_reference, idempotency_key, requested_audit_log_id,
       captured_currency, currency,
       captured_amount_minor, requested_amount_minor, processed_amount_minor,
       status, status_evidence_kind
     ) VALUES (
       $1, $2, $3, $4, 'TEST', $5, $6, $7, 'USD', 'USD',
       1000, $8, 0, 'REQUESTED', 'REFUND_REQUESTED'
     )`,
    [
      refundId,
      ids.capturedOrder,
      ids.capturedAttempt,
      ids.providerAccount,
      `refund.${refundId}`,
      `refund-request:${refundId}`,
      requestedAuditLogId,
      amountMinor,
    ],
  );
}

async function insertRequestedRefundEvidence(client, amountMinor) {
  await client.query("SET LOCAL session_replication_role = replica");
  await client.query(
    `INSERT INTO refund_items (
       id, refund_id, order_id, order_item_id, amount_minor
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      ids.refundItemA,
      ids.refundA,
      ids.capturedOrder,
      ids.refundOrderItemA,
      amountMinor,
    ],
  );
  await client.query("SET LOCAL session_replication_role = origin");
  await client.query(
    `INSERT INTO refund_events (
       id, refund_id, sequence, from_status, to_status, reason_code,
       evidence_kind, request_id, correlation_id
     ) VALUES (
       $1, $2, 1, NULL, 'REQUESTED', 'REFUND_REQUESTED', 'REFUND_REQUESTED',
       '30000000-0000-4000-8000-000000000051',
       '30000000-0000-4000-8000-000000000050'
     )`,
    [ids.refundEventA, ids.refundA],
  );
  await client.query(
    `INSERT INTO outbox_events (
       id, event_type, aggregate_type, aggregate_id, aggregate_version,
       primary_subject_id, secondary_subject_id, locale, market, currency,
       idempotency_key, correlation_id, request_id, occurred_at, available_at
     ) VALUES (
       $1, 'REFUND_STATUS_CHANGED', 'REFUND', $2, 1, $2, $3,
       'en', 'US', 'USD', $4,
       '30000000-0000-4000-8000-000000000050',
       '30000000-0000-4000-8000-000000000051',
       transaction_timestamp(), transaction_timestamp()
     )`,
    [
      ids.refundOutboxA,
      ids.refundA,
      ids.capturedOrder,
      `refund-status:${ids.refundA}`,
    ],
  );
}

async function runRefundCapacityRace(observer, worker, workerPid) {
  const firstRefundAmount = 600;
  const secondRefundAmount = 500;
  let pendingWorkerQuery;
  try {
    await observer.query("BEGIN");
    await worker.query("BEGIN");

    await insertRequestedRefund(observer, ids.refundA, firstRefundAmount);
    await insertRequestedRefundEvidence(observer, firstRefundAmount);

    pendingWorkerQuery = trackQuery(
      insertRequestedRefund(worker, ids.refundB, secondRefundAmount),
    );
    await observeLockWait(
      observer,
      workerPid,
      pendingWorkerQuery.state,
      "second refund capacity reservation",
    );

    await observer.query("COMMIT");
    const outcome = await pendingWorkerQuery.outcome;
    if (outcome.ok) {
      fail("over-capacity refund unexpectedly committed its insert");
    }
    assertDatabaseError(outcome.error, {
      code: "23514",
      messageIncludes:
        "refund capacity exceeded or captured payment attempt is not eligible",
      label: "over-capacity refund",
    });
    await worker.query("ROLLBACK");

    const state = await observer.query(
      `SELECT
         attempt.amount_minor::text AS captured,
         attempt.refund_occupied_minor::text AS occupied,
         count(refund.id) FILTER (
           WHERE refund.id IN ($2::uuid, $3::uuid)
         )::integer AS refund_count
       FROM payment_attempts attempt
       LEFT JOIN refunds refund ON refund.payment_attempt_id = attempt.id
       WHERE attempt.id = $1
       GROUP BY attempt.id`,
      [ids.capturedAttempt, ids.refundA, ids.refundB],
    );
    assertEqual(
      state.rows[0]?.refund_count,
      1,
      "refund capacity race did not leave exactly one refund",
    );
    assertEqual(
      state.rows[0]?.occupied,
      String(firstRefundAmount),
      "refund capacity race recorded an unexpected occupied amount",
    );
    if (
      BigInt(state.rows[0]?.occupied ?? -1) >
      BigInt(state.rows[0]?.captured ?? -1)
    ) {
      fail("refund occupied amount exceeded the captured amount");
    }
  } finally {
    await rollbackQuietly(observer);
    if (pendingWorkerQuery !== undefined) {
      await pendingWorkerQuery.outcome;
    }
    await rollbackQuietly(worker);
  }
}

async function assertWebhookPayloadDigestBinding(client) {
  await expectTransactionFailure(
    client,
    async () => {
      await client.query(
        `INSERT INTO webhook_payloads (
           id, payload_ciphertext, encrypted_data_key, encryption_key_version,
           payload_sha256, status, retention_expires_at
         ) VALUES (
           '${ids.mismatchWebhookPayload}', decode(repeat('42', 16), 'hex'),
           decode(repeat('43', 16), 'hex'), 1, repeat('4', 64), 'RETAINED',
           transaction_timestamp() + interval '1 day'
         )`,
      );
      await client.query(
        `INSERT INTO webhook_inbox (
           id, provider_account_id, environment, endpoint_id, provider_event_id,
           webhook_payload_id, payload_sha256, signature_verified,
           verification_key_reference_hash, signature_timestamp
         ) VALUES (
           '${ids.mismatchWebhookInbox}', '${ids.providerAccount}', 'TEST',
           '${ids.webhookEndpoint}', 'constraint.event.hash-mismatch',
           '${ids.mismatchWebhookPayload}', repeat('6', 64), true, repeat('5', 64),
           transaction_timestamp()
         )`,
      );
    },
    {
      code: "23503",
      messageIncludes: "webhook_inbox_payload_hash_fk",
      label: "webhook payload digest binding",
    },
  );
}

async function assertUnrelatedReconcileAuditRejected(client) {
  await expectTransactionFailure(
    client,
    async () => {
      await client.query(
        `INSERT INTO provider_events (
           id, provider_account_id, environment, provider_event_id,
           evidence_kind, reconcile_audit_log_id, event_type,
           normalized_status, external_payment_reference, amount_minor,
           currency, occurred_at
         ) VALUES (
           $1, $2, 'TEST', 'constraint.reconcile.unrelated',
           'AUTHENTICATED_RECONCILE', $3, 'PAYMENT_STATUS',
           'SUCCEEDED', 'constraint.reconcile.payment', 1000, 'USD',
           transaction_timestamp()
         )`,
        [ids.reconcileEvent, ids.providerAccount, ids.auditLog],
      );
    },
    {
      code: "23514",
      messageIncludes:
        "reconciled provider event requires matching authenticated audit evidence",
      label: "unrelated reconcile audit",
    },
  );
}

async function assertLateSuccessRequiresAtomicAggregatePlan(client) {
  await expectTransactionFailure(
    client,
    async () => {
      await client.query(
        `INSERT INTO audit_logs (
           id, actor_type, task_name, action, subject_type, subject_id,
           request_id, correlation_id, outcome
         ) VALUES (
           $1, 'SYSTEM', 'postgres-constraints', 'LATE_PAYMENT_SUCCESS_APPLIED', 'PAYMENT_ATTEMPT', $2,
           '50000000-0000-4000-8000-000000000050',
           '50000000-0000-4000-8000-000000000051', 'SUCCEEDED'
         )`,
        [ids.lateSuccessAudit, ids.activeAttemptA],
      );
      await client.query(
        `INSERT INTO provider_events (
           id, provider_account_id, environment, provider_event_id,
           evidence_kind, webhook_inbox_id, event_type, normalized_status,
           external_payment_reference, amount_minor, currency, occurred_at
         ) VALUES (
           $1, $2, 'TEST', 'constraint.event.seed', 'VERIFIED_WEBHOOK', $3,
           'PAYMENT_STATUS', 'SUCCEEDED', 'capture.late-success', 1000, 'USD',
           transaction_timestamp()
         )`,
        [ids.lateSuccessProviderEvent, ids.providerAccount, ids.webhookInbox],
      );
      await client.query(
        `INSERT INTO provider_event_associations (
           id, provider_event_id, association_status, payment_attempt_id,
           reason_code
         ) VALUES ($1, $2, 'MATCHED', $3, 'MATCHED_BY_REFERENCE')`,
        [
          ids.lateSuccessAssociation,
          ids.lateSuccessProviderEvent,
          ids.activeAttemptA,
        ],
      );
      await client.query(
        `UPDATE payment_attempts
            SET status = 'SUCCEEDED', provider_call_started = true,
                external_reference = 'capture.late-success',
                status_evidence_kind = 'VERIFIED_WEBHOOK',
                provider_event_id = $2, version = 2,
                updated_at = greatest(transaction_timestamp(), updated_at + interval '1 microsecond'),
                succeeded_at = greatest(transaction_timestamp(), created_at)
          WHERE id = $1`,
        [ids.activeAttemptA, ids.lateSuccessProviderEvent],
      );
      await client.query(
        `INSERT INTO payment_attempt_events (
           id, payment_attempt_id, sequence, from_status, to_status,
           reason_code, evidence_kind, provider_event_id,
           request_id, correlation_id
         ) VALUES (
           $1, $2, 2, 'CREATED', 'SUCCEEDED', 'LATE_PROVIDER_SUCCESS',
           'VERIFIED_WEBHOOK', $3,
           '50000000-0000-4000-8000-000000000061',
           '50000000-0000-4000-8000-000000000060'
         )`,
        [
          ids.lateSuccessAttemptEvent,
          ids.activeAttemptA,
          ids.lateSuccessProviderEvent,
        ],
      );
      await client.query(
        `INSERT INTO outbox_events (
           id, event_type, aggregate_type, aggregate_id, aggregate_version,
           primary_subject_id, secondary_subject_id, locale, market, currency,
           idempotency_key, correlation_id, request_id, occurred_at, available_at
         ) VALUES
           (
             $1, 'PAYMENT_STATUS_CHANGED', 'PAYMENT_ATTEMPT', $2, 2,
             $2, $3, 'en', 'US', 'USD', $4,
             '50000000-0000-4000-8000-000000000060',
             '50000000-0000-4000-8000-000000000061',
             transaction_timestamp(), transaction_timestamp()
           ),
           (
             $5, 'ORDER_PAYMENT_CONFIRMED', 'ORDER', $3, 1,
             $3, $2, 'en', 'US', 'USD', $6,
             '50000000-0000-4000-8000-000000000062',
             '50000000-0000-4000-8000-000000000063',
             transaction_timestamp(), transaction_timestamp()
           )`,
        [
          ids.lateSuccessStatusOutbox,
          ids.activeAttemptA,
          ids.activeOrder,
          `late-success-status:${ids.activeAttemptA}`,
          ids.lateSuccessOrderOutbox,
          `late-success-order:${ids.activeOrder}`,
        ],
      );
    },
    {
      code: "23514",
      messageIncludes: "payment success aggregate plan is incomplete",
      label: "late payment success atomic aggregate",
    },
  );
}

async function assertNonTrackedSuccessNeedsNoReservationOrLateAudit(client) {
  const scenario = createSuccessScenario("60000001", {
    policies: ["PROCURE_ON_DEMAND", "PREORDER"],
  });
  await runCommittedTransaction(client, async () => {
    await seedPaymentSuccessScenario(client, scenario);
    await applyPaymentSuccess(client, scenario, { includeLateAudit: false });
  });
  const result = await client.query(
    `SELECT attempt.status,
            count(reservation.id)::integer AS reservation_count,
            count(audit.id)::integer AS late_audit_count
       FROM payment_attempts attempt
       LEFT JOIN inventory_reservations reservation
         ON reservation.locked_order_id = attempt.order_id
       LEFT JOIN audit_logs audit
         ON audit.subject_id = attempt.id
        AND audit.action = 'LATE_PAYMENT_SUCCESS_APPLIED'
      WHERE attempt.id = $1
      GROUP BY attempt.id`,
    [scenario.attempt],
  );
  assertEqual(
    result.rows[0]?.status,
    "SUCCEEDED",
    "non-tracked payment success did not commit",
  );
  assertEqual(
    result.rows[0]?.reservation_count,
    0,
    "non-tracked payment success created an inventory reservation",
  );
  assertEqual(
    result.rows[0]?.late_audit_count,
    0,
    "ordinary payment success unexpectedly required a late-success audit",
  );
}

async function assertEveryTrackedLineNeedsReservation(client) {
  const scenario = createSuccessScenario("60000002", {
    policies: ["TRACKED", "TRACKED"],
    reservationStatuses: ["COMMITTED", null],
  });
  await expectTransactionFailure(
    client,
    async () => {
      await seedPaymentSuccessScenario(client, scenario);
      await applyPaymentSuccess(client, scenario, { includeLateAudit: false });
    },
    {
      code: "23514",
      messageIncludes: "tracked order-item reservation coverage is incomplete",
      label: "multi-line tracked reservation coverage",
    },
  );
}

async function assertPreparedUnknownState(client, scenario, reservationStatus) {
  const itemIds = successScenarioItemIds(scenario, 0);
  const result = await client.query(
    `SELECT attempt.status AS attempt_status, attempt.version::integer AS attempt_version,
            order_row.order_status, order_row.payment_status,
            cart.status AS cart_status, reservation.status AS reservation_status,
            (SELECT count(*)::integer FROM payment_attempt_events event
              WHERE event.payment_attempt_id = attempt.id) AS attempt_event_count,
            (SELECT count(*)::integer FROM outbox_events event
              WHERE event.aggregate_type = 'PAYMENT_ATTEMPT'
                AND event.aggregate_id = attempt.id) AS payment_outbox_count
       FROM payment_attempts attempt
       JOIN orders order_row ON order_row.id = attempt.order_id
       JOIN carts cart ON cart.id = order_row.cart_id
       JOIN inventory_reservations reservation ON reservation.id = $2
      WHERE attempt.id = $1`,
    [scenario.attempt, itemIds.reservation],
  );
  const row = result.rows[0];
  assertEqual(
    row?.attempt_status,
    "UNKNOWN",
    "prepared attempt is not UNKNOWN",
  );
  assertEqual(
    row?.attempt_version,
    2,
    "prepared UNKNOWN attempt is not version two",
  );
  assertEqual(
    row?.order_status,
    "PENDING_PAYMENT",
    "prepared UNKNOWN order left PENDING_PAYMENT",
  );
  assertEqual(
    row?.payment_status,
    "PENDING",
    "prepared order is not payment-pending",
  );
  assertEqual(
    row?.cart_status,
    "LOCKED",
    "prepared UNKNOWN cart is not locked",
  );
  assertEqual(
    row?.reservation_status,
    reservationStatus,
    "prepared UNKNOWN reservation state is incorrect",
  );
  assertEqual(row?.attempt_event_count, 2, "UNKNOWN history is not contiguous");
  assertEqual(
    row?.payment_outbox_count,
    2,
    "UNKNOWN history lacks exact outbox rows",
  );
}

async function assertLateSuccessNeedsAuditAndUsesOnHold(client) {
  const unrelatedAuditScenario = createSuccessScenario("60000003", {
    policies: ["TRACKED"],
    reservationStatuses: ["EXPIRED"],
    previousAttemptStatus: "UNKNOWN",
    fulfillmentStatus: "ON_HOLD",
  });
  await prepareUnknownPaymentSuccessScenario(client, unrelatedAuditScenario);
  await assertPreparedUnknownState(client, unrelatedAuditScenario, "EXPIRED");
  await runCommittedTransaction(client, async () => {
    await client.query(
      `INSERT INTO audit_logs (
         id, actor_type, task_name, action, subject_type, subject_id,
         reason_code, request_id, correlation_id, outcome
       ) VALUES (
         $1, 'SYSTEM', 'payment-reconcile', 'LATE_PAYMENT_SUCCESS_APPLIED',
         'PAYMENT_ATTEMPT', $2, 'LATE_PAYMENT_INVENTORY_UNAVAILABLE',
         $3, $4, 'SUCCEEDED'
       )`,
      [
        unrelatedAuditScenario.audit,
        unrelatedAuditScenario.attempt,
        unrelatedAuditScenario.request,
        unrelatedAuditScenario.correlation,
      ],
    );
  });
  await expectTransactionFailure(
    client,
    async () => {
      await applyPaymentSuccess(client, unrelatedAuditScenario, {
        includeLateAudit: false,
      });
    },
    {
      code: "23514",
      messageIncludes: "payment success aggregate plan is incomplete",
      label: "late success unrelated stale audit",
    },
  );

  const auditedScenario = createSuccessScenario("60000004", {
    policies: ["TRACKED"],
    reservationStatuses: ["EXPIRED"],
    previousAttemptStatus: "UNKNOWN",
    fulfillmentStatus: "ON_HOLD",
  });
  await prepareUnknownPaymentSuccessScenario(client, auditedScenario);
  await assertPreparedUnknownState(client, auditedScenario, "EXPIRED");
  await runCommittedTransaction(client, async () => {
    await applyPaymentSuccess(client, auditedScenario, {
      includeLateAudit: true,
    });
  });
  const itemIds = successScenarioItemIds(auditedScenario, 0);
  const transitionIds = successScenarioTransitionIds(auditedScenario, 0);
  const result = await client.query(
    `SELECT attempt.status, attempt.version::integer AS attempt_version,
            order_row.order_status, order_row.payment_status,
            order_row.fulfillment_status, order_row.version::integer AS order_version,
            cart.status AS cart_status, reservation.status AS reservation_status,
            fulfillment.status AS fulfillment_status_row,
            audit.reason_code AS audit_reason, audit.task_name AS audit_task,
            (SELECT count(*)::integer FROM payment_attempt_events event
              WHERE event.payment_attempt_id = attempt.id) AS payment_event_count,
            (SELECT count(*)::integer FROM fulfillment_events event
              WHERE event.fulfillment_id = fulfillment.id) AS fulfillment_event_count,
            (SELECT count(*)::integer FROM outbox_events event
              WHERE event.id IN ($3, $4, $5)) AS terminal_outbox_count,
            (SELECT count(*)::integer FROM inventory_ledger ledger
              WHERE ledger.reservation_id = reservation.id) AS reservation_ledger_count
       FROM payment_attempts attempt
       JOIN orders order_row ON order_row.id = attempt.order_id
       JOIN carts cart ON cart.id = order_row.cart_id
       JOIN inventory_reservations reservation ON reservation.id = $2
       JOIN fulfillments fulfillment ON fulfillment.order_id = attempt.order_id
       JOIN audit_logs audit
         ON audit.subject_id = attempt.id
        AND audit.action = 'LATE_PAYMENT_SUCCESS_APPLIED'
      WHERE attempt.id = $1
      LIMIT 1`,
    [
      auditedScenario.attempt,
      itemIds.reservation,
      auditedScenario.statusOutbox,
      auditedScenario.orderOutbox,
      transitionIds.fulfillmentOutbox,
    ],
  );
  const row = result.rows[0];
  assertEqual(
    row?.status,
    "SUCCEEDED",
    "audited late payment success did not commit",
  );
  assertEqual(
    row?.attempt_version,
    3,
    "late success attempt did not reach version three",
  );
  assertEqual(row?.order_status, "OPEN", "late success order is not open");
  assertEqual(row?.payment_status, "PAID", "late success order is not paid");
  assertEqual(row?.order_version, 4, "late success order version is incorrect");
  assertEqual(
    row?.cart_status,
    "CONVERTED",
    "late success cart was not converted",
  );
  assertEqual(
    row?.reservation_status,
    "EXPIRED",
    "expired reservation was re-consumed",
  );
  assertEqual(
    row?.fulfillment_status,
    "ON_HOLD",
    "order was not placed on hold",
  );
  assertEqual(
    row?.fulfillment_status_row,
    "ON_HOLD",
    "fulfillment row was not placed on hold",
  );
  assertEqual(
    row?.audit_reason,
    "LATE_PAYMENT_INVENTORY_UNAVAILABLE",
    "late success audit reason does not match inventory state",
  );
  assertEqual(
    row?.audit_task,
    "payment-reconcile",
    "late success audit actor task is missing",
  );
  assertEqual(
    row?.payment_event_count,
    3,
    "late success payment history is incomplete",
  );
  assertEqual(
    row?.fulfillment_event_count,
    2,
    "late success fulfillment history is incomplete",
  );
  assertEqual(
    row?.terminal_outbox_count,
    3,
    "late success outbox evidence is incomplete",
  );
  assertEqual(
    row?.reservation_ledger_count,
    2,
    "expired reservation ledger was mutated twice",
  );
}

async function assertUnknownSuccessCommitsAvailableReservation(client) {
  const scenario = createSuccessScenario("60000008", {
    policies: ["TRACKED"],
    reservationStatuses: ["ACTIVE"],
    previousAttemptStatus: "UNKNOWN",
    fulfillmentStatus: "PENDING",
  });
  await prepareUnknownPaymentSuccessScenario(client, scenario);
  await assertPreparedUnknownState(client, scenario, "ACTIVE");
  await runCommittedTransaction(client, async () => {
    await applyPaymentSuccess(client, scenario, { includeLateAudit: true });
  });

  const itemIds = successScenarioItemIds(scenario, 0);
  const result = await client.query(
    `SELECT attempt.status, attempt.version::integer AS attempt_version,
            order_row.order_status, order_row.payment_status,
            order_row.fulfillment_status, cart.status AS cart_status,
            reservation.status AS reservation_status,
            balance.on_hand::integer AS on_hand, balance.reserved::integer AS reserved,
            fulfillment.status AS fulfillment_status_row,
            audit.reason_code AS audit_reason, audit.task_name AS audit_task,
            (SELECT count(*)::integer FROM inventory_ledger ledger
              WHERE ledger.reservation_id = reservation.id) AS reservation_ledger_count,
            (SELECT count(*)::integer FROM payment_attempt_events event
              WHERE event.payment_attempt_id = attempt.id) AS payment_event_count,
            (SELECT count(*)::integer FROM outbox_events event
              WHERE event.id IN ($5, $6)) AS success_outbox_count
       FROM payment_attempts attempt
       JOIN orders order_row ON order_row.id = attempt.order_id
       JOIN carts cart ON cart.id = order_row.cart_id
       JOIN inventory_reservations reservation ON reservation.id = $2
       JOIN inventory_balances balance
         ON balance.inventory_item_id = $3 AND balance.location_id = $4
       JOIN fulfillments fulfillment ON fulfillment.order_id = order_row.id
       JOIN audit_logs audit
         ON audit.subject_id = attempt.id
        AND audit.action = 'LATE_PAYMENT_SUCCESS_APPLIED'
      WHERE attempt.id = $1
      LIMIT 1`,
    [
      scenario.attempt,
      itemIds.reservation,
      itemIds.inventoryItem,
      itemIds.inventoryLocation,
      scenario.statusOutbox,
      scenario.orderOutbox,
    ],
  );
  const row = result.rows[0];
  assertEqual(
    row?.status,
    "SUCCEEDED",
    "available UNKNOWN payment did not succeed",
  );
  assertEqual(
    row?.attempt_version,
    3,
    "available UNKNOWN attempt version is incorrect",
  );
  assertEqual(row?.order_status, "OPEN", "available UNKNOWN order is not open");
  assertEqual(
    row?.payment_status,
    "PAID",
    "available UNKNOWN order is not paid",
  );
  assertEqual(
    row?.fulfillment_status,
    "PENDING",
    "available order was incorrectly held",
  );
  assertEqual(
    row?.cart_status,
    "CONVERTED",
    "available UNKNOWN cart was not converted",
  );
  assertEqual(
    row?.reservation_status,
    "COMMITTED",
    "active reservation was not committed",
  );
  assertEqual(
    row?.on_hand,
    9,
    "reservation commit did not decrement on-hand inventory",
  );
  assertEqual(
    row?.reserved,
    0,
    "reservation commit did not clear reserved inventory",
  );
  assertEqual(
    row?.fulfillment_status_row,
    "PENDING",
    "available fulfillment did not stay pending",
  );
  assertEqual(
    row?.audit_reason,
    "PAYMENT_SUCCESS_RECONCILED",
    "available audit reason is incorrect",
  );
  assertEqual(
    row?.audit_task,
    "payment-reconcile",
    "available audit actor task is missing",
  );
  assertEqual(
    row?.reservation_ledger_count,
    2,
    "reservation commit ledger cardinality is incorrect",
  );
  assertEqual(
    row?.payment_event_count,
    3,
    "available payment history is incomplete",
  );
  assertEqual(
    row?.success_outbox_count,
    2,
    "available success outbox evidence is incomplete",
  );
}

async function assertUnknownExpiryWindowAndLocks(client) {
  const futureScenario = createUnknownExpiryScenario("60000005", "FUTURE");
  await expectTransactionFailure(
    client,
    async () => {
      await seedUnknownExpiryScenario(client, futureScenario);
      await expireUnknownReservation(client, futureScenario);
    },
    {
      code: "23514",
      messageIncludes:
        "UNKNOWN reservation expiry requires its elapsed hold window",
      label: "premature UNKNOWN reservation expiry",
    },
  );

  const elapsedScenario = createUnknownExpiryScenario("60000006", "ELAPSED");
  await runCommittedTransaction(client, async () => {
    await seedUnknownExpiryScenario(client, elapsedScenario);
    await expireUnknownReservation(client, elapsedScenario);
  });
  await expectDatabaseFailure(
    client,
    `UPDATE carts
        SET status = 'EXPIRED', version = version + 1,
            updated_at = greatest(transaction_timestamp(), updated_at + interval '1 microsecond')
      WHERE id = '${elapsedScenario.cart}'`,
    {
      code: "23514",
      messageIncludes: "nonterminal payment keeps cart and reservation locked",
      label: "UNKNOWN cart release after reservation expiry",
    },
  );
  await expectDatabaseFailure(
    client,
    `UPDATE orders
        SET order_status = 'CANCELED', version = version + 1,
            updated_at = greatest(transaction_timestamp(), updated_at + interval '1 microsecond')
      WHERE id = '${elapsedScenario.order}'`,
    {
      code: "23514",
      messageIncludes: "nonterminal payment keeps cart and reservation locked",
      label: "UNKNOWN order release after reservation expiry",
    },
  );
  const state = await client.query(
    `SELECT reservation.status AS reservation_status,
            cart.status AS cart_status, order_row.order_status
       FROM inventory_reservations reservation
       JOIN carts cart ON cart.id = $2
       JOIN orders order_row ON order_row.id = $3
      WHERE reservation.id = $1`,
    [elapsedScenario.reservation, elapsedScenario.cart, elapsedScenario.order],
  );
  assertEqual(
    state.rows[0]?.reservation_status,
    "EXPIRED",
    "elapsed UNKNOWN reservation did not expire",
  );
  assertEqual(
    state.rows[0]?.cart_status,
    "LOCKED",
    "UNKNOWN cart lock was released",
  );
  assertEqual(
    state.rows[0]?.order_status,
    "PENDING_PAYMENT",
    "UNKNOWN order lock was released",
  );

  const succeededScenario = createUnknownExpiryScenario("60000007", "ELAPSED");
  await expectTransactionFailure(
    client,
    async () => {
      await seedUnknownExpiryScenario(client, succeededScenario);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        `UPDATE payment_attempts
            SET status = 'SUCCEEDED', status_evidence_kind = 'VERIFIED_WEBHOOK',
                succeeded_at = transaction_timestamp()
          WHERE id = $1`,
        [succeededScenario.attempt],
      );
      await client.query("SET LOCAL session_replication_role = origin");
      await expireUnknownReservation(client, succeededScenario);
    },
    {
      code: "23514",
      messageIncludes:
        "succeeded payment cannot release or expire reservations",
      label: "reservation expiry after payment success",
    },
  );
}

async function assertRefundProviderAmountBinding(client) {
  await expectTransactionFailure(
    client,
    async () => {
      await client.query(
        `UPDATE refunds
            SET status = 'SUCCEEDED',
                processed_amount_minor = requested_amount_minor,
                status_evidence_kind = 'VERIFIED_WEBHOOK',
                provider_event_id = $2,
                version = 3,
                updated_at = greatest(transaction_timestamp(), updated_at + interval '1 microsecond'),
                completed_at = greatest(transaction_timestamp(), created_at)
          WHERE id = $1`,
        [ids.mismatchRefund, ids.mismatchRefundProviderEvent],
      );
      await client.query(
        `INSERT INTO refund_events (
           id, refund_id, sequence, from_status, to_status, reason_code,
           evidence_kind, provider_event_id, request_id, correlation_id
         ) VALUES (
           $1, $2, 3, 'SUBMITTING', 'SUCCEEDED', 'PROVIDER_SUCCEEDED',
           'VERIFIED_WEBHOOK', $3,
           '40000000-0000-4000-8000-000000000085',
           '40000000-0000-4000-8000-000000000084'
         )`,
        [
          ids.mismatchRefundEvent,
          ids.mismatchRefund,
          ids.mismatchRefundProviderEvent,
        ],
      );
      await client.query(
        `INSERT INTO outbox_events (
           id, event_type, aggregate_type, aggregate_id, aggregate_version,
           primary_subject_id, secondary_subject_id, locale, market, currency,
           idempotency_key, correlation_id, request_id, occurred_at, available_at
         ) VALUES (
           $1, 'REFUND_STATUS_CHANGED', 'REFUND', $2, 3, $2, $3,
           'en', 'US', 'USD', $4,
           '40000000-0000-4000-8000-000000000084',
           '40000000-0000-4000-8000-000000000085',
           transaction_timestamp(), transaction_timestamp()
         )`,
        [
          ids.mismatchRefundOutbox,
          ids.mismatchRefund,
          ids.capturedOrder,
          `refund-mismatch:${ids.mismatchRefund}`,
        ],
      );
    },
    {
      code: "23514",
      messageIncludes:
        "refund transition lacks matching normalized provider evidence",
      label: "refund provider amount binding",
    },
  );
}

async function assertDisputeProviderAmountBinding(client) {
  await expectTransactionFailure(
    client,
    async () => {
      await client.query(
        `UPDATE disputes
            SET status = 'WON',
                status_evidence_kind = 'VERIFIED_WEBHOOK',
                provider_event_id = $2,
                version = 2,
                updated_at = greatest(transaction_timestamp(), updated_at + interval '1 microsecond')
          WHERE id = $1`,
        [ids.mismatchDispute, ids.mismatchDisputeProviderEvent],
      );
      await client.query(
        `INSERT INTO dispute_events (
           id, dispute_id, sequence, from_status, to_status, reason_code,
           evidence_kind, provider_event_id, request_id, correlation_id
         ) VALUES (
           $1, $2, 2, 'OPEN', 'WON', 'PROVIDER_WON',
           'VERIFIED_WEBHOOK', $3,
           '40000000-0000-4000-8000-000000000087',
           '40000000-0000-4000-8000-000000000086'
         )`,
        [
          ids.mismatchDisputeEvent,
          ids.mismatchDispute,
          ids.mismatchDisputeProviderEvent,
        ],
      );
      await client.query(
        `INSERT INTO outbox_events (
           id, event_type, aggregate_type, aggregate_id, aggregate_version,
           primary_subject_id, secondary_subject_id, locale, market, currency,
           idempotency_key, correlation_id, request_id, occurred_at, available_at
         ) VALUES (
           $1, 'DISPUTE_STATUS_CHANGED', 'DISPUTE', $2, 2, $2, $3,
           'en', 'US', 'USD', $4,
           '40000000-0000-4000-8000-000000000086',
           '40000000-0000-4000-8000-000000000087',
           transaction_timestamp(), transaction_timestamp()
         )`,
        [
          ids.mismatchDisputeOutbox,
          ids.mismatchDispute,
          ids.capturedOrder,
          `dispute-mismatch:${ids.mismatchDispute}`,
        ],
      );
    },
    {
      code: "23514",
      messageIncludes:
        "dispute transition lacks matching normalized provider evidence",
      label: "dispute provider amount binding",
    },
  );
}

async function assertIdempotencyDataMinimization(client) {
  const insertSql = `INSERT INTO idempotency_records (
    id, actor, operation, idempotency_key, canonical_request_hash,
    status, safe_result_reference, expires_at
  ) VALUES (
    $1, $2, 'cart.add', $3, $4, $5, $6,
    transaction_timestamp() + interval '1 hour'
  )`;
  const validActor = "actor-ref:v1:guest:10000000-0000-4000-8000-000000000001";
  const invalidId = "60000000-0000-4000-8000-000000000001";
  const maliciousValues = [
    ["email", "fan@example.com"],
    ["JSON", '{"fanMessage":"private message"}'],
    ["whitespace", "private message"],
  ];

  for (const [label, value] of maliciousValues) {
    await expectDatabaseFailure(
      client,
      {
        text: insertSql,
        values: [
          invalidId,
          value,
          "idempotency-invalid-actor",
          "a".repeat(64),
          "IN_PROGRESS",
          null,
        ],
      },
      {
        code: "23514",
        messageIncludes: "idempotency_actor_reference_check",
        label: `${label} idempotency actor rejection`,
      },
    );
    await expectDatabaseFailure(
      client,
      {
        text: insertSql,
        values: [
          invalidId,
          validActor,
          "idempotency-invalid-hash",
          value,
          "IN_PROGRESS",
          null,
        ],
      },
      {
        code: "23514",
        messageIncludes: "sha256_hex_check",
        label: `${label} canonical request digest rejection`,
      },
    );
    await expectDatabaseFailure(
      client,
      {
        text: insertSql,
        values: [
          invalidId,
          validActor,
          "idempotency-invalid-result",
          "b".repeat(64),
          "SUCCEEDED",
          value,
        ],
      },
      {
        code: "23514",
        messageIncludes: "safe_idempotency_result_reference_check",
        label: `${label} idempotency result rejection`,
      },
    );
  }

  await client.query(insertSql, [
    "60000000-0000-4000-8000-000000000002",
    validActor,
    "idempotency-valid-result",
    "c".repeat(64),
    "SUCCEEDED",
    "result-ref:v1:60000000-0000-4000-8000-000000000003",
  ]);
  await client.query(insertSql, [
    "60000000-0000-4000-8000-000000000004",
    "actor-ref:v1:worker:" + "d".repeat(64),
    "idempotency-valid-error",
    "e".repeat(64),
    "FAILED",
    "error-ref:v1:CONFLICT",
  ]);
  const persisted = await client.query(
    `SELECT count(*)::integer AS count
       FROM idempotency_records
      WHERE id IN (
        '60000000-0000-4000-8000-000000000002',
        '60000000-0000-4000-8000-000000000004'
      )`,
  );
  assertEqual(
    persisted.rows[0]?.count,
    2,
    "controlled idempotency digest and references were not persisted",
  );
}

async function assertAuthorityEvidenceBindings(client) {
  const testId = (value) =>
    `71000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
  const providerOrder = testId(1);
  const providerAttempt = testId(2);
  const crossOrder = testId(3);
  const crossAttempt = testId(4);
  const failedEvent = testId(5);
  const crossEvent = testId(6);
  const succeededEvent = testId(7);
  const reconcileAudit = testId(8);
  const paymentRequest = testId(9);
  const paymentCorrelation = testId(10);
  const adminOrder = testId(11);
  const fulfillment = testId(12);

  await runCommittedTransaction(client, async () => {
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(`
      INSERT INTO audit_logs (
        id, actor_type, task_name, action, subject_type, subject_id,
        reason_code, request_id, correlation_id, outcome
      ) VALUES (
        '${reconcileAudit}', 'SYSTEM', 'postgres-constraints',
        'PAYMENT_PROVIDER_RECONCILE', 'PAYMENT_PROVIDER_ACCOUNT',
        '${ids.providerAccount}', 'TERMINAL_STATUS_OBSERVED',
        '${testId(13)}', '${testId(14)}', 'SUCCEEDED'
      );

      INSERT INTO orders (
        id, public_order_id, checkout_session_id, checkout_quote_id, cart_id,
        customer_contact_id, presentation_locale, market, currency,
        quote_revision, quote_expires_at, subtotal_minor, total_amount_minor,
        order_status, payment_status, dispute_status, fulfillment_status,
        current_payment_attempt_id, version
      ) VALUES
        (
          '${providerOrder}', '${testId(20)}', '${testId(21)}', '${testId(22)}',
          '${testId(23)}', '${testId(24)}', 'en', 'US', 'USD', 1,
          transaction_timestamp() + interval '1 hour', 1000, 1000,
          'PENDING_PAYMENT', 'PENDING', 'NONE', 'PENDING', '${providerAttempt}', 3
        ),
        (
          '${crossOrder}', '${testId(25)}', '${testId(26)}', '${testId(27)}',
          '${testId(28)}', '${testId(29)}', 'en', 'US', 'USD', 1,
          transaction_timestamp() + interval '1 hour', 1000, 1000,
          'PENDING_PAYMENT', 'PENDING', 'NONE', 'PENDING', '${crossAttempt}', 3
        ),
        (
          '${adminOrder}', '${testId(30)}', '${testId(31)}', '${testId(32)}',
          '${testId(33)}', '${testId(34)}', 'en', 'US', 'USD', 1,
          transaction_timestamp() + interval '1 hour', 1000, 1000,
          'PENDING_PAYMENT', 'UNPAID', 'NONE', 'PENDING', NULL, 2
        );

      INSERT INTO payment_attempts (
        id, order_id, provider_account_id, environment, config_version_id,
        config_version, route_rule_id, rule_version, payment_method, status,
        amount_minor, currency, requested_locale, provider_locale,
        provider_locale_fallback_used, merchant_reference,
        provider_idempotency_key, external_reference, provider_call_started,
        return_state_digest, return_state_expires_at, status_evidence_kind,
        provider_event_id, evidence_audit_log_id, version, terminated_at
      ) VALUES
        (
          '${providerAttempt}', '${providerOrder}', '${ids.providerAccount}',
          'TEST', '${ids.configVersion}', 1, '${ids.routeRule}', 1, 'card',
          'FAILED', 1000, 'USD', 'en', 'en', false, '${providerAttempt}',
          '${providerAttempt}', 'authority.provider.failed', true,
          decode(repeat('81', 32), 'hex'), transaction_timestamp() + interval '1 hour',
          'AUTHENTICATED_RECONCILE', '${failedEvent}', '${reconcileAudit}', 2,
          transaction_timestamp()
        ),
        (
          '${crossAttempt}', '${crossOrder}', '${ids.providerAccount}',
          'TEST', '${ids.configVersion}', 1, '${ids.routeRule}', 1, 'card',
          'FAILED', 1000, 'USD', 'en', 'en', false, '${crossAttempt}',
          '${crossAttempt}', 'authority.cross.failed', true,
          decode(repeat('82', 32), 'hex'), transaction_timestamp() + interval '1 hour',
          'AUTHENTICATED_RECONCILE', '${crossEvent}', '${reconcileAudit}', 2,
          transaction_timestamp()
        );

      INSERT INTO provider_events (
        id, provider_account_id, environment, provider_event_id, evidence_kind,
        reconcile_audit_log_id, event_type, normalized_status,
        external_payment_reference, amount_minor, currency, occurred_at
      ) VALUES
        (
          '${failedEvent}', '${ids.providerAccount}', 'TEST',
          'authority.failed', 'AUTHENTICATED_RECONCILE', '${reconcileAudit}',
          'PAYMENT_STATUS', 'FAILED', 'authority.provider.failed', 1000, 'USD',
          transaction_timestamp()
        ),
        (
          '${crossEvent}', '${ids.providerAccount}', 'TEST',
          'authority.cross', 'AUTHENTICATED_RECONCILE', '${reconcileAudit}',
          'PAYMENT_STATUS', 'FAILED', 'authority.cross.failed', 1000, 'USD',
          transaction_timestamp()
        ),
        (
          '${succeededEvent}', '${ids.providerAccount}', 'TEST',
          'authority.succeeded', 'AUTHENTICATED_RECONCILE', '${reconcileAudit}',
          'PAYMENT_STATUS', 'SUCCEEDED', 'authority.provider.failed', 1000, 'USD',
          transaction_timestamp()
        );

      INSERT INTO provider_event_associations (
        id, provider_event_id, association_status, payment_attempt_id, reason_code
      ) VALUES
        ('${testId(40)}', '${failedEvent}', 'MATCHED', '${providerAttempt}', 'MATCHED_REFERENCE'),
        ('${testId(41)}', '${crossEvent}', 'MATCHED', '${crossAttempt}', 'MATCHED_REFERENCE'),
        ('${testId(42)}', '${succeededEvent}', 'MATCHED', '${providerAttempt}', 'MATCHED_REFERENCE');

      INSERT INTO payment_attempt_events (
        id, payment_attempt_id, sequence, from_status, to_status, reason_code,
        evidence_kind, provider_event_id, audit_log_id, request_id,
        correlation_id, occurred_at
      ) VALUES
        (
          '${testId(43)}', '${providerAttempt}', 2, 'PROCESSING', 'FAILED',
          'PROVIDER_REPORTED_FAILED', 'AUTHENTICATED_RECONCILE', '${failedEvent}',
          '${reconcileAudit}', '${paymentRequest}', '${paymentCorrelation}',
          transaction_timestamp()
        ),
        (
          '${testId(44)}', '${crossAttempt}', 2, 'PROCESSING', 'FAILED',
          'PROVIDER_REPORTED_FAILED', 'AUTHENTICATED_RECONCILE', '${crossEvent}',
          '${reconcileAudit}', '${testId(45)}', '${testId(46)}',
          transaction_timestamp()
        );

      INSERT INTO order_events (
        id, order_id, sequence, event_type, from_order_status, to_order_status,
        from_payment_status, to_payment_status, from_dispute_status,
        to_dispute_status, from_fulfillment_status, to_fulfillment_status,
        from_payment_attempt_id, to_payment_attempt_id, authority_kind,
        reason_code, request_id, correlation_id
      ) VALUES
        (
          '${testId(50)}', '${providerOrder}', 1, 'ORDER_CREATED', NULL, 'DRAFT',
          NULL, 'UNPAID', NULL, 'NONE', NULL, 'PENDING', NULL, NULL, 'CHECKOUT',
          'ORDER_CREATED', '${testId(51)}', '${testId(52)}'
        ),
        (
          '${testId(53)}', '${providerOrder}', 2, 'LIFECYCLE_CHANGED', 'DRAFT',
          'PENDING_PAYMENT', 'UNPAID', 'UNPAID', 'NONE', 'NONE', 'PENDING',
          'PENDING', NULL, NULL, 'CHECKOUT', 'ORDER_CHECKOUT_CREATED',
          '${testId(54)}', '${testId(55)}'
        ),
        (
          '${testId(56)}', '${providerOrder}', 3, 'PAYMENT_STATUS_CHANGED',
          'PENDING_PAYMENT', 'PENDING_PAYMENT', 'UNPAID', 'PENDING', 'NONE',
          'NONE', 'PENDING', 'PENDING', NULL, '${providerAttempt}', 'CHECKOUT',
          'ORDER_PAYMENT_ATTEMPT_CREATED', '${testId(57)}', '${testId(58)}'
        ),
        (
          '${testId(60)}', '${adminOrder}', 1, 'ORDER_CREATED', NULL, 'DRAFT',
          NULL, 'UNPAID', NULL, 'NONE', NULL, 'PENDING', NULL, NULL, 'CHECKOUT',
          'ORDER_CREATED', '${testId(61)}', '${testId(62)}'
        ),
        (
          '${testId(63)}', '${adminOrder}', 2, 'LIFECYCLE_CHANGED', 'DRAFT',
          'PENDING_PAYMENT', 'UNPAID', 'UNPAID', 'NONE', 'NONE', 'PENDING',
          'PENDING', NULL, NULL, 'CHECKOUT', 'ORDER_CHECKOUT_CREATED',
          '${testId(64)}', '${testId(65)}'
        );

      INSERT INTO fulfillments (
        id, order_id, order_item_id, idol_id, fulfillment_profile_id, status
      ) VALUES (
        '${fulfillment}', '${adminOrder}', '${testId(70)}', '${testId(71)}',
        '${testId(72)}', 'PENDING'
      );
      INSERT INTO fulfillment_events (
        id, fulfillment_id, order_id, sequence, from_status, to_status,
        authority_kind, reason_code, request_id, correlation_id
      ) VALUES (
        '${testId(73)}', '${fulfillment}', '${adminOrder}', 1, NULL, 'PENDING',
        'SYSTEM', 'FULFILLMENT_CREATED', '${testId(74)}', '${testId(75)}'
      );
      SET LOCAL session_replication_role = origin;
    `);
  });

  const providerCancelInsert = `INSERT INTO order_events (
    id, order_id, sequence, event_type, from_order_status, to_order_status,
    from_payment_status, to_payment_status, from_dispute_status,
    to_dispute_status, from_fulfillment_status, to_fulfillment_status,
    from_payment_attempt_id, to_payment_attempt_id, authority_kind,
    reason_code, provider_event_id, request_id, correlation_id, occurred_at
  ) VALUES ($1, $2, 4, 'LIFECYCLE_CHANGED', 'PENDING_PAYMENT', 'CANCELED',
    'PENDING', 'PENDING', 'NONE', 'NONE', 'PENDING', 'PENDING', $3, $3,
    'PROVIDER_EVIDENCE', 'ORDER_CANCELED', $4, $5, $6,
    (SELECT occurred_at FROM provider_events WHERE id = $4))`;

  for (const [offset, providerEventId, requestId, correlationId, label] of [
    [
      80,
      crossEvent,
      paymentRequest,
      paymentCorrelation,
      "cross-order provider event",
    ],
    [
      81,
      succeededEvent,
      paymentRequest,
      paymentCorrelation,
      "successful provider event cancellation",
    ],
    [
      82,
      failedEvent,
      testId(83),
      paymentCorrelation,
      "mismatched cancellation request",
    ],
  ]) {
    await expectDatabaseFailure(
      client,
      {
        text: providerCancelInsert,
        values: [
          testId(offset),
          providerOrder,
          providerAttempt,
          providerEventId,
          requestId,
          correlationId,
        ],
      },
      {
        code: "23514",
        messageIncludes:
          "provider order cancellation requires the current attempt terminal evidence chain",
        label,
      },
    );
  }

  await client.query("BEGIN");
  try {
    await client.query(providerCancelInsert, [
      testId(84),
      providerOrder,
      providerAttempt,
      failedEvent,
      paymentRequest,
      paymentCorrelation,
    ]);
  } finally {
    await rollbackQuietly(client);
  }

  const staleAudit = testId(90);
  const staleRequest = testId(91);
  const staleCorrelation = testId(92);
  await client.query(
    `INSERT INTO audit_logs (
       id, actor_type, actor_id, action, subject_type, subject_id,
       reason_code, request_id, correlation_id, outcome
     ) VALUES ($1, 'ADMIN', $2, 'ORDER_CANCELED', 'ORDER', $3,
       'ORDER_CANCELED', $4, $5, 'SUCCEEDED')`,
    [staleAudit, ids.admin, adminOrder, staleRequest, staleCorrelation],
  );
  await expectDatabaseFailure(
    client,
    {
      text: `INSERT INTO order_events (
        id, order_id, sequence, event_type, from_order_status, to_order_status,
        from_payment_status, to_payment_status, from_dispute_status,
        to_dispute_status, from_fulfillment_status, to_fulfillment_status,
        from_payment_attempt_id, to_payment_attempt_id, authority_kind,
        reason_code, admin_identity_id, audit_log_id, request_id, correlation_id
      ) VALUES ($1, $2, 3, 'LIFECYCLE_CHANGED', 'PENDING_PAYMENT', 'CANCELED',
        'UNPAID', 'UNPAID', 'NONE', 'NONE', 'PENDING', 'PENDING', NULL, NULL,
        'ADMIN', 'ORDER_CANCELED', $3, $4, $5, $6)`,
      values: [
        testId(93),
        adminOrder,
        ids.admin,
        staleAudit,
        staleRequest,
        staleCorrelation,
      ],
    },
    {
      code: "23514",
      messageIncludes:
        "admin order event requires exact fresh successful audit evidence",
      label: "stale admin order audit",
    },
  );

  await expectTransactionFailure(
    client,
    async () => {
      const auditId = testId(94);
      const requestId = testId(95);
      const correlationId = testId(96);
      await client.query(
        `INSERT INTO audit_logs (
           id, actor_type, actor_id, action, subject_type, subject_id,
           reason_code, request_id, correlation_id, outcome
         ) VALUES ($1, 'ADMIN', $2, 'ORDER_CANCELED', 'ORDER', $3,
           'ORDER_CANCELED', $4, $5, 'SUCCEEDED')`,
        [auditId, ids.admin, adminOrder, requestId, correlationId],
      );
      const values = [
        testId(97),
        adminOrder,
        ids.admin,
        auditId,
        requestId,
        correlationId,
      ];
      const sql = `INSERT INTO order_events (
        id, order_id, sequence, event_type, from_order_status, to_order_status,
        from_payment_status, to_payment_status, from_dispute_status,
        to_dispute_status, from_fulfillment_status, to_fulfillment_status,
        from_payment_attempt_id, to_payment_attempt_id, authority_kind,
        reason_code, admin_identity_id, audit_log_id, request_id, correlation_id
      ) VALUES ($1, $2, 3, 'LIFECYCLE_CHANGED', 'PENDING_PAYMENT', 'CANCELED',
        'UNPAID', 'UNPAID', 'NONE', 'NONE', 'PENDING', 'PENDING', NULL, NULL,
        'ADMIN', 'ORDER_CANCELED', $3, $4, $5, $6)`;
      await client.query(sql, values);
      values[0] = testId(98);
      await client.query(sql, values);
    },
    {
      code: "23514",
      messageIncludes: "admin authority audit evidence was already consumed",
      label: "reused admin order audit",
    },
  );

  await expectTransactionFailure(
    client,
    async () => {
      const auditId = testId(100);
      const requestId = testId(101);
      const correlationId = testId(102);
      await client.query(
        `INSERT INTO audit_logs (
           id, actor_type, actor_id, action, subject_type, subject_id,
           reason_code, request_id, correlation_id, outcome
         ) VALUES ($1, 'ADMIN', $2, 'FULFILLMENT_STATUS_CHANGED',
           'FULFILLMENT', $3, 'MANUAL_HOLD', $4, $5, 'SUCCEEDED')`,
        [auditId, ids.admin, fulfillment, requestId, correlationId],
      );
      const values = [
        testId(103),
        fulfillment,
        adminOrder,
        ids.admin,
        auditId,
        requestId,
        correlationId,
      ];
      const sql = `INSERT INTO fulfillment_events (
        id, fulfillment_id, order_id, sequence, from_status, to_status,
        authority_kind, reason_code, admin_identity_id, audit_log_id,
        request_id, correlation_id
      ) VALUES ($1, $2, $3, 2, 'PENDING', 'ON_HOLD', 'ADMIN', 'MANUAL_HOLD',
        $4, $5, $6, $7)`;
      await client.query(sql, values);
      values[0] = testId(104);
      await client.query(sql, values);
    },
    {
      code: "23514",
      messageIncludes: "admin authority audit evidence was already consumed",
      label: "reused admin fulfillment audit",
    },
  );
}

async function assertWebhookEndpointLifecycleAndRetention(client) {
  const testId = (value) =>
    `70000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
  const insertLifecycleAudit = async (
    auditId,
    endpointId,
    action,
    reasonCode,
    requestId,
    correlationId,
  ) => {
    await client.query(
      `INSERT INTO audit_logs (
         id, actor_type, task_name, action, subject_type, subject_id,
         reason_code, request_id, correlation_id, outcome
       ) VALUES ($1, 'SYSTEM', 'postgres-constraints', $2,
         'PAYMENT_WEBHOOK_ENDPOINT', $3, $4, $5, $6, 'SUCCEEDED')`,
      [auditId, action, endpointId, reasonCode, requestId, correlationId],
    );
  };

  await expectTransactionFailure(
    client,
    async () => {
      await insertLifecycleAudit(
        testId(1),
        testId(2),
        "PAYMENT_WEBHOOK_ENDPOINT_ACTIVATED",
        "SECOND_ACTIVE_REJECTED",
        testId(3),
        testId(4),
      );
      await client.query(
        `INSERT INTO payment_webhook_endpoints (
           id, provider_account_id, environment, verification_secret_ref,
           verification_key_reference_hash, status, active_from,
           lifecycle_audit_log_id
         ) VALUES ($1, $2, 'TEST', 'secret-ref:v1:aws-sm:constraint/second',
           repeat('6', 64), 'ACTIVE', transaction_timestamp(), $3)`,
        [testId(2), ids.providerAccount, testId(1)],
      );
    },
    {
      code: "23514",
      messageIncludes:
        "only the first webhook endpoint may omit a rotation predecessor",
      label: "second active webhook endpoint without predecessor",
    },
  );

  await expectTransactionFailure(
    client,
    async () => {
      await insertLifecycleAudit(
        testId(5),
        testId(6),
        "PAYMENT_WEBHOOK_ENDPOINT_ACTIVATED",
        "FUTURE_ACTIVATION_REJECTED",
        testId(7),
        testId(8),
      );
      await client.query(
        `INSERT INTO payment_webhook_endpoints (
           id, provider_account_id, environment, verification_secret_ref,
           verification_key_reference_hash, status, active_from,
           lifecycle_audit_log_id
         ) VALUES ($1, $2, 'TEST', 'secret-ref:v1:aws-sm:constraint/future',
           repeat('6', 64), 'ACTIVE', transaction_timestamp() + interval '1 hour', $3)`,
        [testId(6), ids.providerAccount, testId(5)],
      );
    },
    {
      code: "23514",
      messageIncludes: "new webhook endpoint must start active",
      label: "future webhook endpoint activation",
    },
  );

  for (const [offset, overlapExpression, retiredExpression, expected] of [
    [
      10,
      "transaction_timestamp() + interval '1 minute'",
      "transaction_timestamp() + interval '1 hour'",
      "webhook endpoint retirement window is invalid",
    ],
    [
      20,
      "transaction_timestamp()",
      "'infinity'::timestamptz",
      "finite_timestamptz_check",
    ],
    [
      30,
      "transaction_timestamp()",
      "transaction_timestamp() + interval '25 hours'",
      "webhook endpoint retirement window is invalid",
    ],
  ]) {
    await expectTransactionFailure(
      client,
      async () => {
        await insertLifecycleAudit(
          testId(offset),
          ids.webhookEndpoint,
          "PAYMENT_WEBHOOK_ENDPOINT_ROTATION_STARTED",
          "INVALID_ROTATION_WINDOW",
          testId(offset + 1),
          testId(offset + 2),
        );
        await client.query(
          `UPDATE payment_webhook_endpoints
              SET status = 'ROTATION_OVERLAP',
                  overlap_started_at = ${overlapExpression},
                  retired_at = ${retiredExpression},
                  lifecycle_audit_log_id = $1
            WHERE id = $2`,
          [testId(offset), ids.webhookEndpoint],
        );
      },
      {
        code: "23514",
        messageIncludes: expected,
        label: `invalid webhook rotation window ${offset}`,
      },
    );
  }

  for (const [offset, secretRef, keyHash] of [
    [40, "secret-ref:v1:aws-sm:constraint/new-secret", "5"],
    [50, "secret-ref:v1:aws-sm:constraint/webhook", "6"],
  ]) {
    await expectTransactionFailure(
      client,
      async () => {
        await insertLifecycleAudit(
          testId(offset),
          ids.webhookEndpoint,
          "PAYMENT_WEBHOOK_ENDPOINT_ROTATION_STARTED",
          "ROTATION_STARTED",
          testId(offset + 1),
          testId(offset + 2),
        );
        await client.query(
          `UPDATE payment_webhook_endpoints
              SET status = 'ROTATION_OVERLAP',
                  overlap_started_at = transaction_timestamp(),
                  retired_at = transaction_timestamp() + interval '1 hour',
                  lifecycle_audit_log_id = $1
            WHERE id = $2`,
          [testId(offset), ids.webhookEndpoint],
        );
        await insertLifecycleAudit(
          testId(offset + 3),
          testId(offset + 4),
          "PAYMENT_WEBHOOK_ENDPOINT_ACTIVATED",
          "ROTATED_ENDPOINT_ACTIVATED",
          testId(offset + 5),
          testId(offset + 6),
        );
        await client.query(
          `INSERT INTO payment_webhook_endpoints (
             id, provider_account_id, environment, verification_secret_ref,
             verification_key_reference_hash, status, rotated_from_endpoint_id,
             active_from, lifecycle_audit_log_id
           ) VALUES ($1, $2, 'TEST', $3, repeat($4, 64), 'ACTIVE', $5,
             transaction_timestamp(), $6)`,
          [
            testId(offset + 4),
            ids.providerAccount,
            secretRef,
            keyHash,
            ids.webhookEndpoint,
            testId(offset + 3),
          ],
        );
      },
      {
        code: "23514",
        messageIncludes:
          "rotated webhook endpoint requires an overlapping same-account predecessor with new key material",
        label: `webhook rotation key material reuse ${offset}`,
      },
    );
  }

  for (const [offset, createdAt, retention, expected] of [
    [
      60,
      "transaction_timestamp()",
      "'infinity'::timestamptz",
      "finite_timestamptz_check",
    ],
    [
      61,
      "transaction_timestamp()",
      "transaction_timestamp() + interval '8 days'",
      "webhook_payloads_retention_check",
    ],
    [
      62,
      "transaction_timestamp() + interval '1 year'",
      "transaction_timestamp() + interval '1 year 1 day'",
      "webhook payload creation time must be server anchored",
    ],
    [
      63,
      "transaction_timestamp() - interval '1 day'",
      "transaction_timestamp() + interval '1 day'",
      "webhook payload creation time must be server anchored",
    ],
  ]) {
    await expectDatabaseFailure(
      client,
      `INSERT INTO webhook_payloads (
         id, payload_ciphertext, encrypted_data_key, encryption_key_version,
         payload_sha256, status, retention_expires_at, created_at
       ) VALUES (
         '${testId(offset)}', decode(repeat('70', 16), 'hex'),
         decode(repeat('71', 16), 'hex'), 1, repeat('7', 64), 'RETAINED',
         ${retention}, ${createdAt}
       )`,
      {
        code: "23514",
        messageIncludes: expected,
        label: `invalid webhook payload retention ${offset}`,
      },
    );
  }

  for (const [offset, signatureTime, receivedTime, expected] of [
    [
      70,
      "'infinity'::timestamptz",
      "transaction_timestamp()",
      "webhook_inbox_time_check",
    ],
    [
      72,
      "transaction_timestamp()",
      "transaction_timestamp() - interval '1 hour'",
      "webhook receipt time must be server anchored",
    ],
    [
      74,
      "transaction_timestamp()",
      "transaction_timestamp() + interval '1 hour'",
      "webhook receipt time must be server anchored",
    ],
  ]) {
    await expectTransactionFailure(
      client,
      async () => {
        await client.query(
          `INSERT INTO webhook_payloads (
             id, payload_ciphertext, encrypted_data_key, encryption_key_version,
             payload_sha256, status, retention_expires_at
           ) VALUES ($1, decode(repeat('72', 16), 'hex'),
             decode(repeat('73', 16), 'hex'), 1, repeat('8', 64), 'RETAINED',
             transaction_timestamp() + interval '1 day')`,
          [testId(offset)],
        );
        await client.query(
          `INSERT INTO webhook_inbox (
             id, provider_account_id, environment, endpoint_id,
             provider_event_id, webhook_payload_id, payload_sha256,
             signature_verified, verification_key_reference_hash,
             signature_timestamp, received_at
           ) VALUES ($1, $2, 'TEST', $3, $4, $5, repeat('8', 64), true,
             repeat('5', 64), ${signatureTime}, ${receivedTime})`,
          [
            testId(offset + 1),
            ids.providerAccount,
            ids.webhookEndpoint,
            `constraint.time.${offset}`,
            testId(offset),
          ],
        );
      },
      {
        code: "23514",
        messageIncludes: expected,
        label: `untrusted webhook receipt time ${offset}`,
      },
    );
  }

  const purgePayload = testId(80);
  await runCommittedTransaction(client, async () => {
    await client.query(
      `INSERT INTO webhook_payloads (
         id, payload_ciphertext, encrypted_data_key, encryption_key_version,
         payload_sha256, status, retention_expires_at
       ) VALUES ($1, decode(repeat('74', 16), 'hex'),
         decode(repeat('75', 16), 'hex'), 1, repeat('9', 64), 'RETAINED',
         transaction_timestamp() + interval '1 day')`,
      [purgePayload],
    );
  });
  await expectDatabaseFailure(
    client,
    `UPDATE webhook_payloads
        SET status = 'PURGED', payload_ciphertext = NULL,
            encrypted_data_key = NULL, encryption_key_version = NULL,
            purged_at = transaction_timestamp() + interval '1 hour'
      WHERE id = '${purgePayload}'`,
    {
      code: "23514",
      messageIncludes: "webhook payload purge time must be server anchored",
      label: "future webhook purge time",
    },
  );
  await client.query(
    `UPDATE webhook_payloads
        SET status = 'PURGED', payload_ciphertext = NULL,
            encrypted_data_key = NULL, encryption_key_version = NULL,
            purged_at = transaction_timestamp()
      WHERE id = $1`,
    [purgePayload],
  );

  const rotatedEndpoint = testId(90);
  await runCommittedTransaction(client, async () => {
    await insertLifecycleAudit(
      testId(91),
      ids.webhookEndpoint,
      "PAYMENT_WEBHOOK_ENDPOINT_ROTATION_STARTED",
      "ROTATION_STARTED",
      testId(92),
      testId(93),
    );
    await client.query(
      `UPDATE payment_webhook_endpoints
          SET status = 'ROTATION_OVERLAP',
              overlap_started_at = transaction_timestamp(),
              retired_at = transaction_timestamp() + interval '1 hour',
              lifecycle_audit_log_id = $1
        WHERE id = $2`,
      [testId(91), ids.webhookEndpoint],
    );
  });
  await runCommittedTransaction(client, async () => {
    await insertLifecycleAudit(
      testId(94),
      rotatedEndpoint,
      "PAYMENT_WEBHOOK_ENDPOINT_ACTIVATED",
      "ROTATED_ENDPOINT_ACTIVATED",
      testId(95),
      testId(96),
    );
    await client.query(
      `INSERT INTO payment_webhook_endpoints (
         id, provider_account_id, environment, verification_secret_ref,
         verification_key_reference_hash, status, rotated_from_endpoint_id,
         active_from, lifecycle_audit_log_id
       ) VALUES ($1, $2, 'TEST', 'secret-ref:v1:aws-sm:constraint/webhook-next',
         repeat('6', 64), 'ACTIVE', $3, transaction_timestamp(), $4)`,
      [rotatedEndpoint, ids.providerAccount, ids.webhookEndpoint, testId(94)],
    );
  });
  await runCommittedTransaction(client, async () => {
    await insertLifecycleAudit(
      testId(97),
      ids.webhookEndpoint,
      "PAYMENT_WEBHOOK_ENDPOINT_RETIRED",
      "ROTATION_COMPLETED",
      testId(98),
      testId(99),
    );
    await client.query(
      `UPDATE payment_webhook_endpoints
          SET status = 'RETIRED', lifecycle_audit_log_id = $1
        WHERE id = $2`,
      [testId(97), ids.webhookEndpoint],
    );
  });

  await expectTransactionFailure(
    client,
    async () => {
      await insertLifecycleAudit(
        testId(100),
        ids.webhookEndpoint,
        "PAYMENT_WEBHOOK_ENDPOINT_ACTIVATED",
        "REACTIVATION_REJECTED",
        testId(101),
        testId(102),
      );
      await client.query(
        `UPDATE payment_webhook_endpoints
            SET status = 'ACTIVE', overlap_started_at = NULL,
                retired_at = NULL, lifecycle_audit_log_id = $1
          WHERE id = $2`,
        [testId(100), ids.webhookEndpoint],
      );
    },
    {
      code: "23514",
      messageIncludes: "invalid webhook endpoint transition",
      label: "retired webhook endpoint reactivation",
    },
  );

  await expectTransactionFailure(
    client,
    async () => {
      await client.query(
        `INSERT INTO webhook_payloads (
           id, payload_ciphertext, encrypted_data_key, encryption_key_version,
           payload_sha256, status, retention_expires_at
         ) VALUES ($1, decode(repeat('76', 16), 'hex'),
           decode(repeat('77', 16), 'hex'), 1, repeat('a', 64), 'RETAINED',
           transaction_timestamp() + interval '1 day')`,
        [testId(103)],
      );
      await client.query(
        `INSERT INTO webhook_inbox (
           id, provider_account_id, environment, endpoint_id, provider_event_id,
           webhook_payload_id, payload_sha256, signature_verified,
           verification_key_reference_hash, signature_timestamp
         ) VALUES ($1, $2, 'TEST', $3, 'constraint.retired-key', $4,
           repeat('a', 64), true, repeat('5', 64), transaction_timestamp())`,
        [testId(104), ids.providerAccount, ids.webhookEndpoint, testId(103)],
      );
    },
    {
      code: "23514",
      messageIncludes: "webhook endpoint is not active at receipt time",
      label: "retired webhook endpoint receipt",
    },
  );

  await runCommittedTransaction(client, async () => {
    await client.query(
      `INSERT INTO webhook_payloads (
         id, payload_ciphertext, encrypted_data_key, encryption_key_version,
         payload_sha256, status, retention_expires_at
       ) VALUES ($1, decode(repeat('78', 16), 'hex'),
         decode(repeat('79', 16), 'hex'), 1, repeat('b', 64), 'RETAINED',
         transaction_timestamp() + interval '1 day')`,
      [testId(105)],
    );
    await client.query(
      `INSERT INTO webhook_inbox (
         id, provider_account_id, environment, endpoint_id, provider_event_id,
         webhook_payload_id, payload_sha256, signature_verified,
         verification_key_reference_hash, signature_timestamp
       ) VALUES ($1, $2, 'TEST', $3, 'constraint.rotated-key', $4,
         repeat('b', 64), true, repeat('6', 64), transaction_timestamp())`,
      [testId(106), ids.providerAccount, rotatedEndpoint, testId(105)],
    );
  });

  const lifecycleState = await client.query(
    `SELECT
       count(*) FILTER (WHERE status = 'ACTIVE')::integer AS active_count,
       count(*) FILTER (WHERE status = 'ROTATION_OVERLAP')::integer AS overlap_count,
       count(*) FILTER (WHERE status = 'RETIRED')::integer AS retired_count
     FROM payment_webhook_endpoints
     WHERE provider_account_id = $1 AND environment = 'TEST'`,
    [ids.providerAccount],
  );
  assertEqual(
    lifecycleState.rows[0]?.active_count,
    1,
    "webhook rotation lost its active endpoint",
  );
  assertEqual(
    lifecycleState.rows[0]?.overlap_count,
    0,
    "webhook rotation left an overlap endpoint",
  );
  assertEqual(
    lifecycleState.rows[0]?.retired_count,
    1,
    "webhook rotation did not retire its predecessor",
  );
}

async function assertMetadataBoundaryDomains(client) {
  const invalidIdempotencyKeys = [
    "supporter@example.com",
    '{"email":"fan@example.com"}',
    "idempotency key with spaces",
  ];
  for (const [index, value] of invalidIdempotencyKeys.entries()) {
    await expectDatabaseFailure(
      client,
      { text: "SELECT $1::idempotency_key_value", values: [value] },
      {
        code: "23514",
        messageIncludes: "idempotency_key_value_check",
        label: `unsafe idempotency key ${index + 1}`,
      },
    );
  }
  for (const value of [
    "checkout-request-0001",
    "webhook:event:01HZZZZZZZZZZZZZ",
  ]) {
    await client.query("SELECT $1::idempotency_key_value", [value]);
  }

  const invalidObjectKeys = [
    "supporter@example.com",
    '{"message":"private"}',
    "media/private gift.webp",
    "media/../private.webp",
    "/media/private.webp",
  ];
  for (const [index, value] of invalidObjectKeys.entries()) {
    await expectDatabaseFailure(
      client,
      { text: "SELECT $1::media_object_key", values: [value] },
      {
        code: "23514",
        messageIncludes: "media_object_key_check",
        label: `unsafe media object key ${index + 1}`,
      },
    );
  }
  await client.query("SELECT $1::media_object_key", [
    `media/${ids.webhookPayload}/${"a".repeat(64)}.webp`,
  ]);

  for (const [index, value] of [
    "fan@example.com",
    '{"provider":"secret"}',
    "provider reference",
  ].entries()) {
    await expectDatabaseFailure(
      client,
      { text: "SELECT $1::opaque_provider_reference", values: [value] },
      {
        code: "23514",
        messageIncludes: "opaque_provider_reference_check",
        label: `unsafe provider reference ${index + 1}`,
      },
    );
  }
  await client.query("SELECT $1::opaque_provider_reference", [
    "msg_01HZZZZZZZZZZZZZZZZZZZZZZZ",
  ]);

  await expectDatabaseFailure(
    client,
    "SELECT 'infinity'::timestamptz::finite_timestamptz",
    {
      code: "23514",
      messageIncludes: "finite_timestamptz_check",
      label: "infinite security expiry",
    },
  );
  await client.query(
    "SELECT (transaction_timestamp() + interval '1 hour')::finite_timestamptz",
  );
}

async function assertAppendOnlyGuards(client) {
  const tables = [
    {
      name: "audit_logs",
      id: ids.auditLog,
      update: `UPDATE audit_logs SET action = action WHERE id = '${ids.auditLog}'`,
    },
    {
      name: "inventory_ledger",
      id: ids.inventoryLedger,
      update: `UPDATE inventory_ledger SET reason_code = reason_code WHERE id = '${ids.inventoryLedger}'`,
    },
    {
      name: "payment_provider_health_events",
      id: ids.providerHealthEvent,
      update: `UPDATE payment_provider_health_events SET reason_code = reason_code WHERE id = '${ids.providerHealthEvent}'`,
    },
    {
      name: "webhook_inbox",
      id: ids.webhookInbox,
      update: `UPDATE webhook_inbox SET provider_event_id = provider_event_id WHERE id = '${ids.webhookInbox}'`,
    },
    {
      name: "outbox_events",
      id: ids.seededOutbox,
      update: `UPDATE outbox_events SET aggregate_version = aggregate_version WHERE id = '${ids.seededOutbox}'`,
    },
  ];

  for (const table of tables) {
    await expectDatabaseFailure(client, table.update, {
      code: "55000",
      messageIncludes: `${table.name} is append-only`,
      label: `${table.name} UPDATE append-only guard`,
    });
    await expectDatabaseFailure(
      client,
      `DELETE FROM ${table.name} WHERE id = '${table.id}'`,
      {
        code: "55000",
        messageIncludes: `${table.name} is append-only`,
        label: `${table.name} DELETE append-only guard`,
      },
    );
    await expectDatabaseFailure(client, `TRUNCATE ${table.name} CASCADE`, {
      code: "55000",
      messageIncludes: "is append-only",
      label: `${table.name} TRUNCATE append-only guard`,
    });
  }
}

async function assertRefundCounterGuard(client) {
  await expectDatabaseFailure(
    client,
    `UPDATE payment_attempts
        SET refund_occupied_minor = refund_occupied_minor + 1
      WHERE id = '${ids.capturedAttempt}'`,
    {
      code: "55000",
      messageIncludes: "refund capacity can only change from a refund trigger",
      label: "direct refund counter mutation guard",
    },
  );
}

async function runConstraintHarness(clientConfig) {
  const migrationResult = await runMigrations({
    clientConfig,
    workspaceRoot,
    command: { direction: "up", targetVersion: "0006" },
  });
  assertEqual(
    migrationResult.appliedVersions.join(","),
    expectedMigrationVersions.join(","),
    "fresh database did not apply migrations 0001 through 0006",
  );

  const observer = new Client({
    ...clientConfig,
    application_name: "postgres-constraints-observer",
  });
  const worker = new Client({
    ...clientConfig,
    application_name: "postgres-constraints-worker",
  });
  try {
    await Promise.all([observer.connect(), worker.connect()]);
    await seedConstraintFixtures(observer);
    const workerIdentity = await worker.query(
      "SELECT pg_backend_pid()::integer AS pid",
    );
    const workerPid = workerIdentity.rows[0]?.pid;
    if (!Number.isInteger(workerPid)) {
      fail("constraint worker connection has no PostgreSQL backend identity");
    }

    await assertFunctionSearchPathResistsTempShadow(observer);
    await assertSourceOutboxProvenanceMismatchRejected(observer);
    await assertOutboxSourceProvenanceMismatchRejected(observer);
    await runActiveAttemptRace(observer, worker, workerPid);
    await runRefundCapacityRace(observer, worker, workerPid);
    await assertWebhookPayloadDigestBinding(observer);
    await assertUnrelatedReconcileAuditRejected(observer);
    await assertLateSuccessRequiresAtomicAggregatePlan(observer);
    await assertNonTrackedSuccessNeedsNoReservationOrLateAudit(observer);
    await assertEveryTrackedLineNeedsReservation(observer);
    await assertLateSuccessNeedsAuditAndUsesOnHold(observer);
    await assertUnknownSuccessCommitsAvailableReservation(observer);
    await assertUnknownExpiryWindowAndLocks(observer);
    await assertRefundProviderAmountBinding(observer);
    await assertDisputeProviderAmountBinding(observer);
    await assertIdempotencyDataMinimization(observer);
    await assertMetadataBoundaryDomains(observer);
    await assertAppendOnlyGuards(observer);
    await assertRefundCounterGuard(observer);
    await assertAuthorityEvidenceBindings(observer);
    await assertWebhookEndpointLifecycleAndRetention(observer);
  } finally {
    await Promise.all([endQuietly(observer), endQuietly(worker)]);
  }

  return {
    migrations: expectedMigrationVersions.length,
    concurrencyScenarios: 2,
    evidenceAssertions: 5,
    aggregateBehaviorAssertions: 7,
    appendOnlyAssertions: 15,
    securityAssertions: 1,
    provenanceAssertions: 2,
    idempotencyDataMinimizationAssertions: 11,
    metadataBoundaryAssertions: 17,
    webhookLifecycleAssertions: 20,
    authorityEvidenceAssertions: 7,
    tamperAssertions: 1,
  };
}

if (process.argv.length > 2) {
  console.error("PostgreSQL constraint harness does not accept arguments");
  process.exitCode = 1;
} else {
  try {
    const result = await withEphemeralPostgres(async (clientConfig) => {
      try {
        return await runConstraintHarness(clientConfig);
      } catch (error) {
        if (
          error instanceof ConstraintHarnessError ||
          error instanceof MigrationManifestError ||
          error instanceof MigrationExecutionError
        ) {
          throw new EphemeralPostgresError(error.message);
        }
        const unexpectedMessage =
          error instanceof Error ? error.message : "unknown database error";
        throw new EphemeralPostgresError(
          `PostgreSQL constraint adversarial tests failed (${unexpectedMessage})`,
        );
      }
    });
    console.log(
      `PostgreSQL constraint adversarial tests passed (${result.migrations} migrations, ${result.concurrencyScenarios} concurrency scenarios, ${result.evidenceAssertions} evidence assertions, ${result.aggregateBehaviorAssertions} aggregate behavior assertions, ${result.appendOnlyAssertions} append-only assertions, ${result.securityAssertions} search-path assertion, ${result.provenanceAssertions} provenance assertions, ${result.idempotencyDataMinimizationAssertions} idempotency data-minimization assertions, ${result.metadataBoundaryAssertions} metadata boundary assertions, ${result.webhookLifecycleAssertions} webhook lifecycle assertions, ${result.authorityEvidenceAssertions} authority evidence assertions, ${result.tamperAssertions} tamper assertion).`,
    );
  } catch (error) {
    const message =
      error instanceof EphemeralPostgresError
        ? error.message
        : "PostgreSQL constraint adversarial tests failed";
    console.error(message);
    process.exitCode = 1;
  }
}
