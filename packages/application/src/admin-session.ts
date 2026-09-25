import {
  adminSessionRequestSchema,
  adminSessionReadCommandSchema,
  adminSessionResponseSchema,
  type AdminSessionResponse,
} from "@fan-support/contracts";
import type {
  AdminSessionTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";
import {
  adminContentErrorResult,
  adminContentFailure,
} from "./admin-content-results.js";

export type AdminSessionDependencies = Readonly<{
  transactions: AdminSessionTransactionManager;
  tokenPepper: string;
}>;
export type AdminSessionUseCases = Readonly<{
  execute(input: unknown): Promise<AdminSessionResponse>;
}>;
/** Session discovery is an observation; every later command must authorize independently. */
export function createAdminSessionUseCases(
  dependencies: AdminSessionDependencies,
): AdminSessionUseCases {
  if (
    !dependencies ||
    typeof dependencies.transactions?.runInAdminSessionTransaction !==
      "function"
  )
    throw new TypeError("Invalid admin session configuration");
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  return Object.freeze({
    async execute(input: unknown): Promise<AdminSessionResponse> {
      const parsed = adminSessionRequestSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      try {
        const command = adminSessionReadCommandSchema.parse({
          schemaVersion: 1,
          sessionTokenDigest: digestAdminContentToken({
            tokenPepper: dependencies.tokenPepper,
            purpose: "admin-session",
            token: parsed.data.sessionToken,
          }),
          csrfTokenDigest: digestAdminContentToken({
            tokenPepper: dependencies.tokenPepper,
            purpose: "admin-csrf",
            token: parsed.data.csrfToken,
          }),
        });
        const response =
          await dependencies.transactions.runInAdminSessionTransaction(
            async ({ adminSession }) =>
              JSON.parse(
                JSON.stringify(
                  adminSessionResponseSchema.parse(
                    await adminSession.read(command),
                  ),
                ),
              ) as JsonValue,
          );
        return adminSessionResponseSchema.parse(response);
      } catch (error) {
        return adminContentErrorResult(error);
      }
    },
  });
}
