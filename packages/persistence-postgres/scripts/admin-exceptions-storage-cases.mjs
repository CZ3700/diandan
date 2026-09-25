import { randomUUID } from "node:crypto";

/** Runs against the authenticated HTTP fixture after its recovery protocol. */
export async function verifyAdminExceptionsStorage(context) {
  const { client, check, runtime, manager, fixture } = context;
  const [{ total, audits, delegated, unique_sources }] = (
    await client.query(`
    SELECT count(*)::int total,count(a.id)::int audits,
     count(*) FILTER(WHERE r.finance_operation_id IS NOT NULL OR r.notification_resend_id IS NOT NULL)::int delegated,
     count(DISTINCT (r.target_kind,r.target_id,r.consumer_key))::int unique_sources
    FROM admin_exception_receipts r LEFT JOIN audit_logs a ON a.id=r.audit_log_id
    AND a.actor_type='ADMIN' AND a.actor_id=r.actor_id AND a.action='EXCEPTION_'||r.action
    AND a.subject_type='EXCEPTION_SOURCE' AND a.subject_id=r.target_id
    AND a.reason_code=r.reason_code AND a.request_id=r.request_id AND a.correlation_id=r.correlation_id
    AND a.created_at=r.created_at AND a.outcome='SUCCEEDED'`)
  ).rows;
  check(
    total >= 4 && total === audits && delegated >= 2 && unique_sources >= 4,
    "actual four exception actions retain permanent exact-authority audit receipts",
  );
  const [original] = (
    await client.query(
      `SELECT r.*,n.status,n.base_notification_id
    FROM admin_exception_receipts r JOIN admin_notification_resends n ON n.id=r.notification_resend_id
    WHERE r.target_id=$1 AND n.status='SENT'`,
      [fixture.notificationTarget.id],
    )
  ).rows;
  check(
    Boolean(original),
    "actual notification recovery has one completed delegated dispatch",
  );
  const sentTarget = {
    kind: "NOTIFICATION",
    id: original.notification_resend_id,
    consumerKey: null,
  };
  const sent = await runtime.detail(manager, sentTarget);
  check(
    sent.item.status === "SUCCEEDED" && sent.item.allowedAction === null,
    "SENT operator dispatch can never become exception resend",
  );
  const source = await runtime.detail(manager, fixture.notificationTarget);
  check(
    source.item.allowedAction === null &&
      source.item.blockedReason === "NOTIFICATION_SUPERSEDED",
    "original failed delivery cannot bypass its later successful manual dispatch",
  );
  const uncertain = await runtime.detail(
    manager,
    fixture.blockedNotificationTarget,
  );
  check(
    uncertain.item.allowedAction === null &&
      uncertain.item.blockedReason === "NOTIFICATION_UNCERTAIN",
    "accepted but unknown notification stays blocked at persistence read boundary",
  );

  const notificationRejected = await rejectsWrapperForgery(
    client,
    original,
    sentTarget.id,
  );
  const [finance] = (
    await client.query(
      `SELECT r.* FROM admin_exception_receipts r JOIN payment_attempts a ON a.id=r.target_id WHERE r.target_kind='PAYMENT' AND a.id=$1 AND a.status='SUCCEEDED'`,
      [fixture.paymentTarget.id],
    )
  ).rows;
  check(
    Boolean(finance),
    "actual UNKNOWN recovery retains its delegated financial operation",
  );
  const financeRejected = await rejectsWrapperForgery(
    client,
    finance,
    finance.target_id,
  );
  check(
    notificationRejected,
    "SQL exception receipt cannot relabel SENT resend as failed source",
  );
  check(
    financeRejected,
    "SQL exception receipt cannot relabel completed payment as UNKNOWN source",
  );
  check(
    (
      await client.query(
        "SELECT count(*)::int total FROM admin_exception_receipts WHERE id=$1 AND target_id=$2",
        [original.id, fixture.notificationTarget.id],
      )
    ).rows[0].total === 1,
    "failed wrapper forgery rolls back without losing original permanent receipt",
  );
  const open = await runtime.call(manager, "list", {
    schemaVersion: 1,
    category: "NOTIFICATION",
    status: "OPEN",
    page: 1,
    pageSize: 50,
  });
  const history = await runtime.call(manager, "list", {
    schemaVersion: 1,
    category: "NOTIFICATION",
    status: "ALL",
    page: 1,
    pageSize: 50,
  });
  check(
    !open.items.some(
      (item) => item.target.id === fixture.notificationTarget.id,
    ),
    "successful delegated resend removes resolved original failure from open work",
  );
  check(
    history.items.some(
      (item) => item.target.id === fixture.notificationTarget.id,
    ),
    "resolved original notification failure remains available in history",
  );
  check(
    open.items.some(
      (item) =>
        item.target.id === fixture.blockedNotificationTarget.id &&
        item.status === "UNKNOWN",
    ),
    "unresolved UNKNOWN remains open despite later notification activity",
  );
  return {
    actualFourActionAudit: true,
    delegatedReceiptBinding: true,
    notificationSentGuard: true,
    notificationUnknownGuard: true,
    supersededSourceGuard: true,
    rollbackPreservesReceipt: true,
    completedPaymentGuard: true,
    isolatedConstraintInjection: true,
  };
}

// An isolated rollback probe reconstructs an otherwise valid retained wrapper.
// Only its immutable-delete guard is disabled temporarily to reuse the ID/key;
// authority, FK and CHECK guards stay enabled throughout the insertion.
async function rejectsWrapperForgery(client, original, targetId) {
  let observed;
  await client.query("BEGIN");
  try {
    await client.query(
      "ALTER TABLE admin_exception_receipts DISABLE TRIGGER admin_exception_receipts_immutable",
    );
    await client.query("DELETE FROM admin_exception_receipts WHERE id=$1", [
      original.id,
    ]);
    await client.query(
      "ALTER TABLE admin_exception_receipts ENABLE TRIGGER admin_exception_receipts_immutable",
    );
    const auditId = randomUUID();
    await client.query(
      `INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,created_at)
      SELECT $1,'ADMIN',actor_id,action,'EXCEPTION_SOURCE',$2,reason_code,request_id,correlation_id,'SUCCEEDED',created_at
      FROM audit_logs WHERE id=$3`,
      [auditId, targetId, original.audit_log_id],
    );
    await client.query(
      `INSERT INTO admin_exception_receipts(id,actor_id,session_id,action,target_kind,target_id,consumer_key,finance_operation_id,notification_resend_id,idempotency_key,request_hash,expected_version,confirmed,reason_code,audit_log_id,request_id,correlation_id,created_at)
      SELECT $1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10,admin_exception_source_version($5,$6,NULL,$8),true,$11,$12,$13,$14,a.created_at FROM audit_logs a WHERE a.id=$12`,
      [
        original.id,
        original.actor_id,
        original.session_id,
        original.action,
        original.target_kind,
        targetId,
        original.finance_operation_id,
        original.notification_resend_id,
        original.idempotency_key,
        original.request_hash,
        original.reason_code,
        auditId,
        original.request_id,
        original.correlation_id,
      ],
    );
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } catch (error) {
    observed = error.code;
  } finally {
    await client.query("ROLLBACK");
  }
  return observed === "23514";
}
