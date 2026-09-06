import {
  contentTimestampSchema,
  type AdminContentFailure,
  type BaseContentTarget,
} from "@fan-support/contracts";
import {
  authoringHeadVersion,
  loadAuthoringSnapshot,
} from "./content-authoring-data.js";
import { AUTHORING_TABLES } from "./content-authoring-model.js";
import { draftRows } from "./content-draft-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

export const baseContentFailure = (
  code: AdminContentFailure["code"],
): AdminContentFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});
export function baseContentRun<Result>(
  scope: TransactionScopeControl,
  work: () => Promise<Result>,
): Promise<Result> {
  return scope.trackOperation(async () => {
    try {
      return await work();
    } catch (error) {
      throw persistenceTransactionFailureFromPostgres(error);
    }
  });
}
export async function loadBaseContentSnapshot(
  client: TransactionClient,
  target: BaseContentTarget,
) {
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  // The loader takes the parent lock first and all translation locks in locale order.
  // Do not acquire a shared parent lock first: concurrent lock upgrades can deadlock.
  return loadAuthoringSnapshot(
    client,
    target.owner,
    target.revisionId,
    await authoringHeadVersion(client, target.owner),
  );
}
export async function baseReviewTime(
  client: TransactionClient,
  target: BaseContentTarget,
  translationId: string,
) {
  const table = AUTHORING_TABLES[target.owner.kind];
  const [row] = await draftRows(
    client,
    `SELECT to_char(GREATEST(clock_timestamp(),transaction_timestamp(),p.created_at,t.edited_at,r.created_at,r.submitted_at,r.reviewed_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now,
    gen_random_uuid() AS review_id,gen_random_uuid() AS audit_id
    FROM public.${table.translations} t JOIN public.${table.revisions} p ON p.id=t.${table.parent}
    LEFT JOIN LATERAL(SELECT created_at,submitted_at,reviewed_at FROM public.${table.reviews}
      WHERE ${table.translation}=t.id ORDER BY sequence DESC LIMIT 1) r ON true WHERE t.id=$1`,
    [translationId],
  );
  if (!row) throw new Error("canonical review time unavailable");
  return {
    at: contentTimestampSchema.parse(row["now"]),
    reviewId: String(row["review_id"]),
    auditId: String(row["audit_id"]),
  };
}
