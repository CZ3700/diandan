import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  checkoutPreflightReceiptSchema,
  type CheckoutPreflightCommitCommand,
  type CheckoutPreflightObservation,
  type CheckoutPreflightLineFacts,
  type CheckoutTranslationSnapshot,
} from "@fan-support/contracts";
import {
  checkoutEventTime,
  rejectCheckout,
} from "./checkout-preflight-data.js";
import { draftRows } from "./content-draft-data.js";
import { resolveOrderLineGiftKind } from "./order-line-gift-kind.js";
import type { TransactionClient } from "./transaction-runner.js";

/** Table and columns come only from this module's fixed row builders. Values are always parameters. */
async function insert(
  client: TransactionClient,
  table: string,
  row: Record<string, unknown>,
) {
  const names = Object.keys(row);
  await client.query(
    `INSERT INTO public.${table} (${names.join(",")}) VALUES (${names.map((_, index) => `$${index + 1}`).join(",")})`,
    Object.values(row),
  );
}
const encrypted = (value: string) =>
  Buffer.from(value.slice("enc:v1:".length), "base64url");
function sourceColumns(prefix: string, source: CheckoutTranslationSnapshot) {
  return {
    [`${prefix}_translation_revision_id`]:
      source.mode === "APPROVED" ? source.translationRevisionId : null,
    [`${prefix}_daily_translation_id`]:
      source.mode === "DAILY" ? source.translationRevisionId : null,
    [`${prefix}_requested_locale`]: source.requestedLocale,
    [`${prefix}_resolved_locale`]: source.resolvedLocale,
    [`${prefix}_fallback_used`]: source.fallbackUsed,
  };
}
function lineSnapshot(line: CheckoutPreflightLineFacts) {
  const idol = sourceColumns("idol", line.idolTranslation),
    gift = sourceColumns("gift", line.giftTranslation);
  // Content and media historically use different column prefixes; retain the exact old names.
  const translated = (values: Record<string, unknown>, prefix: string) =>
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key
          .replace(`${prefix}_requested_`, `${prefix}_translation_requested_`)
          .replace(`${prefix}_resolved_`, `${prefix}_translation_resolved_`)
          .replace(`${prefix}_fallback_`, `${prefix}_translation_fallback_`),
        value,
      ]),
    );
  return {
    idol_id: line.idolId,
    idol_handle: line.idolHandle,
    idol_display_name: line.idolDisplayName,
    ...translated(idol, "idol"),
    idol_portrait_asset_id: line.idolPortrait.assetId,
    idol_portrait_checksum_sha256: line.idolPortrait.checksum,
    idol_portrait_object_key: line.idolPortrait.objectKey,
    idol_portrait_metadata_revision_id: line.idolPortrait.metadataRevisionId,
    idol_portrait_alt: line.idolPortrait.alt,
    ...sourceColumns("idol_portrait_alt", line.idolPortrait.altTranslation),
    gift_id: line.giftId,
    gift_variant_id: line.giftVariantId,
    gift_title: line.giftTitle,
    ...translated(gift, "gift"),
    gift_image_asset_id: line.giftImage.assetId,
    gift_image_checksum_sha256: line.giftImage.checksum,
    gift_image_object_key: line.giftImage.objectKey,
    gift_image_metadata_revision_id: line.giftImage.metadataRevisionId,
    gift_image_alt: line.giftImage.alt,
    ...sourceColumns("gift_image_alt", line.giftImage.altTranslation),
    display_mode: line.displayMode,
  };
}

