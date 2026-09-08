import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { runMigrations, withEphemeralPostgres } from "../dist/index.js";
import { createManagementCenterOperationRepository } from "../dist/management-center-operation-repository.js";

// Run with node after the standard PostgreSQL package build.
// A deliberately later prior event models a wall-clock correction; it is not
// evidence that the natural browser failure recorded such a correction.
let assertions = 0;
let stage = "MIGRATION";
const equal = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  assertions++;
};
await withEphemeralPostgres(async (configuration) => {
  await runMigrations({
    clientConfig: configuration,
    workspaceRoot: fileURLToPath(new URL("../../../", import.meta.url)),
    command: { direction: "up" },
  });
  const client = new Client(configuration);
  await client.connect();
  const actor = randomUUID(),
    session = randomUUID(),
    role = randomUUID(),
    permission = randomUUID();
  const token = randomBytes(32);
  try {
    stage = "AUTHORIZE_FIXTURE";
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO public.admin_identities(id,issuer,external_subject_hash,status,created_at) VALUES($1,'operation-clock-fixture',$2,'ACTIVE',transaction_timestamp()-interval '10 minutes')",
      [actor, token],
    );
    await client.query(
      "INSERT INTO public.roles(id,role_key,description,created_at) VALUES($1,$2,'Synthetic operation clock verification',transaction_timestamp()-interval '10 minutes')",
      [role, `operation-clock:${role}`],
    );
    await client.query(
      "INSERT INTO public.permissions(id,permission_key,description,created_at) VALUES($1,'management.direct','Synthetic operation clock verification',transaction_timestamp()-interval '10 minutes')",
      [permission],
    );
    await client.query(
      "INSERT INTO public.admin_identity_roles(admin_identity_id,role_id,granted_by,granted_at) VALUES($1,$2,$1,transaction_timestamp()-interval '10 minutes')",
      [actor, role],
    );
    await client.query(
      "INSERT INTO public.role_permissions(role_id,permission_id,granted_by,granted_at) VALUES($1,$2,$3,transaction_timestamp()-interval '10 minutes')",
      [role, permission, actor],
    );
    const audit = randomUUID(),
      request = randomUUID();
    await client.query(
      "INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at) VALUES($1,'ADMIN',$2,'CONTENT_LOCALE_GRANT','ADMIN_CONTENT_LOCALE_GRANT',$2,'OPERATION_CLOCK_FIXTURE',$3,$3,'SUCCEEDED','CONTENT_TRANSLATION',transaction_timestamp()-interval '10 minutes')",
      [audit, actor, request],
    );
    await client.query(
      "INSERT INTO public.admin_content_locale_grants(admin_identity_id,locale,granted_by,audit_log_id,granted_at) VALUES($1,'en',$1,$2,transaction_timestamp()-interval '10 minutes')",
      [actor, audit],
    );
    await client.query(
      "INSERT INTO public.admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,expires_at) VALUES($1,$2,$3,$4,true,transaction_timestamp()-interval '10 minutes',transaction_timestamp()+interval '2 hours')",
      [session, actor, token, randomBytes(32)],
    );
    await client.query("COMMIT");
    const checkpoint = {
      sourceAssetId: null,
      jobs: [],
      preparedMedia: null,
      retryRequested: false,
    };
    const lease = "a".repeat(64);
    async function createRunning() {
      const operationId = randomUUID();
      const intent = {
        kind: "SAVE_ARTIST",
        sourceLocale: "en",
        id: null,
        expectedVersion: 0,
        name: "Clock fixture",
        description: "Clock fixture",
        image: { uploadId: randomUUID() },
      };
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO public.management_operations(id,actor_id,session_id,request_id,capability,intent,intent_hash,idempotency_key,status,phase,version,target_id,checkpoint,authorized_until,attempt_count,next_attempt_at,created_at,updated_at)
        VALUES($1,$2,$3,$1,'DIRECT_OPERATOR_V1',$4,sha256(convert_to(public.canonical_publication_json($4::jsonb),'UTF8')),$6,'QUEUED','PREPARE_MEDIA',1,$1,$5,clock_timestamp()+interval '1 hour',0,clock_timestamp(),clock_timestamp(),clock_timestamp())`,
        [operationId, actor, session, intent, checkpoint, operationId],
      );
      await client.query(
        "UPDATE public.management_operations SET status='RUNNING',version=version+1,attempt_count=1,lease_token_digest=$2,lease_expires_at=clock_timestamp()+interval '300 seconds',next_attempt_at=NULL,updated_at=clock_timestamp()+interval '2 minutes' WHERE id=$1",
        [operationId, Buffer.from(lease, "hex")],
      );
      await client.query("COMMIT");
      return { operationId, leaseTokenDigest: lease };
    }
    const repo = () =>
      createManagementCenterOperationRepository(
        client,
        { trackOperation: (work) => work(), markRollbackOnly: () => undefined },
        "https://media.example.invalid",
      );
    const first = await createRunning();
    stage = "ORIGINAL_GUARD";
    await client.query("BEGIN");
    await assert.rejects(
      client.query(
        "UPDATE public.management_operations SET version=version+1,updated_at=clock_timestamp() WHERE id=$1",
        [first.operationId],
      ),
      (error) =>
        error.code === "23514" &&
        /guard_management_operation/u.test(error.where ?? ""),
    );
    assertions++;
    await client.query("ROLLBACK");
    for (const action of ["checkpoint", "defer", "fail"]) {
      stage = action.toUpperCase();
      const fence = action === "checkpoint" ? first : await createRunning();
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const result =
        action === "checkpoint"
          ? await repo().checkpoint({ ...fence, checkpoint })
          : action === "fail"
            ? await repo().fail({
                ...fence,
                code: "MEDIA_FAILED",
                retryable: true,
              })
            : await repo().defer(fence);
      assert.ok(
        action === "checkpoint"
          ? !("outcome" in result)
          : result.outcome === "SUCCESS",
        `${action} succeeds despite the later prior event`,
      );
      assertions++;
      const {
        rows: [stored],
      } = await client.query(
        "SELECT version::int version,updated_at>clock_timestamp() AS kept_prior,lease_expires_at FROM public.management_operations WHERE id=$1",
        [fence.operationId],
      );
      equal(stored.version, 3, `${action} increments the version exactly once`);
      equal(
        stored.kept_prior,
        true,
        `${action} preserves the real later prior timestamp`,
      );
      await client.query("COMMIT");
    }
    const expired = await createRunning();
    stage = "REVOKED_SESSION";
    await client.query(
      "UPDATE public.admin_sessions SET revoked_at=clock_timestamp() WHERE id=$1",
      [session],
    );
    await client.query("BEGIN");
    equal(
      await repo().checkpoint({ ...expired, checkpoint }),
      { schemaVersion: 1, outcome: "FAILURE", code: "NEEDS_AUTHORIZATION" },
      "a later prior event never reauthorizes a revoked session",
    );
    const {
      rows: [unchanged],
    } = await client.query(
      "SELECT version::int version FROM public.management_operations WHERE id=$1",
      [expired.operationId],
    );
    equal(unchanged.version, 2, "revoked work remains untouched");
    await client.query("ROLLBACK");
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        result: "PASS",
        assertions,
        database: "real isolated PostgreSQL",
        guard: "unmodified 0022",
        scope:
          "controlled prior-event ordering, not natural wall-clock observation",
      }) + "\n",
    );
  } catch (error) {
    const functionName =
      typeof error.where === "string"
        ? /PL\/pgSQL function ([a-z_][a-z_0-9]*)\(/u.exec(error.where)?.[1]
        : undefined;
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        result: "FAIL",
        stage,
        code: typeof error.code === "string" ? error.code : "PROBE_FAILURE",
        functionName,
        assertion:
          error instanceof assert.AssertionError ? error.message : undefined,
      }) + "\n",
    );
    throw error;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
});
