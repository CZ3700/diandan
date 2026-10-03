import { createHash } from "node:crypto";
import {
  storefrontNavigationAuthorizationCommandSchema,
  adminAuthorizationResponseSchema,
  storefrontNavigationRequestSchema,
  storefrontNavigationResponseSchema,
  publicStorefrontNavigationResponseSchema,
  type StorefrontNavigationResponse,
  type PublicStorefrontNavigationResponse,
} from "@fan-support/contracts";
import type { StorefrontNavigationTransactionManager } from "@fan-support/persistence-port";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";
import {
  adminContentErrorResult,
  adminContentFailure,
} from "./admin-content-results.js";
export function createStorefrontNavigationUseCases(
  dependencies: Readonly<{
    transactions: StorefrontNavigationTransactionManager;
    tokenPepper: string;
  }>,
) {
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  return Object.freeze({
    async execute(input: unknown): Promise<StorefrontNavigationResponse> {
      const parsed = storefrontNavigationRequestSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      const request = parsed.data;
      try {
        return storefrontNavigationResponseSchema.parse(
          await dependencies.transactions.runInStorefrontNavigationTransaction(
            async ({ authorization, storefrontNavigation }) => {
              const action = request.command.action;
              const permission =
                action === "READ" || action === "HISTORY"
                  ? "content.read"
                  : action === "SAVE_DRAFT"
                    ? "content.edit"
                    : "content.publish";
              const authorized = adminAuthorizationResponseSchema.parse(
                await authorization.authorize(
                  storefrontNavigationAuthorizationCommandSchema.parse({
                    schemaVersion: 1,
                    permission,
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
              return storefrontNavigationResponseSchema.parse(
                await storefrontNavigation.execute({
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
export function createPublicStorefrontNavigationUseCases(
  dependencies: Readonly<{
    transactions: StorefrontNavigationTransactionManager;
  }>,
) {
  return Object.freeze({
    async execute(): Promise<PublicStorefrontNavigationResponse> {
      try {
        return publicStorefrontNavigationResponseSchema.parse(
          await dependencies.transactions.runInStorefrontNavigationTransaction(
            ({ storefrontNavigation }) => storefrontNavigation.readPublished(),
          ),
        );
      } catch {
        return {
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "CONTENT_UNAVAILABLE",
        };
      }
    },
  });
}
