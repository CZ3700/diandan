import {
  translationExportReceiptSchema,
  translationExportReceiptResponseSchema,
  translationExportReadCommandSchema as readCommand,
  translationExportCreateCommandSchema as createCommand,
  translationImportRecordCommandSchema as importCommand,
  adminMutationResponseSchema,
  contentAuthoringTargetSchema,
  contentTimestampSchema,
  type TranslationExportReceipt,
} from "@fan-support/contracts";
import {
  assertTranslationSnapshot,
  computeBaseContentTextHash,
} from "@fan-support/content";
import type { TranslationTransferRepository } from "@fan-support/persistence-port";
import { createContentAuthoringRepository } from "./content-authoring-repository.js";
import { AUTHORING_TABLES } from "./content-authoring-model.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { baseContentFailure, baseContentRun } from "./base-content-data.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";
async function receiptValue(
  client: TransactionClient,
  row: DraftRow,
): Promise<TranslationExportReceipt> {
  const pair = Object.entries(AUTHORING_TABLES).find(
    ([, table]) =>
      row[table.parent] !== null && row[table.parent] !== undefined,
  );
  if (!pair) throw new Error("invalid translation receipt owner");
  const [kind, table] = pair,
    revisionId = String(row[table.parent]);
  const [parent] = await draftRows(
    client,
    `SELECT to_jsonb(r.*) AS value FROM public.${table.revisions} r WHERE id=$1`,
    [revisionId],
  );
  const value = parent?.["value"] as DraftRow | undefined;
  if (!value) throw new Error("missing translation receipt parent");
  const owner = contentAuthoringTargetSchema.parse({
    kind,
    ...(kind === "IDOL"
      ? { idolId: value["idol_id"] }
      : kind === "GIFT"
        ? { giftId: value["gift_id"] }
        : kind === "POLICY"
          ? { policyKey: value["policy_key"] }
          : kind === "MEDIA_METADATA"
            ? { mediaAssetId: value["media_asset_id"] }
            : {}),
  });
  return translationExportReceiptSchema.parse({
    schemaVersion: 1,
    id: row["id"],
    target: { owner, revisionId },
    authoringHeadVersion: Number(row["expected_authoring_version"]),
    sourceSnapshotHash: row["source_snapshot_hash"],
    englishSourceHash: row["english_source_hash"],
    locales: row["locales"],
    actorId: row["actor_id"],
    sessionId: row["session_id"],
    createdAt: row["created_at_text"],
  });
}
export function createTranslationTransferRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): TranslationTransferRepository {
  return {
    readExport: (input) =>
      baseContentRun(scope, async () => {
        const parsed = readCommand.safeParse(input);
        if (!parsed.success) return baseContentFailure("INVALID_COMMAND");
        const [row] = await draftRows(
          client,
          `SELECT r.*,to_jsonb(r.locales) AS locales,to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_text FROM public.translation_export_receipts r WHERE r.id=$1 FOR SHARE`,
          [parsed.data.id],
        );
        return row
          ? translationExportReceiptResponseSchema.parse({
              schemaVersion: 1,
              outcome: "SUCCESS",
              receipt: await receiptValue(client, row),
            })
          : baseContentFailure("NOT_FOUND");
      }),
    createExport: (input) =>
      baseContentRun(scope, async () => {
        const parsed = createCommand.safeParse(input);
        if (!parsed.success) return baseContentFailure("INVALID_COMMAND");
        const command = parsed.data,
          receipt = command.receipt;
        const loaded = await createContentAuthoringRepository(
          client,
          scope,
        ).read({
          schemaVersion: 1,
          action: "READ",
          target: receipt.target.owner,
          revisionId: receipt.target.revisionId,
        });
        if (loaded.outcome !== "SUCCESS") return loaded;
        const snapshot = assertTranslationSnapshot(
          loaded.snapshot,
          receipt.target,
        );
        if (snapshot.lifecycle.status === "DRAFT") {
          const [sealed] = await draftRows(
            client,
            "SELECT public.content_authoring_revision_sealed($1,$2) AS sealed",
            [
              AUTHORING_TABLES[receipt.target.owner.kind].parent,
              snapshot.revisionId,
            ],
          );
          if (sealed?.["sealed"] !== true)
            return baseContentFailure("CONFLICT");
        }
        const english = snapshot.content.translations.find(
          (row) => row.locale === "en",
        )!;
        if (snapshot.headVersion !== receipt.authoringHeadVersion)
          return baseContentFailure("STALE_VERSION");
        if (
          snapshot.contentHash !== receipt.sourceSnapshotHash ||
          computeBaseContentTextHash({
            kind: snapshot.content.kind,
            fields: english.fields,
          } as Parameters<typeof computeBaseContentTextHash>[0]) !==
            receipt.englishSourceHash
        )
          return baseContentFailure("STALE_CONTENT");
        const [clock] = await draftRows(
          client,
          `SELECT gen_random_uuid() AS id,gen_random_uuid() AS audit_id,to_char(GREATEST(transaction_timestamp(),$1::timestamptz,s.created_at,
        (SELECT max(g.granted_at) FROM public.admin_content_locale_grants g WHERE g.admin_identity_id=s.admin_identity_id AND g.revoked_at IS NULL AND g.locale=ANY($3::public.supported_locale[])),
        (SELECT max(GREATEST(ar.granted_at,rp.granted_at)) FROM public.admin_identity_roles ar JOIN public.role_permissions rp ON rp.role_id=ar.role_id JOIN public.permissions p ON p.id=rp.permission_id WHERE ar.admin_identity_id=s.admin_identity_id AND p.permission_key='content.read')) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now FROM public.admin_sessions s WHERE id=$2 AND admin_identity_id=$4`,
          [
            snapshot.createdAt,
            receipt.sessionId,
            receipt.locales,
            receipt.actorId,
          ],
        );
        if (!clock) return baseContentFailure("FORBIDDEN");
        const id = String(clock["id"]),
          auditId = String(clock["audit_id"]),
          createdAt = contentTimestampSchema.parse(clock["now"]),
          table = AUTHORING_TABLES[receipt.target.owner.kind];
        await client.query(
          `INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at) VALUES($1,'ADMIN',$2,'TRANSLATION_EXPORT','TRANSLATION_EXPORT_PACKAGE',$3,$4,$5,$5,'SUCCEEDED','CONTENT_TRANSLATION',$6)`,
          [
            auditId,
            receipt.actorId,
            id,
            command.reasonCode,
            command.requestId,
            createdAt,
          ],
        );
        await client.query(
          `INSERT INTO public.translation_export_receipts(id,${table.parent},expected_authoring_version,source_snapshot_hash,english_source_hash,locales,actor_id,session_id,audit_log_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            id,
            snapshot.revisionId,
            receipt.authoringHeadVersion,
            receipt.sourceSnapshotHash,
            receipt.englishSourceHash,
            receipt.locales,
            receipt.actorId,
            receipt.sessionId,
            auditId,
            createdAt,
          ],
        );
        return translationExportReceiptResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          receipt: { ...receipt, id, createdAt },
        });
      }),
    recordImport: (input) =>
      baseContentRun(scope, async () => {
        const parsed = importCommand.safeParse(input);
        if (!parsed.success) return baseContentFailure("INVALID_COMMAND");
        const command = parsed.data;
        const [row] = await draftRows(
          client,
          `INSERT INTO public.translation_import_receipts(id,export_receipt_id,authoring_receipt_id,imported_locales,actor_id,session_id,audit_log_id,created_at)
        SELECT $1,e.id,a.id,e.locales,$4,$5,a.audit_log_id,a.created_at FROM public.translation_export_receipts e JOIN public.content_authoring_receipts a ON coalesce(a.idol_revision_id,a.gift_revision_id,a.homepage_revision_id,a.policy_revision_id,a.media_metadata_revision_id)=$3 JOIN public.audit_logs l ON l.id=a.audit_log_id
        WHERE e.id=$2 AND a.actor_id=$4 AND l.request_id=$6 RETURNING id`,
          [
            command.id,
            command.exportReceiptId,
            command.revisionId,
            command.actorId,
            command.sessionId,
            command.requestId,
          ],
        );
        if (!row) return baseContentFailure("INVALID_CONTENT");
        return adminMutationResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "MUTATION",
          resultId: command.revisionId,
          replayed: false,
        });
      }),
  };
}
