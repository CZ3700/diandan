import { createHash } from "node:crypto";
import {
  storefrontThemeAuthorizationCommandSchema,
  adminAuthorizationResponseSchema,
  storefrontThemeRequestSchema,
  storefrontThemeResponseSchema,
  publicStorefrontThemeResponseSchema,
  type StorefrontThemeResponse,
  type PublicStorefrontThemeResponse,
} from "@fan-support/contracts";
import type {
  JsonValue,
  StorefrontThemeTransactionManager,
} from "@fan-support/persistence-port";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";
import {
  adminContentErrorResult,
  adminContentFailure,
} from "./admin-content-results.js";
// Optional schema fields must be absent, never undefined, in transaction snapshots.
const transactionJson = (
  value: StorefrontThemeResponse | PublicStorefrontThemeResponse,
): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
export function createStorefrontThemeUseCases(
  dependencies: Readonly<{
    transactions: StorefrontThemeTransactionManager;
    tokenPepper: string;
  }>,
) {
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  return Object.freeze({
    async execute(input: unknown): Promise<StorefrontThemeResponse> {
      const parsed = storefrontThemeRequestSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      const request = parsed.data;
      try {
        return storefrontThemeResponseSchema.parse(
          await dependencies.transactions.runInStorefrontThemeTransaction(
            async ({ authorization, storefrontTheme }) => {
              const action = request.command.action;
              const permission =
                action === "READ" || action === "HISTORY"
                  ? "content.read"
                  : action === "SAVE_DRAFT"
                    ? "content.edit"
                    : "content.publish";
              const authorized = adminAuthorizationResponseSchema.parse(
                await authorization.authorize(
                  storefrontThemeAuthorizationCommandSchema.parse({
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
              return transactionJson(
                storefrontThemeResponseSchema.parse(
                  await storefrontTheme.execute({
                    command: request.command,
                    principal: authorized.principal,
                    requestId: request.requestId,
                    requestHash: createHash("sha256")
                      .update(JSON.stringify(request.command))
                      .digest("hex"),
                  }),
                ),
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
export function createPublicStorefrontThemeUseCases(
  dependencies: Readonly<{ transactions: StorefrontThemeTransactionManager }>,
) {
  return Object.freeze({
    async execute(): Promise<PublicStorefrontThemeResponse> {
      try {
        return publicStorefrontThemeResponseSchema.parse(
          await dependencies.transactions.runInStorefrontThemeTransaction(
            async ({ storefrontTheme }) =>
              transactionJson(
                publicStorefrontThemeResponseSchema.parse(
                  await storefrontTheme.readPublished(),
                ),
              ),
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
