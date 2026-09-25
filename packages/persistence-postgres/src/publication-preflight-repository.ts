import {
  contentTimestampSchema,
  publicationPreflightCommandSchema,
  publicationPreflightContextSchema,
  type ContentAuthoringSnapshot,
} from "@fan-support/contracts";
import type { PublicationPreflightRepository } from "@fan-support/persistence-port";
import { baseContentFailure, baseContentRun } from "./base-content-data.js";
import {
  lockAuthoringOwner,
  type ContentSnapshotLockMode,
} from "./content-authoring-data.js";
import { ownerValue } from "./content-authoring-model.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import {
  preflightSnapshot,
  loadPreflightMedia,
} from "./publication-preflight-data.js";
import {
  PREFLIGHT_TABLES,
  preflightApprovals,
} from "./publication-preflight-mapping.js";
import {
  loadPreflightCopies,
  loadPreflightExtensionApprovals,
} from "./publication-preflight-evidence.js";
import { loadPreflightCandidate } from "./publication-preflight-candidate.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

function snapshotInstants(snapshot: ContentAuthoringSnapshot): string[] {
  const instants = [snapshot.createdAt];
  for (const [field, value] of Object.entries(snapshot.lifecycle))
    if (field !== "status") instants.push(value);
  for (const audit of snapshot.translationAudits) {
    instants.push(audit.editedAt);
    if (audit.review.status === "APPROVED")
      instants.push(audit.review.reviewedAt);
    else if (audit.review.status === "IN_REVIEW")
      instants.push(audit.review.submittedAt);
  }
  return instants;
}

export function createPublicationPreflightRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  lockMode: ContentSnapshotLockMode = "UPDATE",
): PublicationPreflightRepository {
  return {
    load: (input) =>
      baseContentRun(scope, async () => {
        const parsed = publicationPreflightCommandSchema.safeParse(input);
        if (!parsed.success) return baseContentFailure("INVALID_COMMAND");
        const command = parsed.data;
        await client.query("SET LOCAL TIME ZONE 'UTC'");
        if (!(await lockAuthoringOwner(client, command.target.owner, lockMode)))
          return baseContentFailure("NOT_FOUND");
        const snapshot = await preflightSnapshot(
          client,
          command.target.owner,
          command.target.revisionId,
          lockMode,
        );
        if (!snapshot) return baseContentFailure("NOT_FOUND");
        const table = PREFLIGHT_TABLES[snapshot.target.kind];
        const [headRow] = await draftRows(
          client,
          `SELECT to_jsonb(h.*)||jsonb_build_object('action',p.action) AS head
        FROM public.${table.heads} h JOIN public.content_publications p ON p.id=h.publication_id
        WHERE ${table.owner === null ? "true" : `h.${table.owner}=$1`} FOR SHARE OF h,p`,
          table.owner === null ? [] : [ownerValue(snapshot.target)],
        );
        const head = headRow?.["head"] as DraftRow | undefined;
        const headVersion = head ? Number(head["version"]) : 0;
        const [historical] = await draftRows(
          client,
          `SELECT id,action,to_char(published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS published_at
        FROM public.content_publications WHERE ${table.parent}=$1${table.owner === null ? "" : ` AND ${table.owner}=$2`}
        ORDER BY published_at,id LIMIT 1`,
          table.owner === null
            ? [snapshot.revisionId]
            : [snapshot.revisionId, ownerValue(snapshot.target)],
        );
        const previousPublication = historical
          ? {
              publicationId: historical["id"],
              target: {
                owner: snapshot.target,
                revisionId: snapshot.revisionId,
              },
              action: historical["action"],
              publishedAt: historical["published_at"],
            }
          : null;
        const media = await loadPreflightMedia(client, snapshot, lockMode);
        const snapshots = [snapshot, ...media.mediaSnapshots];
        const approvals = snapshots.flatMap(preflightApprovals);
        const copies = await loadPreflightCopies(client, snapshots, lockMode);
        const extensionApprovals = await loadPreflightExtensionApprovals(
          client,
          snapshot,
        );
        const instants = snapshots.flatMap(snapshotInstants);
        if (head)
          instants.push(contentTimestampSchema.parse(head["updated_at"]));
        for (const proof of extensionApprovals)
          instants.push(proof.editedAt, proof.reviewedAt);
        const [clock] = await draftRows(
          client,
          `SELECT to_char(GREATEST(clock_timestamp(),transaction_timestamp(),(SELECT max(value) FROM unnest($1::timestamptz[]) AS value)) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS evaluated_at`,
          [instants],
        );
        const evaluatedAt = contentTimestampSchema.parse(
          clock?.["evaluated_at"],
        );
        const context = publicationPreflightContextSchema.parse({
          schemaVersion: 1,
          target: { owner: snapshot.target, revisionId: snapshot.revisionId },
          action: command.action,
          headVersion,
          evaluatedAt,
          snapshot,
          previousPublication,
          candidate: await loadPreflightCandidate(
            client,
            snapshot,
            head,
            media,
            command.action,
            evaluatedAt,
          ),
          mediaSnapshots: media.mediaSnapshots,
          approvals,
          copies,
          extensionApprovals,
          mediaLineage: media.mediaLineage,
        });
        return { schemaVersion: 1, outcome: "SUCCESS", context };
      }),
  };
}
