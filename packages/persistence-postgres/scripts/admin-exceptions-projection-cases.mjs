import { randomUUID } from "node:crypto";

/** Isolated historical projection fixtures; this deliberately does not claim lifecycle acceptance. */
export async function verifyExceptionProjection({ client, run, check, actor }) {
  const cases = [];
  await client.query("BEGIN");
  await client.query("SET LOCAL session_replication_role=replica");
  try {
    for (const kind of ["SENT", "FAILED", "UNKNOWN", "PENDING"]) {
      const order = randomUUID(),
        base = randomUUID(),
        manual = randomUUID(),
        contact = randomUUID();
      await client.query(
        `INSERT INTO orders(id,public_order_id,checkout_session_id,checkout_quote_id,cart_id,customer_contact_id,presentation_locale,market,currency,quote_revision,quote_expires_at,subtotal_minor,total_amount_minor,order_status,payment_status,dispute_status,fulfillment_status,current_payment_attempt_id)
        VALUES($1,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),$2,'en','US','USD',1,clock_timestamp()+interval '1 hour',100,100,'OPEN','PAID','NONE','PENDING',gen_random_uuid())`,
        [order, contact],
      );
      await client.query(
        `INSERT INTO notification_deliveries(id,order_id,customer_contact_id,event_type,requested_locale,resolved_locale,fallback_used,template_key,template_version,idempotency_key,request_id,correlation_id,status,last_error_code)
        VALUES($1,$2,$3,'PAYMENT_CONFIRMED','en','en',false,'order.receipt','1',$4,gen_random_uuid(),gen_random_uuid(),$5,$6)`,
        [
          base,
          order,
          contact,
          `projection:${base}`,
          kind === "PENDING" ? "REQUESTED" : "FAILED",
          kind === "PENDING" ? null : "TEST_FAILURE",
        ],
      );
      if (kind !== "PENDING") {
        await client.query(
          `INSERT INTO admin_notification_resends(id,order_id,customer_contact_id,base_notification_id,source_outbox_event_id,order_version,resend_sequence,event_type,event_rank,requested_locale,resolved_locale,fallback_used,template_key,template_version,base_variables,public_storefront_origin,transport_key,contact_lookup_hmac,contact_lookup_key_version,link_nonce,link_pepper_version,link_ttl_seconds,dedupe_until,actor_id,session_id,command_idempotency_key,request_hash,reason_code,audit_log_id,idempotency_key,request_id,correlation_id,status,sent_at,last_error_code,created_at,updated_at)
          VALUES($1,$2,$3,$4,gen_random_uuid(),1,1,'PAYMENT_CONFIRMED',1,'en','en',false,'order.receipt','1','{}','https://projection.example.test',repeat('1',64),decode(repeat('1',64),'hex'),'v1',decode(repeat('2',64),'hex'),'v1',3600,transaction_timestamp()+interval '1 hour',$5,$6,$7,repeat('1',64),'TEST_PROJECTION',gen_random_uuid(),$8,gen_random_uuid(),gen_random_uuid(),$9,CASE WHEN $9='SENT' THEN transaction_timestamp() ELSE NULL END,CASE WHEN $9='SENT' THEN NULL ELSE 'TEST_FAILURE' END,transaction_timestamp(),transaction_timestamp())`,
          [
            manual,
            order,
            contact,
            base,
            actor.id,
            actor.sid,
            `projection-command:${manual}`,
            `projection:${manual}`,
            kind === "FAILED" ? "FAILED" : "SENT",
          ],
        );
      }
      if (kind === "UNKNOWN")
        await client.query(
          `INSERT INTO notification_delivery_attempts(id,notification_delivery_id,sequence,outcome,error_code,started_at,completed_at) VALUES(gen_random_uuid(),$1,1,'UNKNOWN','TEST_UNKNOWN',transaction_timestamp(),transaction_timestamp())`,
          [base],
        );
      cases.push({ kind, base, manual });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  const query = (status) =>
    run({
      action: "LIST",
      category: "NOTIFICATION",
      status,
      page: 1,
      pageSize: 50,
    });
  const open = await query("OPEN"),
    history = await query("ALL");
  const present = (result, id) =>
    result.items.some((item) => item.target.id === id);
  const source = (kind) => cases.find((value) => value.kind === kind);
  check(
    !present(open, source("SENT").base),
    "OPEN removes failed base resolved by a successful resend",
  );
  check(
    present(history, source("SENT").base),
    "ALL retains failed base resolved by a successful resend",
  );
  check(
    !present(open, source("FAILED").base) &&
      present(open, source("FAILED").manual),
    "OPEN shows latest failed resend rather than its superseded failed base",
  );
  check(
    present(open, source("UNKNOWN").base),
    "OPEN never hides UNKNOWN evidence behind later dispatch",
  );
  check(
    !present(open, source("PENDING").base),
    "normal pending notification does not enter exception work",
  );
}
