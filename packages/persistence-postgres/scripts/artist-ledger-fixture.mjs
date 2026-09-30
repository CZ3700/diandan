// ADR-022 / L3-12: replica-seeded artists, assignments and paid orders for ledger checks. No checkout,
// payment or refund lifecycle runs here, so data seeded this way is never lifecycle evidence.
import { randomBytes, randomUUID } from "node:crypto";

/** Random bytes stand in for ciphertext when no key service is given; such messages cannot be decrypted. */
async function placeholderEnvelope() {
  return {
    fanMessageCiphertext: randomBytes(48),
    displayNameCiphertext: randomBytes(32),
    encryptedDataKey: randomBytes(32),
    keyVersion: "fixture-v1",
  };
}

/**
 * `actor` writes the assignment audits; `reviewer` decides moderated messages. `encrypt(intentId, text)`
 * may return a real envelope ({ fanMessageCiphertext, displayNameCiphertext, encryptedDataKey, keyVersion })
 * so a browser can reveal the message through the application's own decryption.
 */
export function createLedgerSeeder(
  client,
  { actor, reviewer, encrypt = placeholderEnvelope },
) {
  const items = {};
  const assignments = new Map();
  async function seed(work) {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL session_replication_role=replica");
      const result = await work();
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }
  async function artist(handle) {
    const id = randomUUID();
    await client.query(
      "INSERT INTO idols(id,handle,status,accepting_gifts,version) VALUES($1,$2,'active',true,2)",
      [id, handle],
    );
    return id;
  }
  async function assign(artistId, brokerId) {
    const previous = assignments.get(artistId) ?? {
      sequence: 0,
      brokerId: null,
    };
    const audit = randomUUID();
    assignments.set(artistId, { sequence: previous.sequence + 1, brokerId });
    await client.query(
      "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,'IDOL_ASSIGNMENT','IDOL',$3,'ASSIGNED',$1,$1,'SUCCEEDED','IDOL_ASSIGNMENT')",
      [audit, actor.actorId, artistId],
    );
    await client.query(
      "INSERT INTO idol_assignments(id,idol_id,sequence,broker_identity_id,previous_broker_identity_id,reason,operation_id,actor_id,session_id,audit_log_id,request_id,created_at) VALUES($1,$2,$3,$4,$5,'ASSIGNED',NULL,$6,$7,$8,$8,transaction_timestamp())",
      [
        randomUUID(),
        artistId,
        previous.sequence + 1,
        brokerId,
        previous.brokerId,
        actor.actorId,
        actor.sessionId,
        audit,
      ],
    );
  }
  /**
   * One order. `paidAt` is the succeeded payment's time (an unpaid order gets a failed attempt at that time
   * instead). Lines: { key, artistId, qty, unit, status, kind, message: { moderation, locale, text, name } }.
   * Refunds: { status, items: [[lineKey, amountMinor]] }.
   */
  async function order({
    currency = "USD",
    environment = "LIVE",
    paidAt,
    state = "PAID",
    dispute = "NONE",
    lines,
    refunds = [],
  }) {
    const id = randomUUID(),
      cart = randomUUID(),
      attempt = randomUUID(),
      total = lines.reduce((sum, line) => sum + line.qty * line.unit, 0);
    const paid = state === "PAID";
    await client.query(
      `INSERT INTO carts(id,token_digest,token_pepper_version,presentation_locale,market,currency,status,version,expires_at,locked_order_id)
      VALUES($1,$4,'fixture-v1','en','US',$2,'CONVERTED',1,transaction_timestamp()+interval '1 hour',$3)`,
      [cart, currency, id, randomBytes(32)],
    );
    await client.query(
      `INSERT INTO orders(id,public_order_id,checkout_session_id,checkout_quote_id,cart_id,customer_contact_id,presentation_locale,market,currency,quote_revision,quote_expires_at,subtotal_minor,total_amount_minor,order_status,payment_status,dispute_status,fulfillment_status,current_payment_attempt_id,version)
      VALUES($1,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),$2,gen_random_uuid(),'en','US',$3,1,transaction_timestamp()+interval '1 hour',$4,$4,$5,$6,$7,$8,$9,3)`,
      [
        id,
        cart,
        currency,
        total,
        paid ? "OPEN" : state === "CANCELED" ? "CANCELED" : "PENDING_PAYMENT",
        paid ? "PAID" : "UNPAID",
        dispute,
        state === "CANCELED" ? "CANCELED" : "PENDING",
        paid ? attempt : null,
      ],
    );
    const at = paidAt ?? new Date().toISOString();
    await client.query(
      `INSERT INTO payment_attempts(id,order_id,provider_account_id,environment,config_version_id,config_version,route_rule_id,rule_version,payment_method,status,amount_minor,currency,requested_locale,provider_locale,provider_locale_fallback_used,merchant_reference,provider_idempotency_key,return_state_digest,return_state_expires_at,status_evidence_kind,created_at,updated_at,succeeded_at,terminated_at)
      VALUES($1,$2,gen_random_uuid(),$3,gen_random_uuid(),1,gen_random_uuid(),1,'card',$4,$5,$6,'en','en',false,$11,$11,decode(repeat('cd',32),'hex'),$7::timestamptz+interval '1 hour',$8,$7::timestamptz-interval '1 minute',$7::timestamptz,$9,$10)`,
      [
        attempt,
        id,
        environment,
        paid ? "SUCCEEDED" : "FAILED",
        total,
        currency,
        at,
        paid ? "VERIFIED_WEBHOOK" : "CREATE_RESULT",
        paid ? at : null,
        paid ? null : at,
        attempt,
      ],
    );
    for (const [index, line] of lines.entries()) {
      const item = randomUUID(),
        cartItem = randomUUID(),
        intent = randomUUID(),
        message = line.message ?? null;
      items[line.key] = { item, intent, order: id };
      await client.query(
        `INSERT INTO cart_items(id,cart_id,gift_variant_id,observed_price_id,quantity,display_mode,has_fan_message,request_id,correlation_id)
        VALUES($1,$2,gen_random_uuid(),gen_random_uuid(),$3,$4,$5,gen_random_uuid(),gen_random_uuid())`,
        [
          cartItem,
          cart,
          line.qty,
          message ? "nickname" : "anonymous",
          message !== null,
        ],
      );
      const envelope = message
        ? await encrypt(intent, {
            text: message.text ?? "Fixture message",
            name: message.name ?? "Fixture fan",
          })
        : {
            ...(await placeholderEnvelope()),
            fanMessageCiphertext: null,
            displayNameCiphertext: null,
          };
      const decided = message && message.moderation !== "PENDING";
      await client.query(
        `INSERT INTO support_intents(id,cart_item_id,idol_id,fan_message_ciphertext,display_mode,display_name_ciphertext,encrypted_data_key,encryption_key_version,privacy_state,moderation_status,moderation_reason_code,moderation_decision_kind,moderation_reviewer_id,reviewed_at,created_presentation_locale,fan_message_locale,status,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE',$9,$10,$11,$12,$13,'en',$14,'CONVERTED',transaction_timestamp()+interval '1 hour')`,
        [
          intent,
          cartItem,
          line.artistId,
          envelope.fanMessageCiphertext,
          message ? "nickname" : "anonymous",
          envelope.displayNameCiphertext,
          envelope.encryptedDataKey,
          envelope.keyVersion,
          message?.moderation ?? "PENDING",
          decided && message.moderation !== "APPROVED"
            ? "FIXTURE_REJECTED"
            : null,
          decided ? "HUMAN" : null,
          decided ? reviewer : null,
          decided ? new Date().toISOString() : null,
          message?.locale ?? "und",
        ],
      );
      await client.query(
        `INSERT INTO order_items(id,order_id,cart_item_id,support_intent_id,idol_id,idol_handle,idol_display_name,idol_translation_revision_id,
          idol_translation_requested_locale,idol_translation_resolved_locale,idol_translation_fallback_used,idol_portrait_asset_id,
          idol_portrait_checksum_sha256,idol_portrait_object_key,idol_portrait_metadata_revision_id,idol_portrait_alt,
          idol_portrait_alt_translation_revision_id,idol_portrait_alt_requested_locale,idol_portrait_alt_resolved_locale,
          idol_portrait_alt_fallback_used,gift_id,gift_variant_id,gift_title,gift_translation_revision_id,gift_translation_requested_locale,
          gift_translation_resolved_locale,gift_translation_fallback_used,gift_image_asset_id,gift_image_checksum_sha256,gift_image_object_key,
          gift_image_metadata_revision_id,gift_image_alt,gift_image_alt_translation_revision_id,gift_image_alt_requested_locale,
          gift_image_alt_resolved_locale,gift_image_alt_fallback_used,price_id,price_revision,quantity,unit_amount_minor,line_subtotal_minor,
          tax_amount_minor,discount_amount_minor,line_total_minor,currency,display_mode,gift_kind,created_at)
        VALUES($1,$2,$3,$4,$5,'ledger-fixture-idol','Ledger Idol',gen_random_uuid(),'en','en',false,gen_random_uuid(),repeat('a',64),'ledger-fixture/portrait.webp',gen_random_uuid(),'Ledger idol portrait',gen_random_uuid(),'en','en',false,
          gen_random_uuid(),gen_random_uuid(),$6,gen_random_uuid(),'en','en',false,gen_random_uuid(),repeat('b',64),'ledger-fixture/gift.webp',gen_random_uuid(),'Ledger gift image',gen_random_uuid(),'en','en',false,
          gen_random_uuid(),1,$7,$8,$9,0,0,$9,$10,$11,$12,transaction_timestamp()+$13::int*interval '1 millisecond')`,
        [
          item,
          id,
          cartItem,
          intent,
          line.artistId,
          line.title ?? `Gift ${line.key}`,
          line.qty,
          line.unit,
          line.qty * line.unit,
          currency,
          message ? "nickname" : "anonymous",
          line.kind ?? "PHYSICAL",
          index,
        ],
      );
      const status = line.status ?? "PENDING";
      await client.query(
        `INSERT INTO fulfillments(id,order_id,order_item_id,idol_id,fulfillment_profile_id,status,hold_reason_code,prepared_at,delivered_at)
        VALUES(gen_random_uuid(),$1,$2,$3,gen_random_uuid(),$4,CASE WHEN $4::text IN('ON_HOLD','CANCELED') THEN 'FIXTURE_HOLD' END,
         CASE WHEN $4::text IN('PREPARING','DELIVERED') THEN transaction_timestamp() END,CASE WHEN $4::text='DELIVERED' THEN transaction_timestamp() END)`,
        [id, item, line.artistId, status],
      );
    }
    for (const refund of refunds) {
      const refundId = randomUUID(),
        amount = refund.items.reduce((sum, [, value]) => sum + value, 0);
      await client.query(
        `INSERT INTO refunds(id,order_id,payment_attempt_id,provider_account_id,environment,provider_reference,idempotency_key,requested_audit_log_id,captured_currency,currency,captured_amount_minor,requested_amount_minor,processed_amount_minor,status,status_evidence_kind,completed_at)
        VALUES($1,$2,$3,gen_random_uuid(),$4,$5,$6,gen_random_uuid(),$7,$7,$8,$9,$10,$11,$12,$13)`,
        [
          refundId,
          id,
          attempt,
          environment,
          `refund-${refundId}`,
          `refund-key-${refundId}`,
          currency,
          total,
          amount,
          refund.status === "SUCCEEDED" ? amount : 0,
          refund.status,
          refund.status === "SUCCEEDED"
            ? "VERIFIED_WEBHOOK"
            : "REFUND_REQUESTED",
          refund.status === "SUCCEEDED" || refund.status === "FAILED"
            ? new Date().toISOString()
            : null,
        ],
      );
      for (const [key, value] of refund.items)
        await client.query(
          "INSERT INTO refund_items(id,refund_id,order_id,order_item_id,amount_minor) VALUES(gen_random_uuid(),$1,$2,$3,$4)",
          [refundId, id, items[key].item, value],
        );
    }
    return id;
  }
  return { items, seed, artist, assign, order };
}
