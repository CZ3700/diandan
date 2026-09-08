import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

export async function checkoutBusinessCounts(client) {
  return (
    await client.query(`select
    (select count(*)::int from orders) as orders,
    (select count(*)::int from checkout_sessions) as sessions,
    (select count(*)::int from checkout_quote_lines) as quote_lines,
    (select count(*)::int from order_items) as order_items,
    (select count(*)::int from customer_contacts) as contacts,
    (select count(*)::int from policy_acceptances) as acceptances,
    (select count(*)::int from fulfillments) as fulfillments,
    (select count(*)::int from inventory_reservations) as reservations,
    (select count(*)::int from checkout_preflight_receipts) as checkout_receipts,
    (select count(*)::int from checkout_outbox_events) as checkout_outbox,
    (select count(*)::int from payment_attempts) as payment_attempts`)
  ).rows[0];
}

/** Only the digest leaves the callback; neither ciphertext nor private contact values are written to evidence. */
export async function checkoutSnapshotFingerprint(client, checkoutSessionId) {
  const rows = (
    await client.query(
      `select to_jsonb(o) as order_snapshot,
    (select jsonb_agg(to_jsonb(i) order by i.id) from order_items i where i.order_id=o.id) as item_snapshots,
    (select jsonb_agg(to_jsonb(p) order by p.policy_key) from policy_acceptances p where p.order_id=o.id) as policies,
    (select jsonb_agg(to_jsonb(e) order by e.id) from outbox_events e where e.event_type='FULFILLMENT_STATUS_CHANGED' and e.secondary_subject_id=o.id) as fulfillment_outbox
    from orders o where o.checkout_session_id=$1`,
      [checkoutSessionId],
    )
  ).rows;
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

export async function verifyStoredCheckout({
  client,
  kms,
  check,
  checkout,
  email,
  expectedReservations = 0,
}) {
  const rows = (
    await client.query(
      `select o.*, c.status as cart_status,
    (select count(*)::int from order_items i where i.order_id=o.id) as line_count,
    (select count(*)::int from fulfillments f where f.order_id=o.id) as fulfillment_count,
    (select count(*)::int from order_events e where e.order_id=o.id) as event_count,
    (select count(*)::int from outbox_events e where e.event_type='FULFILLMENT_STATUS_CHANGED' and e.secondary_subject_id=o.id) as fulfillment_outbox_count,
    (select count(*)::int from fulfillments f where f.order_id=o.id and
      (select count(*) from fulfillment_events fe join outbox_events e
        on e.id=fe.id and e.event_type='FULFILLMENT_STATUS_CHANGED' and e.aggregate_type='FULFILLMENT'
        and e.payload_status='PENDING'
        and e.aggregate_id=fe.fulfillment_id and e.aggregate_version=fe.sequence
        and e.primary_subject_id=fe.fulfillment_id and e.secondary_subject_id=fe.order_id
        and e.request_id=fe.request_id and e.correlation_id=fe.correlation_id
        and e.occurred_at=fe.occurred_at and e.locale=o.presentation_locale
        and e.market=o.market and e.currency=o.currency
        where fe.fulfillment_id=f.id and fe.order_id=o.id and fe.sequence=1 and fe.to_status='PENDING')=1
    ) as exact_fulfillment_outbox_count,
    (select count(*)::int from checkout_preflight_receipts r where r.order_id=o.id and r.checkout_session_id=o.checkout_session_id) as receipt_count,
    (select count(*)::int from checkout_outbox_events e where e.order_id=o.id and e.checkout_session_id=o.checkout_session_id and e.event_type='CHECKOUT_CREATED' and e.status='PENDING') as outbox_count,
    (select count(*)::int from inventory_reservations r where r.checkout_session_id=o.checkout_session_id and r.status='ACTIVE') as active_reservations,
    (select count(*)::int from payment_attempts p where p.order_id=o.id) as payment_count
    from orders o join carts c on c.id=o.cart_id where o.checkout_session_id=$1`,
      [checkout.id],
    )
  ).rows;
  check(rows.length === 1, "one checkout creates exactly one actual order");
  const order = rows[0];
  check(
    order.order_status === "PENDING_PAYMENT" &&
      order.payment_status === "UNPAID" &&
      order.cart_status === "LOCKED",
    "actual checkout locks cart and creates only an unpaid pending order",
  );
  check(
    order.line_count === checkout.lines.length &&
      order.fulfillment_count === checkout.lines.length,
    "every order line has one actual fulfillment profile binding",
  );
  check(
    order.event_count === 2,
    "actual order has its origin and pending state events",
  );
  check(
    order.receipt_count === 1 && order.outbox_count === 1,
    "one immutable checkout receipt and pending outbox event commit with the order",
  );
  check(
    order.fulfillment_outbox_count === checkout.lines.length &&
      order.exact_fulfillment_outbox_count === checkout.lines.length,
    "each initial fulfillment has exactly one durable event with matching identity, sequence, time, request and order language/scope",
  );
  check(
    order.active_reservations === expectedReservations,
    "only tracked lines create actual active reservations",
  );
  check(
    order.payment_count === 0,
    "checkout preflight does not create a payment attempt",
  );
  check(
    order.presentation_locale === checkout.presentationLocale &&
      order.market === checkout.market &&
      order.currency === checkout.currency,
    "stored order language and commerce scope match the historical public snapshot",
  );
  check(
    Number(order.total_amount_minor) === checkout.amount.totalAmountMinor,
    "stored order amount is the server quote total",
  );
  const acceptances = (
    await client.query(
      "select policy_key, policy_revision_id, policy_translation_revision_id, locale from policy_acceptances where order_id=$1 order by policy_key",
      [order.id],
    )
  ).rows;
  check(
    acceptances.length === checkout.policies.length &&
      acceptances.every((row) =>
        checkout.policies.some(
          (policy) =>
            policy.policyKey === row.policy_key &&
            policy.policyRevisionId === row.policy_revision_id &&
            policy.policyTranslationRevisionId ===
              row.policy_translation_revision_id &&
            policy.locale === row.locale,
        ),
      ),
    "policy acceptance stores each exact displayed revision and language",
  );
  const contact = (
    await client.query("select * from customer_contacts where id=$1", [
      order.customer_contact_id,
    ])
  ).rows[0];
  check(
    contact.retention_status === "ACTIVE" &&
      contact.email_ciphertext instanceof Buffer &&
      contact.encrypted_data_key instanceof Buffer &&
      contact.email_lookup_hmac?.length === 32,
    "contact is envelope encrypted with a keyed lookup digest",
  );
  const decrypted = await kms.adapter.decryptEnvelope({
    schemaVersion: 1,
    operation: "DECRYPT_ENVELOPE",
    purpose: "CUSTOMER_CONTACT_EMAIL",
    subjectId: contact.id,
    algorithm: "AES_256_GCM",
    ciphertext: `enc:v1:${contact.email_ciphertext.toString("base64url")}`,
    encryptedDataKey: `enc:v1:${contact.encrypted_data_key.toString("base64url")}`,
    keyVersion: contact.encryption_key_version,
  });
  check(
    decrypted.outcome === "SUCCESS",
    "real KMS adapter decrypts the stored TEST contact envelope",
  );
  const clear = Buffer.from(decrypted.value.plaintextBase64, "base64url");
  try {
    check(
      clear.toString("utf8") === email,
      "encrypted checkout contact preserves the exact submitted email",
    );
  } finally {
    clear.fill(0);
  }
  const digest = await kms.adapter.computeBlindIndex({
    schemaVersion: 1,
    operation: "COMPUTE_BLIND_INDEX",
    purpose: "CUSTOMER_CONTACT_EMAIL_LOOKUP",
    keyVersion: contact.lookup_key_version,
    valueBase64: Buffer.from(email.normalize("NFC").toLowerCase()).toString(
      "base64url",
    ),
  });
  check(
    digest.outcome === "SUCCESS" &&
      Buffer.from(digest.value.digestBase64, "base64url").equals(
        contact.email_lookup_hmac,
      ),
    "contact lookup equals the purpose-separated normalized keyed digest",
  );
  return {
    lines: order.line_count,
    fulfillments: order.fulfillment_count,
    orderEvents: order.event_count,
    checkoutReceipts: order.receipt_count,
    checkoutOutboxEvents: order.outbox_count,
    fulfillmentOutboxEvents: order.fulfillment_outbox_count,
    reservations: order.active_reservations,
    paymentAttempts: order.payment_count,
  };
}
