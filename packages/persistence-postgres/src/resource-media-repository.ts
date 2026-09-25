import {
  resourceMediaReadCommandSchema,
  resourceMediaResponseSchema,
  mediaRightsSetCommandSchema,
  contentTimestampSchema,
} from "@fan-support/contracts";
import type { ResourceManagementRepository } from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import {
  resourceEventTime,
  resourceFailure,
  resourceMutation,
  utcTimestampSql,
  writeResourceAudit,
  type ResourceRun,
} from "./resource-management-data.js";
import type { TransactionClient } from "./transaction-runner.js";

export function createResourceMediaMethods(
  client: TransactionClient,
  run: ResourceRun,
): Pick<ResourceManagementRepository, "readMedia" | "setRights"> {
  return {
    readMedia(input) {
      const parsed = resourceMediaReadCommandSchema.safeParse(input);
      if (!parsed.success)
        return Promise.resolve(resourceFailure("INVALID_COMMAND"));
      return run(async () => {
        const [row] = await draftRows(
          client,
          `SELECT a.*,COALESCE((SELECT max(version) FROM public.media_rights_events WHERE asset_id=a.id),0) AS rights_version FROM public.media_assets a WHERE id=$1`,
          [parsed.data.assetId],
        );
        if (!row) return resourceFailure("NOT_FOUND");
        return resourceMediaResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "MEDIA",
          media: {
            schemaVersion: 1,
            assetId: row["id"],
            identityKind: row["identity_kind"],
            mimeType: row["mime_type"],
            width: row["width"],
            height: row["height"],
            byteSize: Number(row["byte_size"]),
            processingStatus: row["processing_status"],
            rightsStatus: row["rights_status"],
            rightsVersion: row["rights_version"],
          },
        });
      });
    },
    setRights(input) {
      const parsed = mediaRightsSetCommandSchema.safeParse(input);
      if (!parsed.success)
        return Promise.resolve(resourceFailure("INVALID_COMMAND"));
      return run(async () => {
        const command = parsed.data;
        const [asset] = await draftRows(
          client,
          `SELECT id,rights_status,${utcTimestampSql("created_at")} AS created_at FROM public.media_assets WHERE id=$1 FOR UPDATE`,
          [command.assetId],
        );
        if (!asset) return resourceFailure("NOT_FOUND");
        const [previous] = await draftRows(
          client,
          `SELECT version,${utcTimestampSql("created_at")} AS created_at FROM public.media_rights_events WHERE asset_id=$1 ORDER BY version DESC LIMIT 1`,
          [command.assetId],
        );
        if (Number(previous?.["version"] ?? 0) !== command.expectedVersion)
          return resourceFailure("STALE_VERSION");
        const time = await resourceEventTime(
          client,
          { sessionId: command.sessionId, permission: "content.media.rights" },
          [
            contentTimestampSchema.parse(asset["created_at"]),
            ...(previous
              ? [contentTimestampSchema.parse(previous["created_at"])]
              : []),
          ],
        );
        await writeResourceAudit(client, {
          ...command,
          ...time,
          action: "MEDIA_RIGHTS_SET",
          subjectType: "MEDIA_RIGHTS_EVENT",
          subjectId: command.eventId,
        });
        await client.query(
          `INSERT INTO public.media_rights_events(id,asset_id,version,previous_status,new_status,evidence_reference,actor_id,session_id,audit_log_id,created_at,field_paths)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            command.eventId,
            command.assetId,
            command.expectedVersion + 1,
            asset["rights_status"],
            command.rightsStatus,
            command.evidenceReference,
            command.actorId,
            command.sessionId,
            time.auditId,
            time.at,
            asset["rights_status"] === command.rightsStatus
              ? ["rightsEvidence"]
              : ["rightsStatus", "rightsEvidence"],
          ],
        );
        await client.query(
          "UPDATE public.media_assets SET rights_status=$2 WHERE id=$1",
          [command.assetId, command.rightsStatus],
        );
        return resourceMutation(command.eventId);
      });
    },
  };
}
