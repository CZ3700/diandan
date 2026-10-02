import {
  adminCatalogResponseSchema,
  adminResourceResponseSchema,
  baseContentResponseSchema,
  contentAuthoringResponseSchema,
  contentAuthoringContentSchema,
  policyKeySchema,
  policyKindSchema,
  translationWorkspaceResponseSchema,
  type AdminCatalogOwner,
  type ContentAuthoringTarget,
  type SupportedLocale,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "../workspace/client";
import { createMutationKeys } from "../workspace/state";
import {
  emptyPolicyFields,
  policyChanges,
  samePolicyFields,
  type PolicyDraft,
  type PolicyKind,
  type PolicyWorkspaceData,
} from "./model";

export type PolicyState = {
  owner: AdminCatalogOwner;
  workspace: PolicyWorkspaceData | null;
  draft: PolicyDraft | null;
};
const sameTarget = (a: ContentAuthoringTarget, b: ContentAuthoringTarget) =>
  a.kind === "POLICY" && b.kind === "POLICY" && a.policyKey === b.policyKey;
export function createPoliciesApi(client: AdminClient) {
  const keys = createMutationKeys();
  async function read(
    target: ContentAuthoringTarget,
    locale: SupportedLocale,
    revisionId?: string,
  ): Promise<PolicyState> {
    if (target.kind !== "POLICY") throw new AdminClientError("INVALID_COMMAND");
    const result = await client.call(
      "catalog-owner",
      { schemaVersion: 1, target, locale },
      adminCatalogResponseSchema,
    );
    if (
      result.kind !== "OWNER" ||
      !sameTarget(result.owner.target, target) ||
      result.owner.locale !== locale
    )
      throw new AdminClientError("INVALID_RESPONSE");
    const owner = result.owner;
    const id =
      revisionId ??
      owner.latestRevisionId ??
      owner.draftRevisionId ??
      owner.publishedRevisionId;
    if (!id) {
      const policy = await client.call(
        "policy-read",
        { schemaVersion: 1, policyKey: target.policyKey },
        adminResourceResponseSchema,
      );
      if (
        policy.kind !== "POLICY" ||
        policy.policy.policyKey !== target.policyKey
      )
        throw new AdminClientError("INVALID_RESPONSE");
      return {
        owner,
        workspace: null,
        draft: {
          kind: policy.policy.kind,
          effectiveAt: "",
          translations: [
            { locale: "en", origin: "MACHINE", fields: emptyPolicyFields() },
          ],
        },
      };
    }
    const workspace = await client.call(
      "translation-read",
      { schemaVersion: 1, target: { owner: target, revisionId: id, locale } },
      translationWorkspaceResponseSchema,
    );
    if (
      !sameTarget(workspace.target.owner, target) ||
      workspace.target.revisionId.toLowerCase() !== id.toLowerCase() ||
      workspace.target.locale !== locale
    )
      throw new AdminClientError("INVALID_RESPONSE");
    const selected = workspace.selected;
    let draft: PolicyDraft | null =
      selected?.content.kind === "POLICY"
        ? {
            ...selected.content.structure,
            translations: [
              {
                locale,
                origin: selected.context.audit.origin,
                ...(selected.context.audit.importBatchId
                  ? { importBatchId: selected.context.audit.importBatchId }
                  : {}),
                fields: selected.content.fields,
              },
            ],
          }
        : null;
    // Full source is restricted by canonical locale grants. Locale reviewers still work
    // from the authorized workspace projection when this wider read is forbidden.
    try {
      const full = await client.call(
        "authoring-read",
        { schemaVersion: 1, target, revisionId: id },
        contentAuthoringResponseSchema,
      );
      if (
        full.kind !== "REVISION" ||
        !sameTarget(full.snapshot.target, target) ||
        full.snapshot.revisionId.toLowerCase() !== id.toLowerCase() ||
        full.snapshot.content.kind !== "POLICY" ||
        full.snapshot.contentHash !== workspace.contentHash
      )
        throw new AdminClientError("INVALID_RESPONSE");
      draft = {
        ...full.snapshot.content.structure,
        translations: full.snapshot.content.translations,
      };
    } catch (error) {
      if (!(error instanceof AdminClientError) || error.code !== "FORBIDDEN")
        throw error;
    }
    if (!draft) {
      // Scoped editors may add missing text without reading structure or managing
      // policy registration. Unknown kind/time stay local; COPY omits structure.
      draft = { kind: null, effectiveAt: "", translations: [] };
    }
    return { owner, workspace, draft };
  }
  return {
    client,
    read,
    async register(policyKey: string, kind: PolicyKind) {
      const command = {
        schemaVersion: 1,
        policyKey: policyKeySchema.parse(policyKey),
        kind: policyKindSchema.parse(kind),
        expectedVersion: 0,
        reasonCode: "POLICY_REGISTER",
      };
      const response = await client.call(
        "policy-create",
        command,
        adminResourceResponseSchema,
        true,
        keys.forCommand("policy-create", command),
      );
      if (response.kind !== "MUTATION")
        throw new AdminClientError("INVALID_RESPONSE");
      keys.succeeded("policy-create", command);
    },
    async list(locale: SupportedLocale): Promise<AdminCatalogOwner[]> {
      const owners: AdminCatalogOwner[] = [];
      for (let page = 1; page <= 1000; page++) {
        const response = await client.call(
          "catalog-list",
          { schemaVersion: 1, kind: "POLICY", locale, page, pageSize: 50 },
          adminCatalogResponseSchema,
        );
        if (
          response.kind !== "OWNERS" ||
          response.page !== page ||
          response.pageSize !== 50 ||
          response.items.some(
            (item) => item.target.kind !== "POLICY" || item.locale !== locale,
          )
        )
          throw new AdminClientError("INVALID_RESPONSE");
        owners.push(...response.items);
        if (
          new Set(
            owners.map((item) =>
              item.target.kind === "POLICY" ? item.target.policyKey : "",
            ),
          ).size !== owners.length
        )
          throw new AdminClientError("INVALID_RESPONSE");
        if (owners.length >= response.totalItems) return owners;
        if (!response.items.length)
          throw new AdminClientError("INVALID_RESPONSE");
      }
      throw new AdminClientError("INVALID_RESPONSE");
    },
    async save(
      state: PolicyState,
      draft: PolicyDraft,
      locale: SupportedLocale,
    ) {
      if (
        !state.draft ||
        (state.workspace && !state.workspace.editability.canSave)
      )
        throw new AdminClientError("FORBIDDEN");
      const changes = state.workspace
        ? policyChanges(state.draft, draft)
        : { kind: "POLICY" as const, translations: draft.translations };
      if (Object.keys(changes).length === 1)
        throw new AdminClientError("INVALID_COMMAND");
      const operation = state.workspace ? "authoring-copy" : "authoring-create";
      const command = state.workspace
        ? {
            schemaVersion: 1,
            target: state.owner.target,
            sourceRevisionId: state.workspace.target.revisionId,
            expectedVersion: state.workspace.authoringHeadVersion,
            expectedSourceHash: state.workspace.contentHash,
            reasonCode: "POLICY_EDIT",
            changes,
          }
        : {
            schemaVersion: 1,
            target: state.owner.target,
            expectedVersion: state.owner.authoringVersion,
            reasonCode: "POLICY_CREATE",
            content: contentAuthoringContentSchema.parse({
              kind: "POLICY",
              structure: { kind: draft.kind, effectiveAt: draft.effectiveAt },
              translations: draft.translations,
            }),
          };
      const result = await client.call(
        operation,
        command,
        contentAuthoringResponseSchema,
        true,
        keys.forCommand(operation, command),
      );
      if (result.kind !== "MUTATION")
        throw new AdminClientError("INVALID_RESPONSE");
      const next = await read(state.owner.target, locale, result.resultId);
      if (
        !next.draft ||
        (draft.kind !== null && next.draft.kind !== draft.kind) ||
        (draft.effectiveAt !== "" &&
          new Date(next.draft.effectiveAt).getTime() !==
            new Date(draft.effectiveAt).getTime()) ||
        changes.kind !== "POLICY" ||
        changes.translations?.some((row) => {
          const saved = next.draft?.translations.find(
            (item) => item.locale === row.locale,
          );
          return (
            !saved ||
            !samePolicyFields(saved.fields, row.fields) ||
            saved.origin !== row.origin ||
            saved.importBatchId !== row.importBatchId
          );
        })
      )
        throw new AdminClientError("INVALID_RESPONSE");
      keys.succeeded(operation, command);
      return next;
    },
    async review(workspace: PolicyWorkspaceData, action: "submit" | "approve") {
      const context = workspace.selected?.context;
      if (!context || context.stale || workspace.lifecycle.status !== "DRAFT")
        throw new AdminClientError("INVALID_COMMAND");
      const command = {
        schemaVersion: 1,
        target: context.target,
        expectedVersion: context.audit.reviewSequence,
        expectedContentHash: context.audit.sourceHash,
        expectedSourceHash: context.currentEnglishSourceHash,
        reasonCode: "POLICY_REVIEW",
      };
      const operation = `review-${action}`;
      const result = await client.call(
        operation,
        command,
        baseContentResponseSchema,
        true,
        keys.forCommand(operation, command),
      );
      if (result.kind !== "MUTATION")
        throw new AdminClientError("INVALID_RESPONSE");
      // Keep the key for this immutable review command. If the following read
      // fails, retrying the displayed action replays its receipt, not a new review.
    },
  };
}
export type PoliciesApi = ReturnType<typeof createPoliciesApi>;
