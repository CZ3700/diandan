import {
  createIdolAliasDraftCommandSchema,
  createGiftDetailDraftCommandSchema,
  contentDraftReadCommandSchema,
  type ContentDraftFailure,
} from "@fan-support/contracts";
import {
  prepareIdolAliasDraft,
  prepareGiftDetailDraft,
} from "@fan-support/content";
import type { ContentDraftRepository } from "@fan-support/persistence-port";
import {
  draftRows,
  draftTimestamp,
  loadIdolAliasDraft,
  loadGiftDetailDraft,
} from "./content-draft-data.js";
import {
  persistIdolAliasDraft,
  persistGiftDetailDraft,
} from "./content-draft-writes.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

const failure = (code: ContentDraftFailure["code"]): ContentDraftFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});

export function createContentDraftRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): ContentDraftRepository {
  function run<Result>(work: () => Promise<Result>): Promise<Result> {
    return scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error: unknown) {
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  }
  async function checkParent(
    actorId: string,
    revisionId: string,
    id: string,
    kind: "IDOL_ALIASES" | "GIFT_DETAILS",
  ): Promise<ContentDraftFailure | undefined> {
    const [actor] = await draftRows(
      client,
      "SELECT id FROM admin_identities WHERE id = $1 AND status = 'ACTIVE' FOR SHARE",
      [actorId],
    );
    if (!actor) return failure("ACTOR_UNAVAILABLE");
    const parentTable =
      kind === "IDOL_ALIASES" ? "idol_revisions" : "gift_revisions";
    const [parent] = await draftRows(
      client,
      `SELECT lifecycle FROM ${parentTable} WHERE id = $1 FOR UPDATE`,
      [revisionId],
    );
    if (!parent) return failure("NOT_FOUND");
    if (parent["lifecycle"] !== "DRAFT") return failure("REVISION_NOT_DRAFT");
    const table =
      kind === "IDOL_ALIASES"
        ? "idol_revision_alias_sets"
        : "gift_detail_documents";
    const column =
      kind === "IDOL_ALIASES" ? "idol_revision_id" : "gift_revision_id";
    const [existing] = await draftRows(
      client,
      `SELECT id FROM ${table} WHERE ${column} = $1 OR id = $2`,
      [revisionId, id],
    );
    return existing ? failure("ALREADY_EXISTS") : undefined;
  }
  async function timestamp(): Promise<string> {
    const [row] = await draftRows(
      client,
      "SELECT transaction_timestamp() AS now",
    );
    return draftTimestamp(row?.["now"]);
  }
  return {
    createIdolAliases: (input) =>
      run(async () => {
        const parsed = createIdolAliasDraftCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const command = parsed.data;
        const invalid = await checkParent(
          command.actorId,
          command.idolRevisionId,
          command.id,
          "IDOL_ALIASES",
        );
        if (invalid) return invalid;
        const snapshot = prepareIdolAliasDraft(command, await timestamp());
        if (snapshot.outcome === "FAILURE") return snapshot;
        await persistIdolAliasDraft(client, command, snapshot);
        return snapshot;
      }),
    createGiftDetails: (input) =>
      run(async () => {
        const parsed = createGiftDetailDraftCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const command = parsed.data;
        const invalid = await checkParent(
          command.actorId,
          command.document.giftRevisionId,
          command.document.id,
          "GIFT_DETAILS",
        );
        if (invalid) return invalid;
        const editedAt = await timestamp();
        const snapshot = prepareGiftDetailDraft(command, editedAt);
        if (snapshot.outcome === "FAILURE") return snapshot;
        await persistGiftDetailDraft(client, command, snapshot, editedAt);
        return snapshot;
      }),
    read: (input) =>
      run(async () => {
        const parsed = contentDraftReadCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const command = parsed.data;
        return command.kind === "IDOL_ALIASES"
          ? loadIdolAliasDraft(client, command.idolRevisionId)
          : loadGiftDetailDraft(client, command.giftRevisionId);
      }),
  };
}
