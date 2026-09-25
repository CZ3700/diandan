/// <reference types="node" />
import { createHash } from "node:crypto";
import {
  adminMutationResponseSchema,
  persistencePortResponseSchema,
  type AdminPrincipal,
  type AdminResourceCommand,
  type PersistencePortError,
} from "@fan-support/contracts";
import type { IdempotencyRepository } from "@fan-support/persistence-port";
import type { AdminContentIdempotency } from "./admin-content-idempotency.js";
import { rejectAdminContent } from "./admin-content-results.js";
import { addBaseContentSeconds } from "./base-content-time.js";

const operations = {
  REGISTER_POLICY: "content.resource.policy.register",
  BEGIN_UPLOAD: "content.resource.upload.begin",
  COMPLETE_UPLOAD: "content.resource.upload.complete",
  SET_MEDIA_RIGHTS: "content.resource.media.rights",
  ENQUEUE_MEDIA: "content.resource.media.enqueue",
  RETRY_MEDIA_JOB: "content.resource.media.retry",
} as const;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
function rejectPersistenceFailure(error: PersistencePortError): never {
  if (error.code === "TRANSACTION_ABORTED" || error.code === "VERSION_CONFLICT")
    rejectAdminContent("CONFLICT");
  if (error.code === "IDEMPOTENCY_CONFLICT")
    rejectAdminContent("IDEMPOTENCY_CONFLICT");
  return rejectAdminContent("CONTENT_UNAVAILABLE");
}
export async function beginResourceIdempotency(
  repository: IdempotencyRepository,
  command: Extract<AdminResourceCommand, { idempotencyKey: string }>,
  principal: AdminPrincipal,
): Promise<AdminContentIdempotency> {
  const identity = {
    schemaVersion: 1 as const,
    actor: `actor-ref:v1:admin:${principal.actorId.toLowerCase()}`,
    idempotencyOperation: operations[command.action],
    idempotencyKey: command.idempotencyKey,
    canonicalRequestHash: createHash("sha256")
      .update(
        JSON.stringify(
          canonical({ purpose: "resource-management-command-v1", command }),
        ),
        "utf8",
      )
      .digest("hex"),
  };
  const result = persistencePortResponseSchema.parse(
    await repository.begin({
      ...identity,
      operation: "BEGIN_IDEMPOTENCY",
      expiresAt: addBaseContentSeconds(principal.authorizedAt, 86_400),
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
      const replay = adminMutationResponseSchema.parse({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "MUTATION",
        resultId: result.value.safeResultReference.slice(prefix.length),
        replayed: true,
      });
      if (replay.outcome !== "SUCCESS")
        rejectAdminContent("CONTENT_UNAVAILABLE");
      return { identity, replay };
    }
  }
}
export async function completeResourceIdempotency(
  repository: IdempotencyRepository,
  reservation: AdminContentIdempotency,
  resultId: string,
) {
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
    schemaVersion: 1 as const,
    outcome: "SUCCESS" as const,
    kind: "MUTATION" as const,
    resultId,
    replayed: false,
  };
}
