import type { CartEditWriteMutationCommand } from "@fan-support/contracts";
import {
  cartEditEncryptedBytes,
  cartMutationReceipt,
  loadEditableCartItem,
  rejectCartEdit,
} from "./cart-edit-data.js";
import { cartTimestamp } from "./cart-runtime-data.js";
import { draftRows } from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";

/** A receipt records the expected old head before any of its bound changes. */
export async function writeCartMutation(
  client: TransactionClient,
  command: CartEditWriteMutationCommand,
) {
  const snapshot = await loadEditableCartItem(client, command);
  if (!snapshot) return rejectCartEdit("ITEM_NOT_FOUND");
  if (snapshot.intentVersion !== command.expectedIntentVersion)
    return rejectCartEdit("VERSION_CONFLICT");
  const change = command.change;
  const personal = change.kind === "PERSONALIZATION" ? change : null;
  const rows = await draftRows(
    client,
    `INSERT INTO public.cart_item_mutation_receipts(
 receipt_id,event_id,cart_id,cart_item_id,support_intent_id,mutation_kind,expected_cart_version,expected_item_version,expected_intent_version,
 cart_version,item_version,intent_version,quantity,observed_price_id,display_mode,has_fan_message,fan_message_locale,private_material_hash,
 presentation_locale,market,currency,request_id,correlation_id,occurred_at)
 SELECT $1::uuid,$2::uuid,c.id,item.id,intent.id,$3::text,c.version,item.version,intent.version,
 c.version+1,item.version+1,intent.version+CASE WHEN $3::text='QUANTITY' THEN 0 ELSE 1 END,
 CASE WHEN $3::text='QUANTITY' THEN $4::integer ELSE item.quantity END,
 CASE WHEN $3::text='QUANTITY' THEN $5::uuid ELSE item.observed_price_id END,
 CASE WHEN $3::text='PERSONALIZATION' THEN $6::text ELSE item.display_mode END,
 CASE WHEN $3::text='PERSONALIZATION' THEN $7::bytea IS NOT NULL ELSE item.has_fan_message END,
 CASE WHEN $3::text='PERSONALIZATION' THEN $8::text ELSE intent.fan_message_locale END,
 CASE WHEN $3::text='PERSONALIZATION' THEN public.cart_private_material_hash($7::bytea,$6::text,$9::bytea,$10::bytea,$11::text,$8::text)
 ELSE public.cart_private_material_hash(intent.fan_message_ciphertext,intent.display_mode,intent.display_name_ciphertext,intent.encrypted_data_key,intent.encryption_key_version,intent.fan_message_locale) END,
 $12::public.supported_locale,c.market,c.currency,$13::uuid,$14::uuid,
 GREATEST(clock_timestamp(),c.updated_at,item.updated_at,intent.updated_at)
 FROM public.carts c JOIN public.cart_items item ON item.cart_id=c.id JOIN public.support_intents intent ON intent.cart_item_id=item.id
 WHERE c.id=$15::uuid AND item.id=$16::uuid AND c.version=$17::bigint AND item.version=$18::bigint AND intent.version=$19::bigint
 RETURNING receipt_id,cart_id,cart_item_id,support_intent_id,mutation_kind,cart_version::text,item_version::text,intent_version::text,${cartTimestamp("occurred_at")} occurred_at`,
    [
      command.receiptId,
      command.eventId,
      change.kind,
      change.kind === "QUANTITY" ? change.quantity : null,
      change.kind === "QUANTITY" ? change.observedPriceId : null,
      personal?.displayMode ?? null,
      personal
        ? cartEditEncryptedBytes(personal.privateContent.fanMessageCiphertext)
        : null,
      personal?.fanMessageLocale ?? null,
      personal
        ? cartEditEncryptedBytes(personal.privateContent.displayNameCiphertext)
        : null,
      personal
        ? cartEditEncryptedBytes(personal.privateContent.encryptedDataKey)
        : null,
      personal?.privateContent.encryptionKeyVersion ?? null,
      command.presentationLocale,
      command.requestId,
      command.correlationId,
      command.cartId,
      command.itemId,
      command.expectedCartVersion,
      command.expectedItemVersion,
      command.expectedIntentVersion,
    ],
  );
  if (rows.length !== 1) return rejectCartEdit("VERSION_CONFLICT");
  const receipt = cartMutationReceipt(rows[0]!);
  if (personal) {
    await client.query(
      `UPDATE public.support_intents SET fan_message_ciphertext=$2::bytea,display_mode=$3::text,display_name_ciphertext=$4::bytea,
  encrypted_data_key=$5::bytea,encryption_key_version=$6::text,fan_message_locale=$7::text,version=version+1,updated_at=$8::timestamptz,
  moderation_status='PENDING',moderation_reason_code=NULL,moderation_decision_kind=NULL,moderation_reviewer_id=NULL,moderation_rule_version=NULL,moderation_evidence_id=NULL,reviewed_at=NULL
  WHERE id=$1::uuid`,
      [
        snapshot.supportIntentId,
        cartEditEncryptedBytes(personal.privateContent.fanMessageCiphertext),
        personal.displayMode,
        cartEditEncryptedBytes(personal.privateContent.displayNameCiphertext),
        cartEditEncryptedBytes(personal.privateContent.encryptedDataKey),
        personal.privateContent.encryptionKeyVersion,
        personal.fanMessageLocale,
        receipt.occurredAt,
      ],
    );
  } else if (change.kind === "REMOVE") {
    await client.query(
      `UPDATE public.support_intents SET status='CANCELED',version=version+1,updated_at=$2::timestamptz WHERE id=$1::uuid`,
      [snapshot.supportIntentId, receipt.occurredAt],
    );
  }
  await client.query(
    `UPDATE public.cart_items item SET quantity=receipt.quantity,observed_price_id=receipt.observed_price_id,
 display_mode=receipt.display_mode,has_fan_message=receipt.has_fan_message,version=item.version+1,updated_at=receipt.occurred_at
 FROM public.cart_item_mutation_receipts receipt WHERE receipt.receipt_id=$1::uuid AND item.id=receipt.cart_item_id`,
    [command.receiptId],
  );
  const updated = await draftRows(
    client,
    `UPDATE public.carts c SET version=c.version+1,presentation_locale=receipt.presentation_locale,updated_at=receipt.occurred_at
 FROM public.cart_item_mutation_receipts receipt WHERE receipt.receipt_id=$1::uuid AND c.id=receipt.cart_id
 AND c.version=receipt.expected_cart_version AND c.status='ACTIVE' AND c.expires_at>clock_timestamp() RETURNING c.id`,
    [command.receiptId],
  );
  if (updated.length !== 1) return rejectCartEdit("CART_EXPIRED");
  await client.query(
    `INSERT INTO public.cart_edit_outbox_events(event_id,receipt_id,event_type,aggregate_id,cart_item_id,request_id,correlation_id,occurred_at)
 SELECT event_id,receipt_id,CASE WHEN mutation_kind='REMOVE' THEN 'CART_ITEM_REMOVED' ELSE 'CART_ITEM_UPDATED' END,
 cart_id,cart_item_id,request_id,correlation_id,occurred_at FROM public.cart_item_mutation_receipts WHERE receipt_id=$1::uuid`,
    [command.receiptId],
  );
  return receipt;
}
