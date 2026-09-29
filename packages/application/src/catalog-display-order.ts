import { createHash } from "node:crypto";
import {
  adminAuthorizationResponseSchema,
  catalogDisplayOrderRequestSchema,
  catalogDisplayOrderResponseSchema,
  homeLayoutAuthorizationCommandSchema,
  type CatalogDisplayOrderResponse,
} from "@fan-support/contracts";
import type { CatalogDisplayOrderTransactionManager } from "@fan-support/persistence-port";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";
import {
  adminContentErrorResult,
  adminContentFailure,
} from "./admin-content-results.js";

/** L2-10: reading needs content.read, saving publishes immediately and needs content.publish. */
export function createCatalogDisplayOrderUseCases(
  dependencies: Readonly<{
    transactions: CatalogDisplayOrderTransactionManager;
    tokenPepper: string;
  }>,
) {
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  return Object.freeze({
    async execute(input: unknown): Promise<CatalogDisplayOrderResponse> {
      const parsed = catalogDisplayOrderRequestSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      const request = parsed.data;
      try {
        return catalogDisplayOrderResponseSchema.parse(
          await dependencies.transactions.runInCatalogDisplayOrderTransaction(
            async ({ authorization, displayOrder }) => {
              const authorized = adminAuthorizationResponseSchema.parse(
                await authorization.authorize(
                  homeLayoutAuthorizationCommandSchema.parse({
                    schemaVersion: 1,
                    permission:
                      request.command.action === "READ"
                        ? "content.read"
                        : "content.publish",
                    locales: [],
                    sessionTokenDigest: digestAdminContentToken({
                      tokenPepper: dependencies.tokenPepper,
                      purpose: "admin-session",
                      token: request.sessionToken,
                    }),
                    csrfTokenDigest: digestAdminContentToken({
                      tokenPepper: dependencies.tokenPepper,
                      purpose: "admin-csrf",
                      token: request.csrfToken,
                    }),
                  }),
                ),
              );
              if (authorized.outcome === "FAILURE") return authorized;
              return catalogDisplayOrderResponseSchema.parse(
                await displayOrder.execute({
                  command: request.command,
                  principal: authorized.principal,
                  requestId: request.requestId,
                  requestHash: createHash("sha256")
                    .update(JSON.stringify(request.command))
                    .digest("hex"),
                }),
              );
            },
          ),
        );
      } catch (error) {
        return adminContentErrorResult(error);
      }
    },
  });
}
