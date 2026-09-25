import { createHash } from "node:crypto";
import {
  giftCommerceMutationSchema,
  giftCommerceTimestampSchema,
  type GiftCommerceFailure,
  type GiftCommerceWriteCommand,
} from "@fan-support/contracts";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { utcTimestampSql } from "./resource-management-data.js";
import type { TransactionClient } from "./transaction-runner.js";
export const giftCommerceFailure = (
  code: GiftCommerceFailure["code"],
): GiftCommerceFailure => ({ schemaVersion: 1, outcome: "FAILURE", code });
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function giftCommandHash(
  command: GiftCommerceWriteCommand["command"],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical({ purpose: "gift-commerce-command-v1", command }),
      ),
      "utf8",
    )
    .digest("hex");
}
export async function insertGiftRow(
  client: TransactionClient,
  table: string,
  values: Readonly<Record<string, unknown>>,
) {
  const entries = Object.entries(values);
  await client.query(
    `INSERT INTO public.${table}(${entries.map(([key]) => key).join(",")}) VALUES(${entries.map((_, i) => `$${i + 1}`).join(",")})`,
    entries.map(([, value]) => value ?? null),
  );
}
export async function giftCommerceTime(
  client: TransactionClient,
  input: GiftCommerceWriteCommand,
  previous: readonly string[] = [],
) {
  const [row] = await draftRows(
    client,
    `SELECT gen_random_uuid() AS id,gen_random_uuid() AS subject_id,gen_random_uuid() AS audit_id,${utcTimestampSql("GREATEST(transaction_timestamp(),$1::timestamptz,(SELECT max(value) FROM unnest($2::timestamptz[]) value))")} AS at`,
    [input.principal.authorizedAt, previous],
  );
  if (!row) throw new Error("Missing canonical commerce time");
  return {
    id: String(row["id"]),
    subjectId: String(row["subject_id"]),
    auditId: String(row["audit_id"]),
    at: giftCommerceTimestampSchema.parse(row["at"]),
  };
}
export async function writeGiftAudit(
  client: TransactionClient,
  input: GiftCommerceWriteCommand,
  time: { auditId: string; at: string },
  subjectType: string,
  subjectId: string,
) {
  await insertGiftRow(client, "audit_logs", {
    id: time.auditId,
    actor_type: "ADMIN",
    actor_id: input.principal.actorId,
    action: input.command.action,
    subject_type: subjectType,
    subject_id: subjectId,
    reason_code: input.command.reasonCode,
    request_id: input.requestId,
    correlation_id: input.requestId,
    outcome: "SUCCEEDED",
    field_category: "GIFT_COMMERCE",
    created_at: time.at,
  });
}
export function giftReceiptFields(
  input: GiftCommerceWriteCommand,
  time: { id: string; auditId: string; at: string },
) {
  return {
    id: time.id,
    actor_id: input.principal.actorId,
    session_id: input.principal.sessionId,
    audit_log_id: time.auditId,
    request_id: input.requestId,
    reason_code: input.command.reasonCode,
    command_hash: giftCommandHash(input.command),
    created_at: time.at,
  };
}
export async function readGiftCommerceReceipt(
  client: TransactionClient,
  resultId: string,
  actorId: string,
) {
  for (const table of [
    "gift_identity_receipts",
    "gift_variant_receipts",
    "gift_content_profile_receipts",
  ]) {
    const [row] = await draftRows(
      client,
      `SELECT * FROM public.${table} WHERE id=$1 AND actor_id=$2`,
      [resultId, actorId],
    );
    if (!row) continue;
    let fields: DraftRow;
    if (table === "gift_identity_receipts")
      fields = {
        action: row["action"],
        giftId: row["gift_id"],
        baseVersion: Number(row["result_base_version"]),
      };
    else if (table === "gift_variant_receipts")
      fields = {
        action: "SAVE_VARIANT",
        giftId: row["gift_id"],
        giftVariantId: row["gift_variant_id"],
        variantVersion: Number(row["result_variant_version"]),
      };
    else
      fields = {
        action: "SAVE_GIFT_CONTENT",
        giftId: row["gift_id"],
        giftRevisionId: row["gift_revision_id"],
        authoringVersion: Number(row["result_authoring_version"]),
        profileHash: row["profile_hash"],
      };
    return giftCommerceMutationSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      resultId: row["id"],
      replayed: false,
      ...fields,
    });
  }
  return giftCommerceFailure("NOT_FOUND");
}
