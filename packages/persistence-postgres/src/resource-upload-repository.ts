import {
  mediaUploadReadCommandSchema,
  mediaUploadReserveCommandSchema,
  mediaUploadRegisterCommandSchema,
  mediaUploadTicketResponseSchema,
  contentTimestampSchema,
  type MediaUploadReadCommand,
} from "@fan-support/contracts";
import type { ResourceManagementRepository } from "@fan-support/persistence-port";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import {
  resourceEventTime,
  resourceFailure,
  resourceMutation,
  utcTimestampSql,
  writeResourceAudit,
  type ResourceRun,
} from "./resource-management-data.js";
import type { TransactionClient } from "./transaction-runner.js";

async function loadTicket(
  client: TransactionClient,
  command: MediaUploadReadCommand,
  lock = false,
): Promise<DraftRow | undefined> {
  const [row] = await draftRows(
    client,
    `SELECT *,expires_at>clock_timestamp() AS current,${utcTimestampSql("created_at")} AS created_at,${utcTimestampSql("expires_at")} AS expires_at
    FROM public.media_upload_reservations WHERE id=$1 AND actor_id=$2 AND session_id=$3
    ${lock ? " FOR UPDATE" : ""}`,
    [command.uploadId, command.actorId, command.sessionId],
  );
  return row;
}
function ticketResponse(row: DraftRow) {
  return mediaUploadTicketResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    value: {
      schemaVersion: 1,
      uploadId: row["id"],
      version: row["version"],
      actorId: row["actor_id"],
      sessionId: row["session_id"],
      source: {
        objectKey: row["object_key"],
        checksumSha256: row["checksum_sha256"],
        byteSize: Number(row["byte_size"]),
        mimeType: row["mime_type"],
      },
      rightsReference: row["rights_reference"],
      status: row["status"],
      assetId: row["registered_asset_id"],
      createdAt: row["created_at"],
      expiresAt: row["expires_at"],
    },
  });
}
export function createResourceUploadMethods(
  client: TransactionClient,
  run: ResourceRun,
): Pick<
  ResourceManagementRepository,
  "reserveUpload" | "readUpload" | "registerUpload"
