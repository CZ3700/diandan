import {
  persistencePortResponseSchema,
  publicationRuntimeResponseSchema,
  type BeginIdempotencyCommand,
  type AdminPrincipal,
  type PublicationRuntimeCommand,
  type PublicationRuntimeResponse,
} from "@fan-support/contracts";
import {
  computeTranslationContentHash,
  sameBaseContentTarget,
} from "@fan-support/content";
import type { PublicationRuntimeRepositories } from "@fan-support/persistence-port";
import { rejectAdminContent } from "./admin-content-results.js";
import { addBaseContentSeconds } from "./base-content-time.js";

export type PublicationMutationCommand = Exclude<
  PublicationRuntimeCommand,
  { action: "STATUS" }
>;
type Identity = Omit<BeginIdempotencyCommand, "operation" | "expiresAt">;
export function assertPublicationReceipt(
  command: PublicationMutationCommand,
  result: PublicationRuntimeResponse,
): asserts result is Extract<
  PublicationRuntimeResponse,
  { outcome: "SUCCESS"; kind: "PUBLICATION_MUTATION" | "PURGE_RETRY" }
> {
  if (result.outcome !== "SUCCESS") rejectAdminContent("CONTENT_UNAVAILABLE");
  if (command.action === "RETRY_PURGE") {
    if (
      result.kind !== "PURGE_RETRY" ||
      result.publicationId.toLowerCase() !==
        command.publicationId.toLowerCase() ||
      result.purgeJobId.toLowerCase() === command.purgeJobId.toLowerCase()
    )
      rejectAdminContent("CONTENT_UNAVAILABLE");
  } else if (
    result.kind !== "PUBLICATION_MUTATION" ||
    result.action !== command.action ||
    !sameBaseContentTarget(
      { ...result.target, locale: "en" },
      { ...command.target, locale: "en" },
    ) ||
    result.headVersion !==
      command.expectedVersion + (command.action === "VALIDATE" ? 0 : 1)
  )
    rejectAdminContent("CONTENT_UNAVAILABLE");
}
export async function beginPublicationIdempotency(
  repositories: PublicationRuntimeRepositories,
  command: PublicationMutationCommand,
  principal: AdminPrincipal,
): Promise<{ identity: Identity; replay?: PublicationRuntimeResponse }> {
  const identity: Identity = {
    schemaVersion: 1,
    actor: `actor-ref:v1:admin:${principal.actorId.toLowerCase()}`,
    idempotencyOperation: `content.publication.${command.action.toLowerCase().replaceAll("_", "-")}`,
    idempotencyKey: command.idempotencyKey,
    canonicalRequestHash: computeTranslationContentHash(
      "publication-runtime-command-v1",
      command,
    ),
  };
  const response = persistencePortResponseSchema.parse(
    await repositories.idempotency.begin({
      ...identity,
      operation: "BEGIN_IDEMPOTENCY",
      expiresAt: addBaseContentSeconds(principal.authorizedAt, 86400),
    }),
  );
  if (response.operation !== "BEGIN_IDEMPOTENCY")
    rejectAdminContent("CONTENT_UNAVAILABLE");
  if (response.outcome === "FAILURE")
    rejectPublicationPersistenceFailure(response.error.code);
  switch (response.value.decision) {
    case "STARTED":
      return { identity };
    case "IN_PROGRESS":
      return rejectAdminContent("CONFLICT");
    case "CONFLICT":
      return rejectAdminContent("IDEMPOTENCY_CONFLICT");
    case "REPLAY": {
      const match = /^result-ref:v1:([0-9a-f-]{36})$/iu.exec(
        response.value.safeResultReference,
      );
      if (!match?.[1]) rejectAdminContent("CONTENT_UNAVAILABLE");
      const receipt = publicationRuntimeResponseSchema.parse(
        await repositories.publicationRuntime.readReceipt({
          schemaVersion: 1,
          resultId: match[1],
          actorId: principal.actorId,
        }),
      );
      assertPublicationReceipt(command, receipt);
      if (receipt.resultId.toLowerCase() !== match[1].toLowerCase())
        rejectAdminContent("CONTENT_UNAVAILABLE");
      return { identity, replay: { ...receipt, replayed: true } };
    }
  }
}
export async function completePublicationIdempotency(
  repositories: PublicationRuntimeRepositories,
  identity: Identity,
  resultId: string,
): Promise<void> {
  const response = persistencePortResponseSchema.parse(
    await repositories.idempotency.complete({
      ...identity,
      operation: "COMPLETE_IDEMPOTENCY",
      status: "SUCCEEDED",
      safeResultReference: `result-ref:v1:${resultId.toLowerCase()}`,
    }),
  );
  if (response.operation !== "COMPLETE_IDEMPOTENCY")
    rejectAdminContent("CONTENT_UNAVAILABLE");
  if (response.outcome === "FAILURE")
    rejectPublicationPersistenceFailure(response.error.code);
}

function rejectPublicationPersistenceFailure(code: string): never {
  if (code === "TRANSACTION_ABORTED" || code === "VERSION_CONFLICT")
    rejectAdminContent("CONFLICT");
  return rejectAdminContent("CONTENT_UNAVAILABLE");
}
