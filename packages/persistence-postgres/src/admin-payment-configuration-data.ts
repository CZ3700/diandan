import { createHash, randomUUID } from "node:crypto";
import { canonicalPublicationValue } from "@fan-support/content";
import {
  adminPaymentConfigurationResponseSchema,
  sourceHashSchema,
  type AdminPaymentConfigurationFailure,
  type AdminPaymentConfigurationStoreRequest,
} from "@fan-support/contracts";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { healthTimestamp } from "./payment-health-data.js";
import type { TransactionClient } from "./transaction-runner.js";
export { draftRows, healthTimestamp, type DraftRow, type TransactionClient };
export const serializeConfiguration = canonicalPublicationValue;
export const configurationHash = (value: unknown) =>
  sourceHashSchema.parse(
    createHash("sha256").update(canonicalPublicationValue(value)).digest("hex"),
  );
export const configurationFailure = (
  code: AdminPaymentConfigurationFailure["code"],
): AdminPaymentConfigurationFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});
export const configurationResponse =
  adminPaymentConfigurationResponseSchema.parse;
export const translationHash = (value: {
  displayName: string;
  customerHint: string;
}) =>
  configurationHash({
    displayName: value.displayName,
    customerHint: value.customerHint,
  });
/** A missing source has explicit unbound lineage; it can never pass approval or publication. */
export const UNBOUND_PAYMENT_TRANSLATION = configurationHash({
  schemaVersion: 1,
  kind: "PAYMENT_TRANSLATION_SOURCE_MISSING",
});
export async function configurationHead(
  client: TransactionClient,
  write = false,
) {
  if (write)
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('admin-payment-configuration-publication',0))",
    );
  const [head] = await draftRows(
    client,
    `SELECT *,${healthTimestamp("updated_at")} updated_text FROM public.payment_config_publication_heads WHERE singleton_key ${write ? "FOR UPDATE" : "FOR SHARE"}`,
  );
  return head;
}
export async function configurationTime(client: TransactionClient) {
  const [r] = await draftRows(
    client,
    `SELECT ${healthTimestamp("clock_timestamp()")} now`,
  );
  return String(r!["now"]);
}
export async function configurationAudit(
  client: TransactionClient,
  request: AdminPaymentConfigurationStoreRequest,
  actor: string,
  action: string,
  subject: string,
  at: string,
  reason: string | null = null,
) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,created_at) VALUES($1,'ADMIN',$2,$3,$4,$5,$6,$7,$8,'SUCCEEDED',$9)`,
    [
      id,
      actor,
      action,
      action === "PAYMENT_CONFIG_PUBLISH" ||
      action === "PAYMENT_CONFIG_ROLLBACK"
        ? "PAYMENT_CONFIG_PUBLICATION"
        : "PAYMENT_CONFIGURATION",
      subject,
      reason,
      request.access.requestId,
      request.access.correlationId,
      at,
    ],
  );
  return id;
}