export async function writeCheckout(
  client: TransactionClient,
  command: CheckoutPreflightCommitCommand,
  observation: CheckoutPreflightObservation,
) {
  const { consent, quote } = observation,
    amount = quote.amount;
  if (
    command.items.length !== consent.lines.length ||
    command.items.some(
      (item) =>
        !consent.lines.some((line) => line.cartItemId === item.cartItemId),
    )
  )
    return rejectCheckout("INVALID_COMMAND");
  const eventTime = await checkoutEventTime(client, command.cartId);
  const [valid] = await draftRows(
    client,
    `SELECT $1::timestamptz>clock_timestamp() AND $1::timestamptz>$2::timestamptz valid`,
    [observation.expiresAt, eventTime],
  );
  if (valid?.["valid"] !== true) return rejectCheckout("PREFLIGHT_EXPIRED");
  await insert(client, "customer_contacts", {
    id: command.contact.id,
    email_ciphertext: encrypted(command.contact.emailCiphertext),
    encrypted_data_key: encrypted(command.contact.encryptedDataKey),
    encryption_key_version: command.contact.encryptionKeyVersion,
    email_lookup_hmac: Buffer.from(command.contact.emailLookupHmac, "hex"),
    lookup_key_version: command.contact.lookupKeyVersion,
    retention_status: "ACTIVE",
    created_at: eventTime,
  });
  const amounts = {
    subtotal_minor: amount.subtotalMinor,
    tax_amount_minor: amount.taxAmountMinor,
    shipping_amount_minor: amount.shippingAmountMinor,
    fee_amount_minor: amount.feeAmountMinor,
    discount_amount_minor: amount.discountAmountMinor,
    total_amount_minor: amount.totalAmountMinor,
  };
  await insert(client, "checkout_sessions", {
    id: command.checkoutSessionId,
    cart_id: command.cartId,
    quote_id: quote.id,
    cart_version: quote.cartVersion,
    status: "READY",
    market: consent.market,
    currency: consent.currency,
    quote_revision: amount.quoteRevision,
    quote_expires_at: quote.expiresAt,
    ...amounts,
    created_at: eventTime,
    expires_at: observation.expiresAt,
    updated_at: eventTime,
  });
  await insert(client, "orders", {
    id: command.orderId,
    public_order_id: command.publicOrderId,
    checkout_session_id: command.checkoutSessionId,
    checkout_quote_id: quote.id,
    cart_id: command.cartId,
    customer_contact_id: command.contact.id,
    presentation_locale: consent.presentationLocale,
    market: consent.market,
    currency: consent.currency,
    quote_revision: amount.quoteRevision,
    quote_expires_at: quote.expiresAt,
    ...amounts,
    order_status: "DRAFT",
    payment_status: "UNPAID",
    dispute_status: "NONE",
    fulfillment_status: "PENDING",
    version: 1,
    created_at: eventTime,
    updated_at: eventTime,
  });
  const event = {
    order_id: command.orderId,
    to_payment_status: "UNPAID",
    to_dispute_status: "NONE",
    to_fulfillment_status: "PENDING",
    authority_kind: "CHECKOUT",
    request_id: command.requestId,
    correlation_id: command.correlationId,
    occurred_at: eventTime,
  };
  await insert(client, "order_events", {
    id: command.createdOrderEventId,
    sequence: 1,
    event_type: "ORDER_CREATED",
    to_order_status: "DRAFT",
    reason_code: "ORDER_CREATED",
    ...event,
  });
  for (const line of consent.lines) {
    const ids = command.items.find(
      (item) => item.cartItemId === line.cartItemId,
    )!;
    const priced = quote.lines.find(
      (item) => item.cartItemId === line.cartItemId,
    )!;
    const price = {
      price_id: priced.priceId,
      price_revision: priced.priceRevision,
      quantity: priced.quantity,
      unit_amount_minor: priced.unitAmountMinor,
      line_subtotal_minor: priced.lineSubtotalMinor,
      tax_amount_minor: priced.taxAmountMinor,
      discount_amount_minor: priced.discountAmountMinor,
      line_total_minor: priced.lineTotalMinor,
    };
    await insert(client, "checkout_quote_lines", {
      id: randomUUID(),
      checkout_session_id: command.checkoutSessionId,
      checkout_quote_id: quote.id,
      cart_item_id: line.cartItemId,
      gift_variant_id: line.giftVariantId,
      ...price,
    });
    const locked = await draftRows(
      client,
      `UPDATE public.support_intents SET status='CHECKOUT_LOCKED',version=version+1,updated_at=$4::timestamptz WHERE id=$1::uuid AND cart_item_id=$2::uuid AND version=$3::bigint AND status='ACTIVE' AND privacy_state='ACTIVE' AND expires_at>clock_timestamp() RETURNING id`,
      [line.supportIntentId, line.cartItemId, line.intentVersion, eventTime],
    );
    if (locked.length !== 1) return rejectCheckout("PREFLIGHT_CHANGED");
    // ADR-019: freeze the purchase-time gift kind from the same revision the snapshot references.
    const giftKind = await resolveOrderLineGiftKind(client, {
      giftId: line.giftId,
      giftTranslationRevisionId:
        line.giftTranslation.mode === "APPROVED"
          ? line.giftTranslation.translationRevisionId
          : null,
      giftDailyTranslationId:
        line.giftTranslation.mode === "DAILY"
          ? line.giftTranslation.translationRevisionId
          : null,
    });
    await insert(client, "order_items", {
      id: ids.orderItemId,
      schema_version: 2,
      checkout_preflight_id: observation.id,
      order_id: command.orderId,
      cart_item_id: line.cartItemId,
      support_intent_id: line.supportIntentId,
      ...lineSnapshot(line),
      ...price,
      currency: consent.currency,
      gift_kind: giftKind,
      created_at: eventTime,
    });
    await insert(client, "fulfillments", {
      id: ids.fulfillmentId,
      order_id: command.orderId,
      order_item_id: ids.orderItemId,
      idol_id: line.idolId,
      fulfillment_profile_id: line.fulfillmentProfileId,
      status: "PENDING",
      version: 1,
      created_at: eventTime,
      updated_at: eventTime,
    });
    await insert(client, "fulfillment_events", {
      id: ids.fulfillmentEventId,
      fulfillment_id: ids.fulfillmentId,
      order_id: command.orderId,
      sequence: 1,
      to_status: "PENDING",
      authority_kind: "SYSTEM",
      reason_code: "FULFILLMENT_CREATED",
      request_id: command.requestId,
      correlation_id: command.correlationId,
      occurred_at: eventTime,
    });
  }
  for (const policy of consent.policies)
    await insert(client, "policy_acceptances", {
      id: randomUUID(),
      order_id: command.orderId,
      policy_key: policy.policyKey,
      locale: policy.locale,
      policy_revision_id: policy.policyRevisionId,
      policy_translation_revision_id: policy.policyTranslationRevisionId,
      accepted_at: eventTime,
      recorded_at: eventTime,
    });
  await client.query(
    `UPDATE public.orders SET order_status='PENDING_PAYMENT',version=2,updated_at=$2::timestamptz WHERE id=$1::uuid`,
    [command.orderId, eventTime],
  );
  await insert(client, "order_events", {
    id: command.pendingOrderEventId,
    sequence: 2,
    event_type: "LIFECYCLE_CHANGED",
    from_order_status: "DRAFT",
    to_order_status: "PENDING_PAYMENT",
    from_payment_status: "UNPAID",
    from_dispute_status: "NONE",
    from_fulfillment_status: "PENDING",
    reason_code: "ORDER_CHECKOUT_CREATED",
    ...event,
  });
  const carts = await draftRows(
    client,
    `UPDATE public.carts SET status='LOCKED',locked_order_id=$2::uuid,presentation_locale=$3,version=version+1,updated_at=$4::timestamptz WHERE id=$1::uuid AND version=$5::bigint AND status='ACTIVE' AND expires_at>clock_timestamp() RETURNING version::text`,
    [
      command.cartId,
      command.orderId,
      consent.presentationLocale,
      eventTime,
      command.expectedCartVersion,
    ],
  );
  if (carts.length !== 1) return rejectCheckout("VERSION_CONFLICT");
  const cartVersion = Number(carts[0]!["version"]);
  await insert(client, "checkout_preflight_receipts", {
    preflight_id: observation.id,
    cart_id: command.cartId,
    cart_version: cartVersion,
    checkout_session_id: command.checkoutSessionId,
    order_id: command.orderId,
    public_order_id: command.publicOrderId,
    event_id: command.eventId,
    request_id: command.requestId,
    correlation_id: command.correlationId,
    occurred_at: eventTime,
  });
  await insert(client, "checkout_outbox_events", {
    event_id: command.eventId,
    preflight_id: observation.id,
    event_type: "CHECKOUT_CREATED",
    order_id: command.orderId,
    checkout_session_id: command.checkoutSessionId,
    request_id: command.requestId,
    correlation_id: command.correlationId,
    occurred_at: eventTime,
    status: "PENDING",
  });
  return checkoutPreflightReceiptSchema.parse({
    schemaVersion: 1,
    preflightId: observation.id,
    cartId: command.cartId,
    cartVersion,
    checkoutSessionId: command.checkoutSessionId,
    orderId: command.orderId,
    publicOrderId: command.publicOrderId,
    occurredAt: eventTime,
  });
}
