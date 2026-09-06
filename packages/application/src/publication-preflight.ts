import {
  SUPPORTED_LOCALES,
  adminAuthorizationCommandSchema,
  adminAuthorizationResponseSchema,
  publicationPreflightContextResponseSchema,
  publicationPreflightRequestSchema,
  publicationPreflightResponseSchema,
  type PublicationPreflightResponse,
} from "@fan-support/contracts";
import {
  evaluatePublicationPreflight,
  sameBaseContentTarget,
} from "@fan-support/content";
import type {
  JsonValue,
  PublicationPreflightTransactionManager,
} from "@fan-support/persistence-port";
import {
  adminContentErrorResult,
  adminContentFailure,
  rejectAdminContent,
  requireAdminSuccess,
} from "./admin-content-results.js";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";
import { compareBaseContentTime } from "./base-content-time.js";

export type PublicationPreflightDependencies = Readonly<{
  transactions: PublicationPreflightTransactionManager;
  tokenPepper: string;
}>;
export type PublicationPreflightUseCases = Readonly<{
  execute(input: unknown): Promise<PublicationPreflightResponse>;
}>;

/** A current, authorized observation. Publishing must repeat this check in its own write transaction. */
export function createPublicationPreflightUseCases(
  dependencies: PublicationPreflightDependencies,
): PublicationPreflightUseCases {
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  return Object.freeze({
    async execute(input: unknown): Promise<PublicationPreflightResponse> {
      const parsed = publicationPreflightRequestSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      const request = parsed.data;
      try {
        const authorization = adminAuthorizationCommandSchema.parse({
          schemaVersion: 1,
          permission: "content.read",
          locales: [...SUPPORTED_LOCALES],
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
        });
        const response =
          await dependencies.transactions.runInPublicationPreflightTransaction(
            async (repositories) => {
              const { principal } = requireAdminSuccess(
                adminAuthorizationResponseSchema.parse(
                  await repositories.authorization.authorize(authorization),
                ),
              );
              if (
                compareBaseContentTime(
                  principal.expiresAt,
                  principal.authorizedAt,
                ) <= 0
              )
                rejectAdminContent("UNAUTHENTICATED");
              const { context } = requireAdminSuccess(
                publicationPreflightContextResponseSchema.parse(
                  await repositories.publicationPreflight.load(request.command),
                ),
              );
              if (
                context.action !== request.command.action ||
                !sameBaseContentTarget(
                  { ...context.target, locale: "en" },
                  { ...request.command.target, locale: "en" },
                )
              )
                rejectAdminContent("CONTENT_UNAVAILABLE");
              const report = publicationPreflightResponseSchema.parse(
                evaluatePublicationPreflight(context),
              );
              if (
                report.outcome === "SUCCESS" &&
                (report.action !== context.action ||
                  report.headVersion !== context.headVersion ||
                  report.contentHash !== context.snapshot.contentHash ||
                  report.evaluatedAt !== context.evaluatedAt ||
                  !sameBaseContentTarget(
                    { ...report.target, locale: "en" },
                    { ...context.target, locale: "en" },
                  ))
              )
                rejectAdminContent("CONTENT_UNAVAILABLE");
              return JSON.parse(JSON.stringify(report)) as JsonValue;
            },
          );
        return publicationPreflightResponseSchema.parse(response);
      } catch (error: unknown) {
        return adminContentErrorResult(error);
      }
    },
  });
}
