import { createHmac } from "node:crypto";
import {
  adminExceptionsRequestSchema,
  adminExceptionsResponseSchema,
  adminExceptionsResponseMatches,
  adminExceptionsStoreRequestSchema,
  type AdminExceptionsResponse,
} from "@fan-support/contracts";
import type { AdminExceptionsTransactionManager } from "@fan-support/persistence-port";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";

export type AdminExceptionsDependencies = Readonly<{
  transactions: AdminExceptionsTransactionManager;
  tokenPepper: string;
}>;

/** Commands persist authorization and their receipt before worker-owned recovery. */
export function createAdminExceptionsUseCases(
  dependencies: AdminExceptionsDependencies,
) {
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  if (
    typeof dependencies.transactions?.runInAdminExceptionsTransaction !==
    "function"
  )
    throw new TypeError("Invalid exception transactions");
  const failure = (
    code: "INVALID_COMMAND" | "TEMPORARY_UNAVAILABLE",
  ): AdminExceptionsResponse => ({
    schemaVersion: 1,
    outcome: "FAILURE",
    code,
  });
  return Object.freeze({
    async execute(input: unknown): Promise<AdminExceptionsResponse> {
      const parsed = adminExceptionsRequestSchema.safeParse(input);
      if (!parsed.success) return failure("INVALID_COMMAND");
      try {
        const request = parsed.data;
        const digest = (
          purpose: "admin-session" | "admin-csrf",
          token: string,
        ) =>
          digestAdminContentToken({
            tokenPepper: dependencies.tokenPepper,
            purpose,
            token,
          });
        const store = adminExceptionsStoreRequestSchema.parse({
          schemaVersion: 1,
          access: {
            schemaVersion: 1,
            requestId: request.requestId,
            correlationId: request.requestId,
            sessionTokenDigest: digest("admin-session", request.sessionToken),
            csrfTokenDigest: digest("admin-csrf", request.csrfToken),
          },
          command: request.command,
          requestHash:
            "idempotencyKey" in request.command
              ? createHmac(
                  "sha256",
                  Buffer.from(dependencies.tokenPepper, "hex"),
                )
                  .update("fan-support:admin-exceptions:v1:")
                  .update(JSON.stringify(request.command))
                  .digest("hex")
              : null,
        });
        const response = adminExceptionsResponseSchema.parse(
          await dependencies.transactions.runInAdminExceptionsTransaction(
            (repository) => repository.execute(store),
          ),
        );
        return adminExceptionsResponseMatches(request.command, response)
          ? response
          : failure("TEMPORARY_UNAVAILABLE");
      } catch {
        return failure("TEMPORARY_UNAVAILABLE");
      }
    },
  });
}
export type AdminExceptionsUseCases = ReturnType<
  typeof createAdminExceptionsUseCases
>;
