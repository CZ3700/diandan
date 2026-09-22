import { createHmac } from "node:crypto";
import { canonicalPublicationValue } from "@fan-support/content";
import {
  adminPaymentConfigurationRequestSchema,
  adminPaymentConfigurationResponseSchema,
  adminPaymentConfigurationStoreRequestSchema,
  paymentConfigurationDeployedAccountsSchema,
  type AdminPaymentConfigurationCommand,
  type AdminPaymentConfigurationResponse,
  type PaymentConfigurationDeployedAccount,
} from "@fan-support/contracts";
import type {
  AdminPaymentConfigurationTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";
export type AdminPaymentConfigurationDependencies = Readonly<{
  transactions: AdminPaymentConfigurationTransactionManager;
  tokenPepper: string;
  deployedAccounts: readonly PaymentConfigurationDeployedAccount[];
}>;
/** The transport and application both reject a valid response belonging to another command. */
export function adminPaymentConfigurationResponseMatches(
  command: AdminPaymentConfigurationCommand,
  response: AdminPaymentConfigurationResponse,
): boolean {
  if (response.outcome === "FAILURE") return true;
  switch (command.action) {
    case "READ":
      return (
        response.kind === "WORKSPACE" &&
        (command.revisionId === null ||
          response.selected?.revisionId === command.revisionId)
      );
    case "VALIDATE":
      return (
        response.kind === "VALIDATION" &&
        response.revisionId === command.revisionId &&
        response.expectedPublicationId === command.expectedPublicationId &&
        response.mode === command.mode
      );
    case "SAVE":
      return (
        response.kind === "MUTATION" &&
        response.action === "SAVE" &&
        response.publicationId === null
      );
    case "PUBLISH":
    case "ROLLBACK":
      return (
        response.kind === "MUTATION" &&
        response.action === command.action &&
        response.revisionId === command.revisionId &&
        response.publicationId !== null &&
        response.generation > 0
      );
    default:
      return (
        response.kind === "MUTATION" &&
        response.action === command.action &&
        response.revisionId === command.revisionId &&
        response.publicationId === null
      );
  }
}
export function createAdminPaymentConfigurationUseCases(
  dependencies: AdminPaymentConfigurationDependencies,
) {
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  if (
    typeof dependencies.transactions
      ?.runInAdminPaymentConfigurationTransaction !== "function"
  )
    throw new TypeError("Invalid payment configuration transactions");
  const deployedAccounts = paymentConfigurationDeployedAccountsSchema.parse(
    dependencies.deployedAccounts,
  );
  const failure = (
    code: "INVALID_COMMAND" | "TEMPORARY_UNAVAILABLE",
  ): AdminPaymentConfigurationResponse => ({
    schemaVersion: 1,
    outcome: "FAILURE",
    code,
  });
  return Object.freeze({
    async execute(input: unknown): Promise<AdminPaymentConfigurationResponse> {
      const parsed = adminPaymentConfigurationRequestSchema.safeParse(input);
      if (!parsed.success) return failure("INVALID_COMMAND");
      try {
        const { command, requestId, sessionToken, csrfToken } = parsed.data;
        const digest = (
          purpose: "admin-session" | "admin-csrf",
          token: string,
        ) =>
          digestAdminContentToken({
            tokenPepper: dependencies.tokenPepper,
            purpose,
            token,
          });
        const request = adminPaymentConfigurationStoreRequestSchema.parse({
          schemaVersion: 1,
          access: {
            schemaVersion: 1,
            requestId,
            correlationId: requestId,
            sessionTokenDigest: digest("admin-session", sessionToken),
            csrfTokenDigest: digest("admin-csrf", csrfToken),
          },
          command,
          requestHash:
            "idempotencyKey" in command
              ? createHmac(
                  "sha256",
                  Buffer.from(dependencies.tokenPepper, "hex"),
                )
                  .update("fan-support:admin-payment-configuration:v1:")
                  .update(canonicalPublicationValue(command))
                  .digest("hex")
              : null,
          deployedAccounts,
        });
        const response = adminPaymentConfigurationResponseSchema.parse(
          await dependencies.transactions.runInAdminPaymentConfigurationTransaction(
            async (repository) =>
              JSON.parse(
                JSON.stringify(await repository.execute(request)),
              ) as JsonValue,
          ),
        );
        return adminPaymentConfigurationResponseMatches(command, response)
          ? response
          : failure("TEMPORARY_UNAVAILABLE");
      } catch {
        return failure("TEMPORARY_UNAVAILABLE");
      }
    },
  });
}
export type AdminPaymentConfigurationUseCases = ReturnType<
  typeof createAdminPaymentConfigurationUseCases
>;
