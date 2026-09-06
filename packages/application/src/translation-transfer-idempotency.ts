/// <reference types="node" />
import { createHash } from "node:crypto";
import {
  persistencePortResponseSchema,
  adminMutationResponseSchema,
  type AdminPrincipal,
  type TranslationTransferCommand,
} from "@fan-support/contracts";
import { canonicalTranslationValue } from "@fan-support/content";
import type { IdempotencyRepository } from "@fan-support/persistence-port";
import type { AdminContentIdempotency } from "./admin-content-idempotency.js";
import { rejectAdminContent } from "./admin-content-results.js";
import { completeContentAuthoringIdempotency } from "./content-authoring-idempotency.js";
export const completeTranslationTransferIdempotency =
  completeContentAuthoringIdempotency;
export async function beginTranslationTransferIdempotency(
  repository: IdempotencyRepository,
  command: TranslationTransferCommand,
  principal: AdminPrincipal,
): Promise<AdminContentIdempotency> {
  const identity = {
    schemaVersion: 1 as const,
    actor: `actor-ref:v1:admin:${principal.actorId.toLowerCase()}`,
    idempotencyOperation:
      command.action === "EXPORT"
        ? "content.translation.export"
        : "content.translation.import",
    idempotencyKey: command.idempotencyKey,
    canonicalRequestHash: createHash("sha256")
      .update(
        canonicalTranslationValue({
          purpose: "translation-transfer-command-v1",
          command,
        }),
      )
      .digest("hex"),
  };
  const response = persistencePortResponseSchema.parse(
    await repository.begin({
      ...identity,
      operation: "BEGIN_IDEMPOTENCY",
      expiresAt: new Date(
        Date.parse(principal.authorizedAt) + 86_400_000,
      ).toISOString(),
    }),
  );
  if (response.outcome === "FAILURE")
    rejectAdminContent(
      response.error.code === "TRANSACTION_ABORTED" ||
        response.error.code === "VERSION_CONFLICT"
        ? "CONFLICT"
        : response.error.code === "IDEMPOTENCY_CONFLICT"
          ? "IDEMPOTENCY_CONFLICT"
          : "CONTENT_UNAVAILABLE",
    );
  if (response.operation !== "BEGIN_IDEMPOTENCY")
    rejectAdminContent("CONTENT_UNAVAILABLE");
  if (response.value.decision === "IN_PROGRESS") rejectAdminContent("CONFLICT");
  if (response.value.decision === "CONFLICT")
    rejectAdminContent("IDEMPOTENCY_CONFLICT");
  if (response.value.decision === "STARTED") return { identity };
  const prefix = "result-ref:v1:";
  if (!response.value.safeResultReference.startsWith(prefix))
    rejectAdminContent("CONTENT_UNAVAILABLE");
  const replay = adminMutationResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MUTATION",
    resultId: response.value.safeResultReference.slice(prefix.length),
    replayed: true,
  });
  if (replay.outcome !== "SUCCESS") rejectAdminContent("CONTENT_UNAVAILABLE");
  return { identity, replay };
}
