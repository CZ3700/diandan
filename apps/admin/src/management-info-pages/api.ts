import {
  informationPageResponseSchema,
  type InformationPageKey,
  type SupportedLocale,
  type InformationPageWorkspace,
  type InformationPageResponse,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "../workspace/client";
import { createMutationKeys } from "../workspace/state";
import { sameDraft, type InformationDraft } from "./model";
export type InformationHistory = Extract<
  InformationPageResponse,
  { kind: "HISTORY" }
>;
export function createInformationPagesApi(client: AdminClient) {
  const keys = createMutationKeys();
  async function read(pageKey: InformationPageKey, locale: SupportedLocale) {
    const response = await client.call(
      "information-pages-read",
      { schemaVersion: 1, pageKey, locale },
      informationPageResponseSchema,
    );
    if (
      response.kind !== "STATE" ||
      response.workspace.pageKey !== pageKey ||
      response.workspace.locale !== locale
    )
      throw new AdminClientError("INVALID_RESPONSE");
    return response.workspace;
  }
  async function mutate(
    suffix: string,
    workspace: InformationPageWorkspace,
    extra: Record<string, unknown>,
    matches: (next: InformationPageWorkspace) => boolean,
  ) {
    const operation = `information-pages-${suffix}`;
    const command = {
      schemaVersion: 1,
      pageKey: workspace.pageKey,
      locale: workspace.locale,
      expectedVersion: workspace.version,
      ...extra,
    };
    const result = await client.call(
      operation,
      command,
      informationPageResponseSchema,
      true,
      keys.forCommand(operation, command),
    );
    if (
      result.kind !== "STATE" ||
      result.workspace.pageKey !== workspace.pageKey ||
      result.workspace.locale !== workspace.locale ||
      result.workspace.version !== workspace.version + 1 ||
      !matches(result.workspace)
    )
      throw new AdminClientError("INVALID_RESPONSE");
    const current = result.replayed
      ? await read(workspace.pageKey, workspace.locale)
      : result.workspace;
    keys.succeeded(operation, command);
    return current;
  }
  return {
    read,
    async history(
      pageKey: InformationPageKey,
      locale: SupportedLocale,
      page = 1,
    ): Promise<InformationHistory> {
      const result = await client.call(
        "information-pages-history",
        { schemaVersion: 1, pageKey, locale, page, pageSize: 10 },
        informationPageResponseSchema,
      );
      if (
        result.kind !== "HISTORY" ||
        result.page !== page ||
        result.pageSize !== 10 ||
        result.entries.some((entry) => entry.pageKey !== pageKey)
      )
        throw new AdminClientError("INVALID_RESPONSE");
      return result;
    },
    save(workspace: InformationPageWorkspace, draft: InformationDraft) {
      return mutate(
        "save",
        workspace,
        {
          revisionId: workspace.draft?.revisionId ?? null,
          expectedSourceHash: workspace.draft?.sourceHash ?? null,
          structure: workspace.locale === "en" ? draft.structure : null,
          fields: draft.fields,
        },
        (next) =>
          Boolean(
            next.draft &&
            next.selected &&
            sameDraft(
              { structure: next.draft.structure, fields: next.selected.fields },
              draft,
            ),
          ),
      );
    },
    review(workspace: InformationPageWorkspace, action: "submit" | "approve") {
      if (!workspace.draft || !workspace.selected)
        throw new AdminClientError("INVALID_COMMAND");
      const revisionId = workspace.draft.revisionId;
      const selected = workspace.selected;
      const sourceHash = workspace.draft.sourceHash;
      return mutate(
        action,
        workspace,
        {
          revisionId,
          expectedContentHash: selected.contentHash,
          expectedSourceHash: sourceHash,
          expectedReviewSequence: selected.review.sequence,
        },
        (next) =>
          next.draft?.revisionId === revisionId &&
          next.draft.sourceHash === sourceHash &&
          next.selected?.contentHash === selected.contentHash &&
          next.selected.review.sequence === selected.review.sequence + 1 &&
          next.selected.review.status ===
            (action === "submit" ? "IN_REVIEW" : "APPROVED"),
      );
    },
    publish(workspace: InformationPageWorkspace) {
      if (!workspace.draft) throw new AdminClientError("INVALID_COMMAND");
      const revisionId = workspace.draft.revisionId;
      return mutate(
        "publish",
        workspace,
        { revisionId },
        (next) =>
          next.published?.revisionId === revisionId &&
          next.published.action === "PUBLISH",
      );
    },
    unpublish(workspace: InformationPageWorkspace) {
      return mutate(
        "unpublish",
        workspace,
        {},
        (next) =>
          next.published === null || next.published.action === "UNPUBLISH",
      );
    },
    restore(workspace: InformationPageWorkspace, publicationId: string) {
      return mutate(
        "restore",
        workspace,
        { publicationId },
        (next) =>
          next.published?.action === "RESTORE" &&
          next.published.restoredFromPublicationId === publicationId,
      );
    },
  };
}
export type InformationPagesApi = ReturnType<typeof createInformationPagesApi>;
