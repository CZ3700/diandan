/// <reference types="node" />
import { randomUUID } from "node:crypto";
import {
  translationTransferRequestSchema,
  translationTransferResponseSchema,
  translationExportReceiptResponseSchema,
  contentAuthoringReadResponseSchema,
  contentAuthoringWriteCommandSchema,
  adminMutationResponseSchema,
  sourceHashSchema,
  type TranslationTransferResponse,
  type TranslationTransferTarget,
  type TranslationExportReceipt,
} from "@fan-support/contracts";
import {
  assertTranslationSnapshot,
  buildTranslationTransferPackage,
  prepareTranslationImport,
  translationCopyLocales,
  orderedTranslationLocales,
  computeBaseContentTextHash,
} from "@fan-support/content";
import type {
  TranslationTransferTransactionManager,
  TranslationTransferRepositories,
  JsonValue,
} from "@fan-support/persistence-port";
import { validateAdminContentTokenPepper } from "./admin-content-tokens.js";
import {
  adminContentFailure,
  adminContentErrorResult,
  rejectAdminContent,
  requireAdminSuccess,
} from "./admin-content-results.js";
import {
  authorizeTranslation,
  translationAuthorization,
} from "./translation-authorization.js";
import {
  beginTranslationTransferIdempotency,
  completeTranslationTransferIdempotency,
} from "./translation-transfer-idempotency.js";
export type TranslationTransferUseCases = Readonly<{
  execute(input: unknown): Promise<TranslationTransferResponse>;
}>;
async function snapshotFor(
  repositories: TranslationTransferRepositories,
  target: TranslationTransferTarget,
) {
  const result = requireAdminSuccess(
    contentAuthoringReadResponseSchema.parse(
      await repositories.contentAuthoring.read({
        schemaVersion: 1,
        action: "READ",
        target: target.owner,
        revisionId: target.revisionId,
      }),
    ),
  );
  return assertTranslationSnapshot(result.snapshot, target);
}
async function receiptFor(
  repositories: TranslationTransferRepositories,
  id: string,
) {
  const { receipt } = requireAdminSuccess(
    translationExportReceiptResponseSchema.parse(
      await repositories.translationTransfers.readExport({
        schemaVersion: 1,
        id,
      }),
    ),
  );
  if (receipt.id.toLowerCase() !== id.toLowerCase())
    rejectAdminContent("CONTENT_UNAVAILABLE");
  return receipt;
}
export function createTranslationTransferUseCases(dependencies: {
  transactions: TranslationTransferTransactionManager;
  tokenPepper: string;
}): TranslationTransferUseCases {
  if (
    !dependencies ||
    typeof dependencies.transactions?.runInTranslationTransferTransaction !==
      "function"
  )
    throw new TypeError("Invalid translation transfer configuration");
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  return {
    async execute(input) {
      const parsed = translationTransferRequestSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      try {
        const request = parsed.data,
          authorization = translationAuthorization(
            request,
            dependencies.tokenPepper,
          );
        const result =
          await dependencies.transactions.runInTranslationTransferTransaction(
            async (repositories) => {
              const { command } = request,
                permission =
                  command.action === "EXPORT" ? "content.read" : "content.edit";
              let principal = (await authorizeTranslation(
                repositories.authorization,
                authorization,
                permission,
                command.action === "EXPORT"
                  ? orderedTranslationLocales(command.locales)
                  : [],
              ))!;
              const receipt =
                command.action === "IMPORT"
                  ? await receiptFor(repositories, command.package.packageId)
                  : null;
              const source = await snapshotFor(
                repositories,
                command.action === "EXPORT" ? command.target : receipt!.target,
              );
              if (receipt !== null)
                principal = (await authorizeTranslation(
                  repositories.authorization,
                  authorization,
                  permission,
                  translationCopyLocales(source, receipt.locales),
                  principal,
                ))!;
              const reservation = await beginTranslationTransferIdempotency(
                repositories.idempotency,
                command,
                principal,
              );
              if (command.action === "EXPORT") {
                let exported: TranslationExportReceipt;
                if (reservation.replay)
                  exported = await receiptFor(
                    repositories,
                    reservation.replay.resultId,
                  );
                else {
                  const english = source.content.translations.find(
                    (row) => row.locale === "en",
                  )!;
                  const englishHash = computeBaseContentTextHash({
                    kind: source.content.kind,
                    fields: english.fields,
                  } as Parameters<typeof computeBaseContentTextHash>[0]);
                  exported = requireAdminSuccess(
                    translationExportReceiptResponseSchema.parse(
                      await repositories.translationTransfers.createExport({
                        schemaVersion: 1,
                        receipt: {
                          schemaVersion: 1,
                          target: command.target,
                          authoringHeadVersion: source.headVersion,
                          sourceSnapshotHash: source.contentHash,
                          englishSourceHash:
                            sourceHashSchema.parse(englishHash),
                          locales: orderedTranslationLocales(command.locales),
                          actorId: principal.actorId,
                          sessionId: principal.sessionId,
                        },
                        reasonCode: command.reasonCode,
                        requestId: request.requestId,
                      }),
                    ),
                  ).receipt;
                  if (
                    exported.actorId !== principal.actorId ||
                    exported.sessionId !== principal.sessionId ||
                    exported.sourceSnapshotHash !== source.contentHash ||
                    exported.authoringHeadVersion !== source.headVersion ||
                    exported.locales.join() !==
                      orderedTranslationLocales(command.locales).join()
                  )
                    rejectAdminContent("CONTENT_UNAVAILABLE");
                }
                if (
                  exported.actorId.toLowerCase() !==
                    principal.actorId.toLowerCase() ||
                  exported.locales.join() !==
                    orderedTranslationLocales(command.locales).join()
                )
                  rejectAdminContent("CONTENT_UNAVAILABLE");
                const packet = buildTranslationTransferPackage(
                  source,
                  exported,
                );
                if (!reservation.replay)
                  await completeTranslationTransferIdempotency(
                    repositories.idempotency,
                    reservation,
                    exported.id,
                  );
                return JSON.parse(
                  JSON.stringify({
                    schemaVersion: 1,
                    outcome: "SUCCESS",
                    kind: "TRANSLATION_EXPORT",
                    package: packet,
                    replayed: reservation.replay !== undefined,
                  }),
                ) as JsonValue;
              }
              if (reservation.replay) return reservation.replay as JsonValue;
              const batchId = randomUUID();
              let copy;
              try {
                copy = prepareTranslationImport(
                  command.package,
                  source,
                  receipt!,
                  batchId,
                  command,
                );
              } catch (error) {
                rejectAdminContent(
                  error instanceof Error && error.message === "STALE_VERSION"
                    ? "STALE_VERSION"
                    : error instanceof Error &&
                        error.message === "STALE_CONTENT"
                      ? "STALE_CONTENT"
                      : "INVALID_CONTENT",
                );
              }
              const written = requireAdminSuccess(
                adminMutationResponseSchema.parse(
                  await repositories.contentAuthoring.write(
                    contentAuthoringWriteCommandSchema.parse({
                      schemaVersion: 1,
                      command: copy,
                      actorId: principal.actorId,
                      requestId: request.requestId,
                    }),
                  ),
                ),
              );
              if (written.replayed) rejectAdminContent("CONTENT_UNAVAILABLE");
              const recorded = requireAdminSuccess(
                adminMutationResponseSchema.parse(
                  await repositories.translationTransfers.recordImport({
                    schemaVersion: 1,
                    id: batchId,
                    exportReceiptId: receipt!.id,
                    revisionId: written.resultId,
                    actorId: principal.actorId,
                    sessionId: principal.sessionId,
                    requestId: request.requestId,
                  }),
                ),
              );
              if (
                recorded.resultId.toLowerCase() !==
                  written.resultId.toLowerCase() ||
                recorded.replayed
              )
                rejectAdminContent("CONTENT_UNAVAILABLE");
              return (await completeTranslationTransferIdempotency(
                repositories.idempotency,
                reservation,
                written.resultId,
              )) as JsonValue;
            },
          );
        return translationTransferResponseSchema.parse(result);
      } catch (error) {
        return adminContentErrorResult(error);
      }
    },
  };
}
