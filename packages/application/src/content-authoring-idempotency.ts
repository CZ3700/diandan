/// <reference types="node" />
import { createHash } from "node:crypto";
import {
  adminMutationResponseSchema,
  persistencePortResponseSchema,
  type AdminPrincipal,
  type AdminMutationResponse,
  type ContentAuthoringCommand,
  type PersistencePortError,
} from "@fan-support/contracts";
import type { IdempotencyRepository } from "@fan-support/persistence-port";
import type { AdminContentIdempotency } from "./admin-content-idempotency.js";
import { rejectAdminContent } from "./admin-content-results.js";

function canonicalCommand(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalCommand);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalCommand(item)]),
    );
  // Raw text changes can invalidate exact inherited review evidence, even when
  // their normalized content hashes match. Idempotency must retain that choice.
  return value;
}

function rejectPersistenceFailure(error: PersistencePortError): never {
  if (error.code === "TRANSACTION_ABORTED" || error.code === "VERSION_CONFLICT")
    rejectAdminContent("CONFLICT");
  if (error.code === "IDEMPOTENCY_CONFLICT")
    rejectAdminContent("IDEMPOTENCY_CONFLICT");
  return rejectAdminContent("CONTENT_UNAVAILABLE");
}

export async function beginContentAuthoringIdempotency(
  repository: IdempotencyRepository,
  command: Extract<ContentAuthoringCommand, { action: "CREATE" | "COPY" }>,
  principal: AdminPrincipal,
): Promise<AdminContentIdempotency> {
  const identity = {
    schemaVersion: 1 as const,
    actor: `actor-ref:v1:admin:${principal.actorId.toLowerCase()}`,
    idempotencyOperation:
      command.action === "CREATE"
        ? "content.authoring.create"
        : "content.authoring.copy",
    idempotencyKey: command.idempotencyKey,
    canonicalRequestHash: createHash("sha256")
      .update(
        JSON.stringify(
          canonicalCommand({
            purpose: "content-authoring-command-v1",
            command,
          }),
        ),
        "utf8",
      )
      .digest("hex"),
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
  if (result.outcome === "FAILURE") rejectPersistenceFailure(result.error);
  if (result.operation !== "BEGIN_IDEMPOTENCY")
    rejectAdminContent("CONTENT_UNAVAILABLE");
  switch (result.value.decision) {
    case "STARTED":
      return { identity };
    case "IN_PROGRESS":
      return rejectAdminContent("CONFLICT");
    case "CONFLICT":
      return rejectAdminContent("IDEMPOTENCY_CONFLICT");
    case "REPLAY": {
      const prefix = "result-ref:v1:";
      if (!result.value.safeResultReference.startsWith(prefix))
        rejectAdminContent("CONTENT_UNAVAILABLE");
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

export async function completeContentAuthoringIdempotency(
  repository: IdempotencyRepository,
  reservation: AdminContentIdempotency,
  resultId: string,
): Promise<Extract<AdminMutationResponse, { outcome: "SUCCESS" }>> {
  const result = persistencePortResponseSchema.parse(
    await repository.complete({
      ...reservation.identity,
      operation: "COMPLETE_IDEMPOTENCY",
      status: "SUCCEEDED",
      safeResultReference: `result-ref:v1:${resultId.toLowerCase()}`,
    }),
  );
  if (result.outcome === "FAILURE") rejectPersistenceFailure(result.error);
  if (result.operation !== "COMPLETE_IDEMPOTENCY")
    rejectAdminContent("CONTENT_UNAVAILABLE");
  return {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MUTATION",
    resultId,
    replayed: false,
  };
}