> {
  return {
    readUpload(input) {
      const parsed = mediaUploadReadCommandSchema.safeParse(input);
      if (!parsed.success)
        return Promise.resolve(resourceFailure("INVALID_COMMAND"));
      return run(async () => {
        const row = await loadTicket(client, parsed.data);
        if (!row) return resourceFailure("NOT_FOUND");
        return row["status"] === "PENDING" && row["current"] !== true
          ? resourceFailure("STALE_VERSION")
          : ticketResponse(row);
      });
    },
    reserveUpload(input) {
      const parsed = mediaUploadReserveCommandSchema.safeParse(input);
      if (!parsed.success)
        return Promise.resolve(resourceFailure("INVALID_COMMAND"));
      return run(async () => {
        const command = parsed.data;
        if (
          command.objectKey !== `uploads/v1/${command.uploadId.toLowerCase()}`
        )
          return resourceFailure("INVALID_COMMAND");
        const [existing] = await draftRows(
          client,
          "SELECT id FROM public.media_upload_reservations WHERE id=$1 FOR UPDATE",
          [command.uploadId],
        );
        if (existing) return resourceFailure("ALREADY_EXISTS");
        const time = await resourceEventTime(client, {
          sessionId: command.sessionId,
          permission: "content.media.upload",
        });
        await writeResourceAudit(client, {
          ...command,
          auditId: time.auditId,
          at: command.createdAt,
          action: "MEDIA_UPLOAD_BEGIN",
          subjectType: "MEDIA_UPLOAD_RESERVATION",
          subjectId: command.uploadId,
        });
        await client.query(
          `/* resource-management:reserve-upload */ INSERT INTO public.media_upload_reservations(id,actor_id,session_id,object_key,checksum_sha256,mime_type,byte_size,rights_reference,created_at,expires_at,audit_log_id)
          SELECT $1,$2,$3::uuid,$4,$5,$6,$7,$8,$9::timestamptz,LEAST($10::timestamptz,clock_timestamp()+interval '900 seconds',s.expires_at,$9::timestamptz+interval '900 seconds'),$11 FROM public.admin_sessions s WHERE s.id=$3::uuid`,
          [
            command.uploadId,
            command.actorId,
            command.sessionId,
            command.objectKey,
            command.checksumSha256,
            command.mimeType,
            command.byteSize,
            command.rightsReference,
            command.createdAt,
            command.expiresAt,
            time.auditId,
          ],
        );
        const row = await loadTicket(client, {
          schemaVersion: 1,
          uploadId: command.uploadId,
          actorId: command.actorId,
          sessionId: command.sessionId,
        });
        return row
          ? ticketResponse(row)
          : resourceFailure("CONTENT_UNAVAILABLE");
      });
    },
    registerUpload(input) {
      const parsed = mediaUploadRegisterCommandSchema.safeParse(input);
      if (!parsed.success)
        return Promise.resolve(resourceFailure("INVALID_COMMAND"));
      return run(async () => {
        const command = parsed.data;
        const row = await loadTicket(
          client,
          {
            schemaVersion: 1,
            uploadId: command.uploadId,
            actorId: command.actorId,
            sessionId: command.sessionId,
          },
          true,
        );
        if (!row) return resourceFailure("NOT_FOUND");
        if (
          row["status"] !== "PENDING" ||
          row["version"] !== command.expectedVersion ||
          row["current"] !== true
        )
          return resourceFailure("STALE_VERSION");
        const receipt = command.receipt,
          source = receipt.source;
        if (
          source.objectKey !== row["object_key"] ||
          source.checksumSha256 !== row["checksum_sha256"] ||
          source.mimeType !== row["mime_type"] ||
          source.byteSize !== Number(row["byte_size"])
        )
          return resourceFailure("INVALID_CONTENT");
        const time = await resourceEventTime(
          client,
          { sessionId: command.sessionId, permission: "content.media.upload" },
          [contentTimestampSchema.parse(row["created_at"])],
        );
        await client.query(
          `INSERT INTO public.media_assets(id,identity_kind,checksum_sha256,mime_type,width,height,byte_size,object_key,processing_status,rights_status,rights_reference,created_at)
          VALUES($1,'SOURCE',$2,$3,$4,$5,$6,$7,'PENDING','PENDING',$8,$9) ON CONFLICT DO NOTHING`,
          [
            command.assetId,
            source.checksumSha256,
            source.mimeType,
            receipt.width,
            receipt.height,
            source.byteSize,
            source.objectKey,
            row["rights_reference"],
            time.at,
          ],
        );
        const [asset] = await draftRows(
          client,
          "SELECT * FROM public.media_assets WHERE checksum_sha256=$1 AND identity_kind='SOURCE' FOR SHARE",
          [source.checksumSha256],
        );
        if (
          !asset ||
          asset["mime_type"] !== source.mimeType ||
          asset["width"] !== receipt.width ||
          asset["height"] !== receipt.height ||
          Number(asset["byte_size"]) !== source.byteSize ||
          asset["processing_status"] === "ARCHIVED"
        )
          return resourceFailure("INVALID_CONTENT");
        await writeResourceAudit(client, {
          ...command,
          ...time,
          action: "MEDIA_UPLOAD_REGISTER",
          subjectType: "MEDIA_UPLOAD_RESERVATION",
          subjectId: command.uploadId,
        });
        await client.query(
          `UPDATE public.media_upload_reservations SET status='REGISTERED',version=2,registered_asset_id=$2,registered_at=$3,registration_audit_log_id=$4,
          verified_width=$5,verified_height=$6,verified_orientation=$7,registration_field_paths=ARRAY['registration'] WHERE id=$1`,
          [
            command.uploadId,
            asset["id"],
            time.at,
            time.auditId,
            receipt.width,
            receipt.height,
            receipt.orientation,
          ],
        );
        return resourceMutation(String(asset["id"]));
      });
    },
  };
}
