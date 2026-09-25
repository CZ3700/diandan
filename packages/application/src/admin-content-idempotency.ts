import {
  adminMutationResponseSchema,
  persistencePortResponseSchema,
  type AdminContentCommand,
  type AdminMutationResponse,
  type AdminPrincipal,
  type BeginIdempotencyCommand,
} from "@fan-support/contracts";
import { computeTranslationContentHash } from "@fan-support/content";
import type { IdempotencyRepository } from "@fan-support/persistence-port";
import { rejectAdminContent } from "./admin-content-results.js";

export type IdempotentAdminContentCommand = Extract<
  AdminContentCommand,
  { idempotencyKey: string }
>;
type MutationSuccess = Extract<AdminMutationResponse, { outcome: "SUCCESS" }>;
export type AdminContentIdempotency = Readonly<{
  identity: Omit<BeginIdempotencyCommand, "operation" | "expiresAt">;
  replay?: MutationSuccess;
}>;

const operationByAction = {
  CREATE_IDOL_ALIASES: "content.idol-aliases.create",
  CREATE_GIFT_DETAILS: "content.gift-details.create",
  SUBMIT_REVIEW: "content.review.submit",
  APPROVE_REVIEW: "content.review.approve",
  REVOKE_PREVIEW: "content.preview.revoke",
} as const;

export async function beginAdminContentIdempotency(
  repository: IdempotencyRepository,
  command: IdempotentAdminContentCommand,
  principal: AdminPrincipal,
): Promise<AdminContentIdempotency> {
  const identity = {
    schemaVersion: 1 as const,
    actor: `actor-ref:v1:admin:${principal.actorId.toLowerCase()}`,
    idempotencyOperation: operationByAction[command.action],
    idempotencyKey: command.idempotencyKey,
    canonicalRequestHash: computeTranslationContentHash(
      "admin-content-command-v1",
      command,
    ),
  };
  const result = persistencePortResponseSchema.parse(
    await repository.begin({
      ...identity,
      operation: "BEGIN_IDEMPOTENCY",
      expiresAt: new Date(
        Date.parse(principal.authorizedAt) + 86_400_000,
      ).toISOString(),
    }),
  );
  if (
    result.operation !== "BEGIN_IDEMPOTENCY" ||
    result.outcome !== "SUCCESS"
  ) {
    rejectAdminContent("CONTENT_UNAVAILABLE");
  }
  switch (result.value.decision) {
    case "STARTED":
      return { identity };
    case "IN_PROGRESS":
      return rejectAdminContent("CONFLICT");
    case "CONFLICT":
      return rejectAdminContent("IDEMPOTENCY_CONFLICT");
    case "REPLAY": {
      const prefix = "result-ref:v1:";
      if (!result.value.safeResultReference.startsWith(prefix)) {
        rejectAdminContent("CONTENT_UNAVAILABLE");
      }
      const response = adminMutationResponseSchema.parse({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "MUTATION",
        resultId: result.value.safeResultReference.slice(prefix.length),
        replayed: true,
      });
      if (response.outcome !== "SUCCESS")
        rejectAdminContent("CONTENT_UNAVAILABLE");
      return { identity, replay: response };
    }
  }
}

export async function completeAdminContentIdempotency(
  repository: IdempotencyRepository,
  reservation: AdminContentIdempotency,
  resultId: string,
): Promise<MutationSuccess> {
  const result = persistencePortResponseSchema.parse(
    await repository.complete({
      ...reservation.identity,
      operation: "COMPLETE_IDEMPOTENCY",
      status: "SUCCEEDED",
      safeResultReference: `result-ref:v1:${resultId.toLowerCase()}`,
    }),
  );
  if (
    result.operation !== "COMPLETE_IDEMPOTENCY" ||
    result.outcome !== "SUCCESS"
  )
    rejectAdminContent("CONTENT_UNAVAILABLE");
  return {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MUTATION",
    resultId,
    replayed: false,
  };
}
