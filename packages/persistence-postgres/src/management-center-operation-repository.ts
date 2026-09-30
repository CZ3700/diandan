import { readManagementImageSource } from "./management-image-source.js";
import {
  managementCenterCheckpointSchema,
  managementCenterIntentSchema,
  managementCenterOperationSchema,
  managementCenterResponseSchema,
  type ManagementCenterFailure,
} from "@fan-support/contracts";
import type {
  ManagementCenterFence,
  ManagementCenterOperationRepository,
} from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import {
  createResourceRun,
  writeResourceAudit,
} from "./resource-management-data.js";
import {
  authorizeManagementSession,
  currentManagementDelegation,
  managementFailure,
  managementOperationResponse,
  managementOperationSql,
  mapManagementClaim,
} from "./management-center-operation-data.js";
import {
  readManagementCenterContext,
  readManagementCenterList,
} from "./management-center-operation-read.js";
import { assignArtist } from "./management-center-assignment.js";
import {
  currentArtistBroker,
  managementGrants,
} from "./management-center-scope.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

// Event metadata preserves prior ordering; authorization and leases still use the live database clock.
export function createManagementCenterOperationRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  publicMediaBaseUrl: string,
): ManagementCenterOperationRepository {
  const run = createResourceRun(client, scope);
  const response = async (id: string) => {
    const [row] = await draftRows(
      client,
      `${managementOperationSql} WHERE o.id=$1`,
      [id],
    );
    return row
      ? managementOperationResponse(row)
      : managementFailure("NOT_FOUND");
  };
  async function fenced(input: ManagementCenterFence) {
    if (!/^[a-f0-9]{64}$/u.test(input.leaseTokenDigest)) return undefined;
    const [row] = await draftRows(
      client,
      `${managementOperationSql} WHERE o.id=$1 AND o.status='RUNNING' AND o.lease_token_digest=$2 AND o.lease_expires_at>clock_timestamp() FOR UPDATE OF o`,
      [input.operationId, Buffer.from(input.leaseTokenDigest, "hex")],
    );
    return row && (await currentManagementDelegation(client, row))
      ? row
      : undefined;
  }
  async function end(
    input: ManagementCenterFence,
    status: "QUEUED" | "FAILED",
    failure?: { code: ManagementCenterFailure["code"]; retryable: boolean },
  ) {
    if (!(await fenced(input))) return managementFailure("NEEDS_AUTHORIZATION");
    await client.query(
      `UPDATE public.management_operations SET status=$2,version=version+1,lease_token_digest=NULL,lease_expires_at=NULL,failure_code=$3,failure_retryable=$4,next_attempt_at=CASE WHEN $2='QUEUED' THEN clock_timestamp()+interval '2 seconds' ELSE NULL END,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=$1`,
      [
        input.operationId,
        status,
        failure?.code ?? null,
        failure?.retryable ?? null,
      ],
    );
    return response(input.operationId);
  }
  /** ADR-022: true when the account manages every artist; a broker only those assigned to it. */
  const managesAll = async (actorId: string) =>
    (await managementGrants(client, actorId)).direct;
  const ownsArtist = async (actorId: string, artistId: string) =>
    (await currentArtistBroker(client, artistId))?.toLowerCase() ===
    actorId.toLowerCase();
  return {
    authorize: (input) => run(() => authorizeManagementSession(client, input)),
    readImageSource: (input) =>
      run(async () =>
        (await managesAll(input.principal.actorId)) ||
        (input.target.kind === "ARTIST" &&
          (await ownsArtist(input.principal.actorId, input.target.id)))
          ? readManagementImageSource(client, input.target)
          : managementFailure("FORBIDDEN"),
      ),
    context: (principal) =>
      run(async () =>
        readManagementCenterContext(
          client,
          principal,
          await managementGrants(client, principal.actorId),
        ),
      ),
    list: (input) =>
      run(async () => {
        if (await managesAll(input.principal.actorId))
          return readManagementCenterList(
            client,
            input.command,
            publicMediaBaseUrl,
            { scope: "ALL" },
          );
        // A broker has no gifts or posters, and its list is already its own assignment.
        if (input.command.section !== "ARTISTS" || input.command.assignment)
          return managementFailure("FORBIDDEN");
        return readManagementCenterList(
          client,
          input.command,
          publicMediaBaseUrl,
          { scope: "ASSIGNED", brokerId: input.principal.actorId },
        );
      }),
    assignArtist: (input) => run(() => assignArtist(client, input)),
    submit: (input) =>
      run(async () => {
        const intent = managementCenterIntentSchema.parse(input.intent);
        if (
          !(await managesAll(input.principal.actorId)) &&
          (intent.kind !== "SAVE_ARTIST" ||
            (intent.id !== null &&
              !(await ownsArtist(input.principal.actorId, intent.id))))
        )
          return managementFailure("FORBIDDEN");
        const [existing] = await draftRows(
          client,
          `${managementOperationSql} WHERE o.actor_id=$1 AND o.idempotency_key=$2 FOR UPDATE OF o`,
          [input.principal.actorId, input.idempotencyKey],
        );
        if (existing)
          return Buffer.isBuffer(existing["intent_hash"]) &&
            existing["intent_hash"].toString("hex") === input.intentHash
            ? managementOperationResponse(existing)
            : managementFailure("IDEMPOTENCY_CONFLICT");
        if (!/^[a-f0-9]{64}$/u.test(input.intentHash))
          return managementFailure("INVALID_COMMAND");
        if (
          intent.kind === "SAVE_GIFT" &&
          intent.inventory.policy === "TRACKED" &&
          !(
            "commerceEdit" in intent &&
            intent.commerceEdit.inventory.mode === "PRESERVE"
          )
        ) {
          const [location] = await draftRows(
            client,
            "SELECT id FROM public.inventory_locations WHERE id=$1 AND status='ACTIVE' FOR SHARE",
            [intent.inventory.locationId],
          );
          if (!location) return managementFailure("NOT_FOUND");
        }
        if (
          "image" in intent &&
          intent.image !== null &&
          "uploadId" in intent.image
        ) {
          const [upload] = await draftRows(
            client,
            `SELECT id FROM public.media_upload_reservations WHERE id=$1 AND actor_id=$2 AND session_id=$3 AND (status='REGISTERED' OR expires_at>clock_timestamp()) FOR SHARE`,
            [
              intent.image.uploadId,
              input.principal.actorId,
              input.principal.sessionId,
            ],
          );
          if (!upload) return managementFailure("UPLOAD_NOT_READY");
        }
        let targetId: unknown = "id" in intent ? intent.id : null;
        if (intent.kind === "SAVE_ARTIST" || intent.kind === "SAVE_GIFT") {
          if (intent.id !== null) {
            const table = intent.kind === "SAVE_ARTIST" ? "idols" : "gifts";
            const [target] = await draftRows(
              client,
              `SELECT id,version,status FROM public.${table} WHERE id=$1 FOR SHARE`,
              [intent.id],
            );
            if (
              !target ||
              Number(target["version"]) !== intent.expectedVersion ||
              target["status"] === "archived"
            )
              return managementFailure("TARGET_CONFLICT");
            if (
              intent.kind === "SAVE_GIFT" &&
              !(
                "commerceEdit" in intent &&
                intent.commerceEdit.inventory.mode === "PRESERVE"
              )
            ) {
              const variants = await draftRows(
                client,
                `SELECT v.inventory_policy,i.id inventory_item_id FROM public.gift_variants v LEFT JOIN public.inventory_items i ON i.gift_variant_id=v.id WHERE v.gift_id=$1 FOR SHARE OF v`,
                [intent.id],
              );
              if (
                variants.some(
                  (variant) =>
                    variant["inventory_item_id"] !== null &&
                    variant["inventory_item_id"] !== undefined &&
                    variant["inventory_policy"] !== intent.inventory.policy,
                )
              )
                return managementFailure("INVENTORY_POLICY_LOCKED");
            }
          }
        } else {
          const [head] = await draftRows(
            client,
            `SELECT h.homepage_revision_id,h.version FROM public.homepage_publication_heads h FOR SHARE`,
          );
          if (!head) return managementFailure("HERO_NOT_CONFIGURED");
          if (Number(head["version"]) !== intent.expectedVersion)
            return managementFailure("TARGET_CONFLICT");
          targetId = head["homepage_revision_id"];
          if (intent.kind === "RESTORE_POSTER") {
            // An archived (deleted) poster cannot come back through restore.
            const [source] = await draftRows(
              client,
              "SELECT 1 FROM public.homepage_revisions WHERE id=$1 AND lifecycle IN ('PUBLISHED','SUPERSEDED') FOR SHARE",
              [intent.sourceRevisionId],
            );
            if (!source) return managementFailure("TARGET_CONFLICT");
          }
        }
        if (
          "image" in intent &&
          intent.image &&
          "currentImage" in intent.image
        ) {
          const original = await readManagementImageSource(client, {
            kind:
              intent.kind === "SAVE_ARTIST"
                ? "ARTIST"
                : intent.kind === "SAVE_GIFT"
                  ? "GIFT"
                  : "POSTER",
            id: String(targetId),
            expectedVersion: intent.expectedVersion,
          });
          if (original.outcome === "FAILURE") return original;
          if (
            original.currentImage.assetId !==
              intent.image.currentImage.assetId ||
            original.currentImage.metadataRevisionId !==
              intent.image.currentImage.metadataRevisionId
          )
            return managementFailure("TARGET_CONFLICT");
        }
        await client.query(
          `INSERT INTO public.management_operations(id,actor_id,session_id,request_id,capability,intent,intent_hash,idempotency_key,status,phase,version,target_id,checkpoint,authorized_until,attempt_count,next_attempt_at,created_at,updated_at)
        VALUES(gen_random_uuid(),$1,$2,$3,'DIRECT_OPERATOR_V1',$4,$5,$6,'QUEUED','PREPARE_MEDIA',1,coalesce($7::uuid,gen_random_uuid()),$8,$9,0,clock_timestamp(),clock_timestamp(),clock_timestamp()) ON CONFLICT(actor_id,idempotency_key) DO NOTHING`,
          [
            input.principal.actorId,
            input.principal.sessionId,
            input.requestId,
            intent,
            Buffer.from(input.intentHash, "hex"),
            input.idempotencyKey,
            targetId,
            {
              retryRequested: false,
              sourceAssetId: null,
              jobs: [],
              preparedMedia: null,
            },
            input.principal.expiresAt,
          ],
        );
        const [stored] = await draftRows(
          client,
          `${managementOperationSql} WHERE o.actor_id=$1 AND o.idempotency_key=$2 FOR UPDATE OF o`,
          [input.principal.actorId, input.idempotencyKey],
        );
        if (!stored) throw new Error("Missing durable management receipt");
        return Buffer.isBuffer(stored["intent_hash"]) &&
          stored["intent_hash"].toString("hex") === input.intentHash
          ? managementOperationResponse(stored)
          : managementFailure("IDEMPOTENCY_CONFLICT");
      }),
    archivePoster: (input) =>
      run(async () => {
        if (!(await managesAll(input.principal.actorId)))
          return managementFailure("FORBIDDEN");
        // Same lock as poster publication, so a replace/restore never races an archive.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('fan-support:homepage',0))",
        );
        const [head] = await draftRows(
          client,
          "SELECT homepage_revision_id,version FROM public.homepage_publication_heads FOR SHARE",
        );
        if (!head) return managementFailure("HERO_NOT_CONFIGURED");
        if (
          Number(head["version"]) !== input.expectedVersion ||
          String(head["homepage_revision_id"]).toLowerCase() ===
            input.revisionId.toLowerCase()
        )
          return managementFailure("TARGET_CONFLICT");
        const [revision] = await draftRows(
          client,
          "SELECT lifecycle FROM public.homepage_revisions WHERE id=$1 FOR UPDATE",
          [input.revisionId],
        );
        if (!revision) return managementFailure("NOT_FOUND");
        const archived = managementCenterResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "POSTER_ARCHIVED",
          revisionId: input.revisionId,
        });
        if (revision["lifecycle"] === "ARCHIVED") return archived;
        if (revision["lifecycle"] !== "SUPERSEDED")
          return managementFailure("TARGET_CONFLICT");
        const [pending] = await draftRows(
          client,
          `SELECT 1 FROM public.management_operations WHERE status IN ('QUEUED','RUNNING')
          AND intent->>'kind'='RESTORE_POSTER' AND lower(intent->>'sourceRevisionId')=lower($1) LIMIT 1`,
          [input.revisionId],
        );
        if (pending) return managementFailure("TARGET_CONFLICT");
        const [instant] = await draftRows(
          client,
          `SELECT gen_random_uuid() AS audit_id,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`,
        );
        await client.query(
          "UPDATE public.homepage_revisions SET lifecycle='ARCHIVED',archived_at=GREATEST($2::timestamptz,superseded_at) WHERE id=$1 AND lifecycle='SUPERSEDED'",
          [input.revisionId, instant?.["now"]],
        );
        await writeResourceAudit(client, {
          auditId: String(instant?.["audit_id"]),
          actorId: input.principal.actorId,
          action: "HOMEPAGE_POSTER_ARCHIVE",
          subjectType: "HOMEPAGE_REVISION",
          subjectId: input.revisionId,
          reasonCode: "DAILY_CENTER_DELETE",
          requestId: input.requestId,
          at: String(instant?.["now"]),
        });
        return archived;
      }),
    read: (input) =>
      run(async () => {
        const [row] = await draftRows(
          client,
          `${managementOperationSql} WHERE o.id=$1 AND o.actor_id=$2`,
          [input.operationId, input.actorId],
        );
        return row
          ? managementOperationResponse(row)
          : managementFailure("NOT_FOUND");
      }),
    retry: (input) =>
      run(async () => {
        const [row] = await draftRows(
          client,
          `${managementOperationSql} WHERE o.id=$1 AND o.actor_id=$2 FOR UPDATE OF o`,
          [input.operationId, input.principal.actorId],
        );
        if (!row) return managementFailure("NOT_FOUND");
        if (row["retry_key"] === input.idempotencyKey)
          return managementOperationResponse(row);
        if (
          Number(row["version"]) !== input.expectedVersion ||
          row["status"] !== "FAILED" ||
          row["failure_retryable"] !== true
        )
          return managementFailure("STALE_VERSION");
        if (
          !(await currentManagementDelegation(client, {
            ...row,
            session_id: input.principal.sessionId,
            authorized_until: input.principal.expiresAt,
          }))
        )
          return managementFailure("NEEDS_AUTHORIZATION");
        await client.query(
          `UPDATE public.management_operations SET session_id=$2,request_id=$3,authorized_until=$4,retry_key=$5,checkpoint=jsonb_set(checkpoint,'{retryRequested}','true'::jsonb),status='QUEUED',version=version+1,failure_code=NULL,failure_retryable=NULL,next_attempt_at=clock_timestamp(),updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=$1`,
          [
            input.operationId,
            input.principal.sessionId,
            input.requestId,
            input.principal.expiresAt,
            input.idempotencyKey,
          ],
        );
        return response(input.operationId);
      }),
    async claim(input) {
      const wrapped = await run(async () => {
        if (
          !/^[a-f0-9]{64}$/u.test(input.leaseTokenDigest) ||
          !Number.isInteger(input.leaseSeconds) ||
          input.leaseSeconds < 10 ||
          input.leaseSeconds > 900
        )
          return {
            outcome: "SUCCESS" as const,
            value: managementFailure("INVALID_COMMAND"),
          };
        const [row] = await draftRows(
          client,
          `${managementOperationSql} WHERE (o.status='QUEUED' AND o.next_attempt_at<=clock_timestamp()) OR (o.status='RUNNING' AND o.lease_expires_at<=clock_timestamp()) ORDER BY o.created_at,o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED`,
        );
        if (!row) return { outcome: "SUCCESS" as const, value: null };
        if (!(await currentManagementDelegation(client, row))) {
          await client.query(
            `UPDATE public.management_operations SET status='FAILED',version=version+1,failure_code='NEEDS_AUTHORIZATION',failure_retryable=true,lease_token_digest=NULL,lease_expires_at=NULL,next_attempt_at=NULL,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=$1`,
            [row["id"]],
          );
          return {
            outcome: "SUCCESS" as const,
            value: managementFailure("NEEDS_AUTHORIZATION"),
          };
        }
        await client.query(
          `UPDATE public.management_operations SET status='RUNNING',version=version+1,attempt_count=attempt_count+1,lease_token_digest=$2,lease_expires_at=LEAST(clock_timestamp()+$3*interval '1 second',authorized_until),next_attempt_at=NULL,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=$1`,
          [
            row["id"],
            Buffer.from(input.leaseTokenDigest, "hex"),
            input.leaseSeconds,
          ],
        );
        const [claimed] = await draftRows(
          client,
          `${managementOperationSql} WHERE o.id=$1`,
          [row["id"]],
        );
        if (!claimed) throw new Error("Claim receipt missing");
        return {
          outcome: "SUCCESS" as const,
          value: mapManagementClaim(claimed),
        };
      });
      return wrapped.value;
    },
    async loadClaim(input) {
      const wrapped = await run(async () => {
        const row = await fenced(input);
        return {
          outcome: "SUCCESS" as const,
          value: row
            ? mapManagementClaim(row)
            : managementFailure("NEEDS_AUTHORIZATION"),
        };
      });
      return wrapped.value;
    },
    async checkpoint(input) {
      const wrapped = await run(async () => {
        const row = await fenced(input);
        if (!row)
          return {
            outcome: "SUCCESS" as const,
            value: managementFailure("NEEDS_AUTHORIZATION"),
          };
        const checkpoint = managementCenterCheckpointSchema.parse(
          input.checkpoint,
        );
        await client.query(
          `UPDATE public.management_operations SET checkpoint=$2,phase=CASE WHEN $3 THEN 'PUBLISH' ELSE 'PREPARE_MEDIA' END,version=version+1,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=$1`,
          [input.operationId, checkpoint, checkpoint.preparedMedia !== null],
        );
        const [updated] = await draftRows(
          client,
          `${managementOperationSql} WHERE o.id=$1`,
          [input.operationId],
        );
        if (!updated) throw new Error("Checkpoint missing");
        return {
          outcome: "SUCCESS" as const,
          value: mapManagementClaim(updated),
        };
      });
      return wrapped.value;
    },
    defer: (input) => run(() => end(input, "QUEUED")),
    fail: (input) => run(() => end(input, "FAILED", input)),
    complete: (input) =>
      run(async () => {
        const row = await fenced(input);
        if (!row) return managementFailure("NEEDS_AUTHORIZATION");
        const result = managementCenterOperationSchema.shape.result
          .unwrap()
          .parse(input.result);
        await client.query(
          `UPDATE public.management_operations SET status='SUCCEEDED',phase='PUBLISH',target_id=$2,result=$3,version=version+1,failure_code=NULL,failure_retryable=NULL,lease_token_digest=NULL,lease_expires_at=NULL,next_attempt_at=NULL,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE id=$1`,
          [input.operationId, result.targetId, result],
        );
        return managementCenterResponseSchema.parse(
          await response(input.operationId),
        );
      }),
  };
}
