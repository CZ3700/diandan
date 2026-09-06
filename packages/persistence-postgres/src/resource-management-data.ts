import {
  contentTimestampSchema,
  type AdminContentFailure,
  type AdminMutationResponse,
  type AdminResourcePermission,
} from "@fan-support/contracts";
import {
  parsePersistenceTransactionFailure,
  PersistenceTransactionFailureError,
} from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

export const resourceFailure = (
  code: AdminContentFailure["code"],
): AdminContentFailure => ({ schemaVersion: 1, outcome: "FAILURE", code });
export const resourceMutation = (
  resultId: string,
  replayed = false,
): AdminMutationResponse => ({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "MUTATION",
  resultId,
  replayed,
});

function resourceTransactionFailure(error: unknown) {
  const canonical = parsePersistenceTransactionFailure(error);
  return canonical
    ? new PersistenceTransactionFailureError(canonical)
    : persistenceTransactionFailureFromPostgres(error);
}

/** Every failed operation rolls back its own writes; infrastructure failures poison the outer transaction. */
export function createResourceRun(
  client: TransactionClient,
  scope: TransactionScopeControl,
) {
  let sequence = 0;
  let tail: Promise<unknown> = Promise.resolve();
  return <Result extends { outcome: string }>(
    work: () => Promise<Result>,
  ): Promise<Result> =>
    scope.trackOperation(() => {
      const operation = tail.then(async () => {
        const savepoint = `resource_management_${++sequence}`;
        let opened = false;
        try {
          await client.query(`SAVEPOINT ${savepoint}`);
          opened = true;
          const result = await work();
          if (result.outcome === "FAILURE")
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
          opened = false;
          return result;
        } catch (error) {
          if (opened) {
            try {
              await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
              await client.query(`RELEASE SAVEPOINT ${savepoint}`);
            } catch (boundary) {
              throw resourceTransactionFailure(boundary);
            }
          }
          throw resourceTransactionFailure(error);
        }
      });
      tail = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    });
}
export type ResourceRun = ReturnType<typeof createResourceRun>;

export async function resourceEventTime(
  client: TransactionClient,
  authority: { sessionId: string; permission: AdminResourcePermission },
  lowerBounds: readonly string[] = [],
) {
  const [row] = await draftRows(
    client,
    `SELECT gen_random_uuid() AS audit_id,
    to_char(GREATEST(transaction_timestamp(),(SELECT max(value) FROM unnest($1::timestamptz[]) value),s.created_at,
      (SELECT max(GREATEST(ar.granted_at,rp.granted_at)) FROM public.admin_identity_roles ar JOIN public.role_permissions rp ON rp.role_id=ar.role_id JOIN public.permissions p ON p.id=rp.permission_id
        WHERE ar.admin_identity_id=s.admin_identity_id AND p.permission_key=$3 AND ar.granted_at<=clock_timestamp() AND rp.granted_at<=clock_timestamp()))
      AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now FROM public.admin_sessions s WHERE s.id=$2`,
    [lowerBounds, authority.sessionId, authority.permission],
  );
  return {
    auditId: String(row?.["audit_id"]),
    at: contentTimestampSchema.parse(row?.["now"]),
  };
}
export async function writeResourceAudit(
  client: TransactionClient,
  entry: {
    auditId: string;
    actorId: string;
    action: string;
    subjectType: string;
    subjectId: string;
    reasonCode: string;
    requestId: string;
    at: string;
  },
) {
  await client.query(
    `INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at)
    VALUES($1,'ADMIN',$2,$3,$4,$5,$6,$7,$7,'SUCCEEDED','RESOURCE_MANAGEMENT',$8)`,
    [
      entry.auditId,
      entry.actorId,
      entry.action,
      entry.subjectType,
      entry.subjectId,
      entry.reasonCode,
      entry.requestId,
      entry.at,
    ],
  );
}
export const utcTimestampSql = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
