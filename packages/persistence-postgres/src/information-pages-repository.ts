import { randomUUID } from "node:crypto";
import {
  INFORMATION_PAGE_KEYS,
  SUPPORTED_LOCALES,
  informationPageCommandSchema,
  informationPageResponseSchema,
  informationPagePreviewDocumentSchema,
  publicInformationPageResponseSchema,
  publicInformationPageIndexResponseSchema,
  validInformationPageDocument,
  type InformationPageResponse,
  type PublicInformationPageRequest,
  type PublicInformationPageResponse,
} from "@fan-support/contracts";
import type { InformationPageRepository } from "@fan-support/persistence-port";
import {
  draftRows,
  draftTimestamp,
  type DraftRow,
} from "./content-draft-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";
import {
  informationPageHash,
  fieldsFromRow,
  informationPagePublication,
  loadInformationRevision,
} from "./information-pages-data.js";
import {
  informationWorkspace,
  informationTranslationApproved,
  informationTranslationCurrent,
} from "./information-pages-workspace.js";
const failure = (
  code: Extract<InformationPageResponse, { outcome: "FAILURE" }>["code"],
): InformationPageResponse => ({ schemaVersion: 1, outcome: "FAILURE", code });
const same = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
export function createInformationPageRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): InformationPageRepository {
  const run = <T>(work: () => Promise<T>) =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  const readPublished = async (
    input: PublicInformationPageRequest,
  ): Promise<PublicInformationPageResponse> => {
    const [head] = await draftRows(
      client,
      "SELECT published_publication_id FROM public.information_page_heads WHERE page_key=$1 FOR SHARE",
      [input.pageKey],
    );
    if (!head) throw new Error("Missing information head");
    if (!head["published_publication_id"])
      return { schemaVersion: 1, outcome: "FAILURE", code: "NOT_FOUND" };
    const [publication] = await draftRows(
      client,
      "SELECT * FROM public.information_page_publications WHERE id=$1",
      [head["published_publication_id"]],
    );
    if (!publication) throw new Error("Missing publication");
    const revision = await loadInformationRevision(
      client,
      String(publication["revision_id"]),
    );
    const english = revision.translations.find((r) => r["locale"] === "en");
    if (
      !english ||
      revision.sourceHash !==
        informationPageHash({
          pageKey: revision.pageKey,
          structure: revision.structure,
          englishFields: fieldsFromRow(english),
        })
    )
      return {
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CONTENT_UNAVAILABLE",
      };
    const availableLocales = SUPPORTED_LOCALES.filter((locale) => {
      const row = revision.translations.find((r) => r["locale"] === locale);
      return !!row && informationTranslationApproved(revision, row);
    });
    const resolvedLocale = availableLocales.includes(input.locale)
      ? input.locale
      : availableLocales.includes("en")
        ? "en"
        : null;
    if (!resolvedLocale)
      return {
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CONTENT_UNAVAILABLE",
      };
    const row = revision.translations.find(
      (r) => r["locale"] === resolvedLocale,
    )!;
    return publicInformationPageResponseSchema.parse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "INFORMATION_PAGE",
      document: informationPagePreviewDocumentSchema.parse({
        schemaVersion: 1,
        pageKey: input.pageKey,
        locale: resolvedLocale,
        revisionId: revision.id,
        structure: revision.structure,
        fields: fieldsFromRow(row),
        sourceStatus: "CURRENT",
      }),
      publicationId: publication["id"],
      publishedAt: draftTimestamp(publication["created_at"]),
      requestedLocale: input.locale,
      resolvedLocale,
      fallbackUsed: resolvedLocale !== input.locale,
      availableLocales,
    });
  };
  return {
    readPublished: (input) => run(() => readPublished(input)),
    readIndex: (input) =>
      run(async () => {
        const entries = [];
        for (const pageKey of INFORMATION_PAGE_KEYS) {
          const page = await readPublished({
            schemaVersion: 1,
            pageKey,
            locale: input.locale,
          });
          if (page.outcome === "FAILURE") {
            if (page.code === "CONTENT_UNAVAILABLE")
              return {
                schemaVersion: 1 as const,
                outcome: "FAILURE" as const,
                code: "CONTENT_UNAVAILABLE" as const,
              };
            continue;
          }
          if (!page.fallbackUsed)
            entries.push({
              pageKey,
              title: page.document.fields.title,
              publicationId: page.publicationId,
              publishedAt: page.publishedAt,
              availableLocales: page.availableLocales,
            });
        }
        return publicInformationPageIndexResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "INFORMATION_PAGE_INDEX",
          locale: input.locale,
          entries,
        });
      }),
    execute: (input) =>
      run(async () => {
        const command = informationPageCommandSchema.parse(input.command);
        if (command.action === "LIST") {
          const rows = await draftRows(
            client,
            "SELECT * FROM public.information_page_heads",
          );
          return informationPageResponseSchema.parse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            kind: "LIST",
            entries: INFORMATION_PAGE_KEYS.map((pageKey) => {
              const r = rows.find((row) => row["page_key"] === pageKey);
              if (!r) throw new Error("Missing page head");
              return {
                pageKey,
                version: Number(r["version"]),
                draftRevisionId: r["draft_revision_id"],
                publishedPublicationId: r["published_publication_id"],
              };
            }),
          });
        }
        const response = async (replayed = false) =>
          informationPageResponseSchema.parse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            kind: "STATE",
            workspace: await informationWorkspace(
              client,
              command.pageKey,
              command.locale,
              input.access,
              input.principal,
            ),
            replayed,
          });
        if (command.action === "READ") return response();
        if (command.action === "HISTORY") {
          const rows = await draftRows(
            client,
            "SELECT * FROM public.information_page_publications WHERE page_key=$1 ORDER BY version DESC LIMIT $2 OFFSET $3",
            [
              command.pageKey,
              command.pageSize + 1,
              (command.page - 1) * command.pageSize,
            ],
          );
          return informationPageResponseSchema.parse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            kind: "HISTORY",
            entries: rows
              .slice(0, command.pageSize)
              .map(informationPagePublication),
            page: command.page,
            pageSize: command.pageSize,
            hasMore: rows.length > command.pageSize,
          });
        }
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [
            `information-page:${input.principal.actorId}:${command.action}:${command.idempotencyKey}`,
          ],
        );
        const [prior] = await draftRows(
          client,
          "SELECT request_hash,response FROM public.information_page_receipts WHERE actor_id=$1 AND action=$2 AND idempotency_key=$3",
          [input.principal.actorId, command.action, command.idempotencyKey],
        );
        if (prior) {
          if (prior["request_hash"] !== input.requestHash)
            return failure("IDEMPOTENCY_CONFLICT");
          const saved = informationPageResponseSchema.parse(prior["response"]);
          if (saved.outcome !== "SUCCESS" || saved.kind !== "STATE")
            throw new Error("Invalid information receipt");
          return {
            ...saved,
            replayed: true,
            workspace: {
              ...saved.workspace,
              cells: saved.workspace.cells.map((c) =>
                input.access.readLocales.includes(c.locale)
                  ? c
                  : { locale: c.locale, access: "RESTRICTED" as const },
              ),
              blockers: saved.workspace.blockers.map((b) =>
                input.access.readLocales.includes(b.locale)
                  ? b
                  : { locale: b.locale, code: "RESTRICTED" as const },
              ),
              capabilities: {
                ...saved.workspace.capabilities,
                canSave:
                  saved.workspace.capabilities.canSave &&
                  input.access.editLocales.includes(command.locale) &&
                  (command.locale !== "en" ||
                    input.access.editLocales.length === 7),
                canSubmit:
                  saved.workspace.capabilities.canSubmit &&
                  input.access.editLocales.includes(command.locale),
                canApprove:
                  saved.workspace.capabilities.canApprove &&
                  input.access.reviewLocales.includes(command.locale),
                canPublish:
                  saved.workspace.capabilities.canPublish &&
                  input.access.canPublish,
                canUnpublish:
                  saved.workspace.capabilities.canUnpublish &&
                  input.access.canPublish,
                canRestore:
                  saved.workspace.capabilities.canRestore &&
                  input.access.canPublish,
              },
              preview: input.access.canPreview ? saved.workspace.preview : null,
            },
          };
        }
        const [head] = await draftRows(
          client,
          "SELECT * FROM public.information_page_heads WHERE page_key=$1 FOR UPDATE",
          [command.pageKey],
        );
        if (!head) throw new Error("Missing information head");
        if (Number(head["version"]) !== command.expectedVersion)
          return failure("STALE_VERSION");
        const current = head["draft_revision_id"]
          ? await loadInformationRevision(
              client,
              String(head["draft_revision_id"]),
            )
          : null;
        let revisionId = current?.id ?? null;
        let publicationId: string | null = null;
        let reviewTarget: DraftRow | undefined;
        if (command.action === "SAVE_DRAFT") {
          if (
            !same(command.revisionId, current?.id ?? null) ||
            command.expectedSourceHash !== (current?.sourceHash ?? null)
          )
            return failure("STALE_CONTENT");
          const structure = command.structure ?? current?.structure;
          if (
            !structure ||
            !validInformationPageDocument({
              pageKey: command.pageKey,
              structure,
              fields: command.fields,
            })
          )
            return failure("INVALID_CONTENT");
          revisionId = randomUUID();
        } else if (
          command.action === "SUBMIT_REVIEW" ||
          command.action === "APPROVE_REVIEW"
        ) {
          if (!current || !same(command.revisionId, current.id))
            return failure("REVISION_NOT_DRAFT");
          const selected = current.translations.find(
            (r) => r["locale"] === command.locale,
          );
          if (!selected) return failure("NOT_FOUND");
          if (
            !informationTranslationCurrent(current, selected) ||
            command.expectedSourceHash !== current.sourceHash ||
            command.expectedContentHash !== selected["content_hash"]
          )
            return failure("STALE_CONTENT");
          if (
            Number(selected["review_sequence"]) !==
            command.expectedReviewSequence
          )
            return failure("STALE_VERSION");
          if (
            selected["review_status"] !==
            (command.action === "SUBMIT_REVIEW" ? "DRAFT" : "IN_REVIEW")
          )
            return failure("INVALID_REVIEW_STATE");
          if (
            command.action === "SUBMIT_REVIEW" &&
            !same(selected["editor_id"], input.principal.actorId)
          )
            return failure("FORBIDDEN");
          if (
            command.action === "APPROVE_REVIEW" &&
            (same(selected["editor_id"], input.principal.actorId) ||
              same(
                current.translations.find((r) => r["locale"] === "en")?.[
                  "editor_id"
                ],
                input.principal.actorId,
              ))
          )
            return failure("SELF_REVIEW");
          reviewTarget = selected;
        } else {
          if (command.action === "PUBLISH") {
            if (!current || !same(current.id, command.revisionId))
              return failure("REVISION_NOT_DRAFT");
            if (
              current.translations.length !== 7 ||
              !current.translations.every((r) =>
                informationTranslationApproved(current, r),
              )
            )
              return failure("INVALID_CONTENT");
          } else if (command.action === "RESTORE") {
            const [old] = await draftRows(
              client,
              "SELECT * FROM public.information_page_publications WHERE id=$1 AND page_key=$2 AND action<>'UNPUBLISH'",
              [command.publicationId, command.pageKey],
            );
            if (!old) return failure("NOT_FOUND");
            revisionId = String(old["revision_id"]);
            const restored = await loadInformationRevision(client, revisionId);
            if (
              restored.translations.length !== 7 ||
              !restored.translations.every((r) =>
                informationTranslationApproved(restored, r),
              )
            )
              return failure("INVALID_CONTENT");
          } else if (!head["published_publication_id"])
            return failure("NOT_FOUND");
          publicationId = randomUUID();
        }
        const auditId = randomUUID();
        const [instant] = await draftRows(
          client,
          "SELECT GREATEST(clock_timestamp(),$1::timestamptz) AS now",
          [head["updated_at"]],
        );
        const at = draftTimestamp(instant?.["now"]);
        await client.query(
          "INSERT INTO public.audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,request_id,correlation_id,outcome,created_at) VALUES($1,'ADMIN',$2,$3,'INFORMATION_PAGE',$4,$5,$5,'SUCCEEDED',$6)",
          [
            auditId,
            input.principal.actorId,
            `INFORMATION_PAGE_${command.action}`,
            publicationId ?? revisionId,
            input.requestId,
            at,
          ],
        );
        if (command.action === "SAVE_DRAFT") {
          const structure = command.structure ?? current!.structure;
          const englishFields =
            command.locale === "en"
              ? command.fields
              : fieldsFromRow(
                  current!.translations.find((r) => r["locale"] === "en")!,
                );
          const sourceHash = informationPageHash({
            pageKey: command.pageKey,
            structure,
            englishFields,
          });
          await client.query(
            "INSERT INTO public.information_page_revisions(id,page_key,revision,source_revision_id,structure,source_hash,actor_id,session_id,request_id,audit_log_id,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11)",
            [
              revisionId,
              command.pageKey,
              command.expectedVersion + 1,
              current?.id ?? null,
              JSON.stringify(structure),
              sourceHash,
              input.principal.actorId,
              input.principal.sessionId,
              input.requestId,
              auditId,
              at,
            ],
          );
          for (const locale of SUPPORTED_LOCALES) {
            const old = current?.translations.find(
              (r) => r["locale"] === locale,
            );
            if (locale !== command.locale && !old) continue;
            const changed = locale === command.locale;
            const fields = changed ? command.fields : fieldsFromRow(old!);
            const id = randomUUID();
            await client.query(
              "INSERT INTO public.information_page_revision_translations(id,revision_id,locale,title,summary,sections,content_hash,translated_from_source_hash,editor_id,edited_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)",
              [
                id,
                revisionId,
                locale,
                fields.title,
                fields.summary,
                JSON.stringify(fields.sections),
                informationPageHash(fields),
                changed ? sourceHash : old!["translated_from_source_hash"],
                changed ? input.principal.actorId : old!["editor_id"],
                changed ? at : old!["edited_at"],
              ],
            );
            if (changed)
              await client.query(
                "INSERT INTO public.information_page_translation_reviews(id,translation_id,sequence,status,actor_id,session_id,content_hash,source_hash,audit_log_id,created_at) VALUES($1,$2,1,'DRAFT',$3,$4,$5,$6,$7,$8)",
                [
                  randomUUID(),
                  id,
                  input.principal.actorId,
                  input.principal.sessionId,
                  informationPageHash(fields),
                  sourceHash,
                  auditId,
                  at,
                ],
              );
            else
              await client.query(
                "INSERT INTO public.information_page_translation_copy_evidence(target_translation_id,source_translation_id,audit_log_id) VALUES($1,$2,$3)",
                [id, old!["id"], auditId],
              );
          }
        } else if (
          command.action === "SUBMIT_REVIEW" ||
          command.action === "APPROVE_REVIEW"
        ) {
          if (!reviewTarget) throw new Error("Missing review");
          await client.query(
            "INSERT INTO public.information_page_translation_reviews(id,translation_id,sequence,status,actor_id,session_id,content_hash,source_hash,audit_log_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            [
              randomUUID(),
              reviewTarget["id"],
              command.expectedReviewSequence + 1,
              command.action === "SUBMIT_REVIEW" ? "IN_REVIEW" : "APPROVED",
              input.principal.actorId,
              input.principal.sessionId,
              command.expectedContentHash,
              command.expectedSourceHash,
              auditId,
              at,
            ],
          );
        } else {
          await client.query(
            "INSERT INTO public.information_page_publications(id,page_key,revision_id,version,action,restored_from_publication_id,actor_id,session_id,request_id,audit_log_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
            [
              publicationId,
              command.pageKey,
              command.action === "UNPUBLISH" ? null : revisionId,
              command.expectedVersion + 1,
              command.action,
              command.action === "RESTORE" ? command.publicationId : null,
              input.principal.actorId,
              input.principal.sessionId,
              input.requestId,
              auditId,
              at,
            ],
          );
          for (const locale of SUPPORTED_LOCALES)
            await client.query(
              "INSERT INTO public.outbox_events(id,event_type,aggregate_type,aggregate_id,aggregate_version,primary_subject_id,locale,idempotency_key,correlation_id,request_id,occurred_at,available_at,created_at) VALUES($1,'INFORMATION_PAGE_PUBLICATION_CHANGED','INFORMATION_PAGE_PUBLICATION',$2,$3,$2,$4,$5,$6,$6,$7::timestamptz,$7::timestamptz,$7::timestamptz)",
              [
                randomUUID(),
                publicationId,
                command.expectedVersion + 1,
                locale,
                `information-page:${publicationId}:${locale}`,
                input.requestId,
                at,
              ],
            );
        }
        await client.query(
          "UPDATE public.information_page_heads SET version=$1,draft_revision_id=$2,published_publication_id=$3,updated_at=$4 WHERE page_key=$5",
          [
            command.expectedVersion + 1,
            revisionId,
            command.action === "UNPUBLISH"
              ? null
              : (publicationId ?? head["published_publication_id"]),
            at,
            command.pageKey,
          ],
        );
        const result = await response();
        await client.query(
          "INSERT INTO public.information_page_receipts(id,page_key,actor_id,session_id,action,idempotency_key,request_hash,response,audit_log_id,request_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)",
          [
            randomUUID(),
            command.pageKey,
            input.principal.actorId,
            input.principal.sessionId,
            command.action,
            command.idempotencyKey,
            input.requestHash,
            JSON.stringify(result),
            auditId,
            input.requestId,
            at,
          ],
        );
        return result;
      }),
  };
}
