import {
  dailyPublicationDocumentSchema,
  type DailyPublicationDocument,
  type ManagementCenterClaim,
} from "@fan-support/contracts";
import {
  computeDailyDocumentHash,
  serializeDailyDocument,
  serializeDailyPublicationManifest,
} from "@fan-support/content";
import { draftRows } from "./content-draft-data.js";
import {
  currentManagementDelegation,
  managementOperationSql,
  mapManagementClaim,
} from "./management-center-operation-data.js";
import type { ManagementCenterFence } from "@fan-support/persistence-port";
import type { TransactionClient } from "./transaction-runner.js";

export async function loadDailyClaim(
  client: TransactionClient,
  input: ManagementCenterFence,
): Promise<ManagementCenterClaim | undefined> {
  if (!/^[a-f0-9]{64}$/u.test(input.leaseTokenDigest)) return undefined;
  const [row] = await draftRows(
    client,
    `${managementOperationSql} WHERE o.id=$1 AND o.status='RUNNING' AND o.lease_token_digest=$2 AND o.lease_expires_at>clock_timestamp() FOR UPDATE OF o`,
    [input.operationId, Buffer.from(input.leaseTokenDigest, "hex")],
  );
  return row && (await currentManagementDelegation(client, row))
    ? mapManagementClaim(row)
    : undefined;
}
/** The daily document is PostgreSQL's canonical original; legacy translation/review tables are untouched. */
export async function insertDailyDocument(
  client: TransactionClient,
  claim: ManagementCenterClaim,
  input: DailyPublicationDocument,
  processingJobId: string | null = null,
  copiedFromMetadataId: string | null = null,
): Promise<void> {
  const document = dailyPublicationDocumentSchema.parse(input);
  const column = `${document.kind.toLowerCase()}_revision_id`;
  await client.query(
    `INSERT INTO public.daily_publication_revisions(revision_id,object_kind,object_id,source_locale,source_translation_id,document,document_hash,operation_id,actor_id,created_at,${column},processing_job_id,copied_from_metadata_revision_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$1,$11,$12)`,
    [
      document.revisionId,
      document.kind,
      document.ownerId,
      document.source.locale,
      document.source.id,
      JSON.parse(serializeDailyDocument(document)),
      computeDailyDocumentHash(document),
      claim.operation.operationId,
      claim.actorId,
      document.createdAt,
      processingJobId,
      copiedFromMetadataId,
    ],
  );
}
// Keep the exact canonical serializer dependency visible at the only proof write boundary.
export const dailyManifestText = serializeDailyPublicationManifest;
