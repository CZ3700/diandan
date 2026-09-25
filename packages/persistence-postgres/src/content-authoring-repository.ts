import {
  contentAuthoringReadCommandSchema,
  contentAuthoringWriteCommandSchema,
  type ContentAuthoringReadResponse,
} from "@fan-support/contracts";
import { prepareContentAuthoring } from "@fan-support/content";
import type { ContentAuthoringRepository } from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import {
  authoringHeadVersion,
  authoringTime,
  loadAuthoringSnapshot,
  lockAuthoringOwner,
} from "./content-authoring-data.js";
import { authoringFailure } from "./content-authoring-model.js";
import {
  persistContentAuthoring,
  type ContentAuthoringGiftOptions,
} from "./content-authoring-writes.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

/** Canonical normalized content authoring within the caller's transaction. */
export function createContentAuthoringRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  giftOptions?: ContentAuthoringGiftOptions,
): ContentAuthoringRepository {
  function run<Result>(work: () => Promise<Result>): Promise<Result> {
    return scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  }
  return {
    read: (input) =>
      run(async (): Promise<ContentAuthoringReadResponse> => {
        const parsed = contentAuthoringReadCommandSchema.safeParse(input);
        if (!parsed.success) return authoringFailure("INVALID_COMMAND");
        const command = parsed.data;
        await client.query("SET LOCAL TIME ZONE 'UTC'");
        if (!(await lockAuthoringOwner(client, command.target)))
          return authoringFailure("NOT_FOUND");
        const headVersion = await authoringHeadVersion(client, command.target);
        const snapshot = await loadAuthoringSnapshot(
          client,
          command.target,
          command.revisionId,
          headVersion,
        );
        return snapshot
          ? { schemaVersion: 1, outcome: "SUCCESS", kind: "REVISION", snapshot }
          : authoringFailure("NOT_FOUND");
      }),
    write: (input) =>
      run(async () => {
        const parsed = contentAuthoringWriteCommandSchema.safeParse(input);
        if (!parsed.success) return authoringFailure("INVALID_COMMAND");
        const { command, actorId } = parsed.data;
        await client.query("SET LOCAL TIME ZONE 'UTC'");
        const [actor] = await draftRows(
          client,
          "SELECT id FROM public.admin_identities WHERE id=$1 AND status='ACTIVE' FOR SHARE",
          [actorId],
        );
        if (!actor) return authoringFailure("FORBIDDEN");
        const owner = await lockAuthoringOwner(client, command.target);
        if (!owner) return authoringFailure("NOT_FOUND");
        if (
          owner["status"] === "archived" ||
          owner["processing_status"] === "ARCHIVED"
        )
          return authoringFailure("FORBIDDEN");
        const headVersion = await authoringHeadVersion(client, command.target);
        if (headVersion !== command.expectedVersion)
          return authoringFailure("STALE_VERSION");
        const source =
          command.action === "COPY"
            ? await loadAuthoringSnapshot(
                client,
                command.target,
                command.sourceRevisionId,
                headVersion,
              )
            : null;
        if (command.action === "COPY" && !source)
          return authoringFailure("NOT_FOUND");
        if (
          command.action === "COPY" &&
          source?.contentHash !== command.expectedSourceHash
        )
          return authoringFailure("STALE_CONTENT");
        let plan;
        const time = await authoringTime(
          client,
          command.target,
          owner,
          source ?? null,
          command.target.kind === "GIFT"
            ? giftOptions?.trustedCommerceTime
            : undefined,
        );
        try {
          plan = prepareContentAuthoring(command, source ?? null, {
            actorId,
            createdAt: time,
          });
        } catch {
          return authoringFailure("INVALID_CONTENT");
        }
        const resultId = await persistContentAuthoring(
          client,
          parsed.data,
          plan,
          time,
          source ?? null,
          giftOptions,
        );
        return {
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "MUTATION",
          resultId,
          replayed: false,
        };
      }),
  };
}
