import { randomUUID } from "node:crypto";
import {
  decideFinanceEvidence,
  projectFinanceDisputeStatus,
} from "@fan-support/domain";
import { associateOrderPaymentEvidence } from "./order-payment-data.js";
import {
  draftRows,
  financeTime,
  financeHistory,
  financeIntegrity,
  type DraftRow,
} from "./admin-finance-data.js";
import {
  projectFinanceOrder,
  type FinanceCapturedEvidenceContext,
} from "./admin-finance-apply-projection.js";

export async function applyFinanceDispute({
  client,
  outbox,
  command,
  orderId,
  order,
  attempt,
  event,
  record,
  baseTarget,
  normalized,
  dispute,
}: FinanceCapturedEvidenceContext &
  Readonly<{ dispute: DraftRow | undefined }>) {
  if (
    dispute &&
    (dispute["order_id"] !== orderId ||
      dispute["payment_attempt_id"] !== attempt["id"] ||
      dispute["provider_account_id"] !== attempt["provider_account_id"] ||
      dispute["environment"] !== attempt["environment"])
  )
    return record("REVIEW", "DISPUTE_IDENTITY_MISMATCH");
  const decision = decideFinanceEvidence({
    schemaVersion: 1,
    kind: "DISPUTE",
    currentStatus: dispute?.["status"] ?? "NONE",
    target: {
      ...baseTarget,
      providerReference:
        dispute?.["provider_reference"] ?? event["provider_dispute_reference"],
      amountMinor: Number(dispute?.["amount_minor"] ?? event["amount_minor"]),
    },
    event: normalized,
  });
  if (decision.decision !== "APPLY")
    return record(
      decision.decision === "IGNORE" ? "IGNORED" : "REVIEW",
      decision.reasonCode,
    );
  await associateOrderPaymentEvidence(client, event, String(attempt["id"]));
  const at = await financeTime(client, orderId);
  let current: DraftRow | undefined;
  if (dispute) {
    [current] = await draftRows(
      client,
      `UPDATE disputes SET status=$2,status_evidence_kind=$3,provider_event_id=$4,evidence_audit_log_id=$5,version=version+1,updated_at=$6,opened_at=coalesce(opened_at,$6::timestamptz) WHERE id=$1 RETURNING *`,
      [
        dispute["id"],
        decision.targetStatus,
        event["evidence_kind"],
        event["id"],
        event["reconcile_audit_log_id"],
        at,
      ],
    );
  } else {
    [current] = await draftRows(
      client,
      `INSERT INTO disputes(id,order_id,payment_attempt_id,provider_account_id,environment,provider_reference,status,amount_minor,currency,status_evidence_kind,provider_event_id,evidence_audit_log_id,opened_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$13) RETURNING *`,
      [
        randomUUID(),
        orderId,
        attempt["id"],
        event["provider_account_id"],
        event["environment"],
        event["provider_dispute_reference"],
        decision.targetStatus,
        event["amount_minor"],
        event["currency"],
        event["evidence_kind"],
        event["id"],
        event["reconcile_audit_log_id"],
        at,
      ],
    );
  }
  if (!current) return financeIntegrity();
  await financeHistory(
    client,
    outbox,
    "DISPUTE",
    current,
    order,
    dispute ? String(dispute["status"]) : null,
    command,
    at,
  );
  const disputes = await draftRows(
    client,
    `SELECT status FROM disputes WHERE order_id=$1 AND status<>'NONE' ORDER BY id`,
    [orderId],
  );
  const projection = projectFinanceDisputeStatus({
    schemaVersion: 1,
    statuses: disputes.map((d) => d["status"]),
  });
  await projectFinanceOrder(
    client,
    order,
    event,
    "DISPUTE",
    projection.status,
    command,
  );
  return record("APPLIED", "DISPUTE_STATUS_CONFIRMED");
}
