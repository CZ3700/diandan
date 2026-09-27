import { createHash } from "node:crypto";
import {
  homeLayoutAuthorizationCommandSchema,
  adminAuthorizationResponseSchema,
  homeLayoutRequestSchema,
  homeLayoutResponseSchema,
  publicHomeLayoutResponseSchema,
  type HomeLayoutResponse,
  type PublicHomeLayoutResponse,
} from "@fan-support/contracts";
import type { HomeLayoutTransactionManager } from "@fan-support/persistence-port";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";
import {
  adminContentErrorResult,
  adminContentFailure,
} from "./admin-content-results.js";
export function createHomeLayoutUseCases(
  dependencies: Readonly<{
    transactions: HomeLayoutTransactionManager;
    tokenPepper: string;
  }>,
) {
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  return Object.freeze({
    async execute(input: unknown): Promise<HomeLayoutResponse> {
      const parsed = homeLayoutRequestSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      const request = parsed.data;
      try {
        return homeLayoutResponseSchema.parse(
          await dependencies.transactions.runInHomeLayoutTransaction(
            async ({ authorization, homeLayout }) => {
              const action = request.command.action;
              const permission =
                action === "READ" || action === "HISTORY"
                  ? "content.read"
                  : action === "SAVE_DRAFT"
                    ? "content.edit"
                    : "content.publish";
              const authorized = adminAuthorizationResponseSchema.parse(
                await authorization.authorize(
                  homeLayoutAuthorizationCommandSchema.parse({
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
              return homeLayoutResponseSchema.parse(
                await homeLayout.execute({
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
export function createPublicHomeLayoutUseCases(
  dependencies: Readonly<{ transactions: HomeLayoutTransactionManager }>,
) {
  return Object.freeze({
    async execute(): Promise<PublicHomeLayoutResponse> {
      try {
        return publicHomeLayoutResponseSchema.parse(
          await dependencies.transactions.runInHomeLayoutTransaction(
            ({ homeLayout }) => homeLayout.readPublished(),
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
