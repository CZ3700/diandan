import {
  adminContentFailureSchema,
  type AdminContentFailure,
  type ContentDraftFailure,
} from "@fan-support/contracts";
import { parsePersistenceTransactionFailure } from "@fan-support/persistence-port";

export function adminContentFailure(
  code: AdminContentFailure["code"],
): AdminContentFailure {
  return { schemaVersion: 1, outcome: "FAILURE", code };
}

/** Rejecting the callback rolls back the idempotency reservation and all writes. */
export class AdminContentCommandRejected extends Error {
  constructor(readonly failure: AdminContentFailure) {
    super("admin content command rejected");
    this.name = "AdminContentCommandRejected";
  }
}

export function rejectAdminContent(code: AdminContentFailure["code"]): never {
  throw new AdminContentCommandRejected(adminContentFailure(code));
}

export function requireAdminSuccess<
  Response extends
    { outcome: "SUCCESS" } | AdminContentFailure | ContentDraftFailure,
>(response: Response): Extract<Response, { outcome: "SUCCESS" }> {
  if (response.outcome === "SUCCESS")
    return response as Extract<Response, { outcome: "SUCCESS" }>;
  if (response.code === "ACTOR_UNAVAILABLE") {
    rejectAdminContent("UNAUTHENTICATED");
  }
  const parsed = adminContentFailureSchema.safeParse(response);
  throw new AdminContentCommandRejected(
    parsed.success ? parsed.data : adminContentFailure("CONTENT_UNAVAILABLE"),
  );
}

export function adminContentErrorResult(error: unknown): AdminContentFailure {
  if (error instanceof AdminContentCommandRejected) return error.failure;
  const persistence = parsePersistenceTransactionFailure(error);
  if (
    persistence?.error.code === "TRANSACTION_ABORTED" ||
    persistence?.error.code === "VERSION_CONFLICT"
  ) {
    return adminContentFailure("CONFLICT");
  }
  return adminContentFailure("CONTENT_UNAVAILABLE");
}
