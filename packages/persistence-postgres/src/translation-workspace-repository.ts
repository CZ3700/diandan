import {
  translationWorkspaceCommandSchema,
  translationWorkspaceContextResponseSchema,
  baseContentTextSchema,
  type TranslationPreviousEnglish,
} from "@fan-support/contracts";
import {
  assertTranslationSnapshot,
  computeBaseContentTextHash,
} from "@fan-support/content";
import type { TranslationWorkspaceRepository } from "@fan-support/persistence-port";
import { createContentAuthoringRepository } from "./content-authoring-repository.js";
import { AUTHORING_TABLES, ownerValue } from "./content-authoring-model.js";
import { draftRows } from "./content-draft-data.js";
import { baseContentFailure, baseContentRun } from "./base-content-data.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";
export function createTranslationWorkspaceRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): TranslationWorkspaceRepository {
  return {
    read: (input) =>
      baseContentRun(scope, async () => {
        const parsed = translationWorkspaceCommandSchema.safeParse(input);
        if (!parsed.success) return baseContentFailure("INVALID_COMMAND");
        const { target } = parsed.data,
          authoring = createContentAuthoringRepository(client, scope);
        const loaded = await authoring.read({
          schemaVersion: 1,
          action: "READ",
          target: target.owner,
          revisionId: target.revisionId,
        });
        if (loaded.outcome === "FAILURE") return loaded;
        const snapshot = assertTranslationSnapshot(loaded.snapshot, target),
          table = AUTHORING_TABLES[target.owner.kind];
        const audit = snapshot.translationAudits.find(
          (row) => row.locale === target.locale,
        );
        const englishHash = snapshot.translationAudits.find(
          (row) => row.locale === "en",
        )!.sourceHash;
        let previousEnglish: TranslationPreviousEnglish | null = null;
        if (audit && audit.translatedFromSourceHash !== englishHash) {
          const [previous] = await draftRows(
            client,
            `WITH RECURSIVE chain(id,depth,visited) AS (
        SELECT source_${table.parent},1,ARRAY[${table.parent},source_${table.parent}] FROM public.content_authoring_receipts WHERE ${table.parent}=$1 AND action='COPY'
        UNION ALL SELECT r.source_${table.parent},c.depth+1,c.visited||r.source_${table.parent} FROM chain c JOIN public.content_authoring_receipts r ON r.${table.parent}=c.id
        WHERE r.action='COPY' AND c.depth<128 AND NOT r.source_${table.parent}=ANY(c.visited))
        SELECT c.id FROM chain c JOIN public.${table.translations} t ON t.${table.parent}=c.id AND t.locale='en' AND t.source_hash=$2 ORDER BY c.depth LIMIT 1`,
            [snapshot.revisionId, audit.translatedFromSourceHash],
          );
          if (previous) {
            const historical = await authoring.read({
              schemaVersion: 1,
              action: "READ",
              target: target.owner,
              revisionId: String(previous["id"]),
            });
            if (historical.outcome !== "SUCCESS")
              return baseContentFailure("CONTENT_UNAVAILABLE");
            const checked = assertTranslationSnapshot(historical.snapshot, {
              owner: target.owner,
              revisionId: String(previous["id"]),
            });
            const text = baseContentTextSchema.parse({
              kind: checked.content.kind,
              fields: checked.content.translations.find(
                (row) => row.locale === "en",
              )!.fields,
            });
            if (
              computeBaseContentTextHash(text) !==
              audit.translatedFromSourceHash
            )
              return baseContentFailure("CONTENT_UNAVAILABLE");
            previousEnglish = {
              revisionId: checked.revisionId,
              sourceHash: audit.translatedFromSourceHash,
              text,
            };
          }
        }
        const [owner] = table.ownerTable
          ? await draftRows(
              client,
              `SELECT to_jsonb(o.*) AS value FROM public.${table.ownerTable} o WHERE ${table.ownerKey}=$1`,
              [ownerValue(target.owner)],
            )
          : [];
        const value = owner?.["value"] as Record<string, unknown> | undefined;
        return translationWorkspaceContextResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          context: {
            schemaVersion: 1,
            snapshot,
            previousEnglish,
            ownerArchived:
              value?.["status"] === "archived" ||
              value?.["processing_status"] === "ARCHIVED",
          },
        });
      }),
  };
}
