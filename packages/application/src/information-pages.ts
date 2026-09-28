import { createHash } from "node:crypto";
import {
  informationPageRequestSchema,
  informationPageResponseSchema,
  adminAuthorizationResponseSchema,
  publicInformationPageRequestSchema,
  publicInformationPageResponseSchema,
  publicInformationPageIndexRequestSchema,
  publicInformationPageIndexResponseSchema,
  SUPPORTED_LOCALES,
  type InformationPageAuthorizationCommand,
  type InformationPageResponse,
  type AdminPrincipal,
  type SupportedLocale,
} from "@fan-support/contracts";
import type {
  InformationPageTransactionManager,
  InformationPageAccess,
} from "@fan-support/persistence-port";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";
import {
  adminContentFailure,
  adminContentErrorResult,
  rejectAdminContent,
} from "./admin-content-results.js";
export function createInformationPageUseCases(dependencies: {
  transactions: InformationPageTransactionManager;
  tokenPepper: string;
}) {
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  return {
    async execute(input: unknown): Promise<InformationPageResponse> {
      const parsed = informationPageRequestSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      const request = parsed.data;
      try {
        return informationPageResponseSchema.parse(
          await dependencies.transactions.runInInformationPageTransaction(
            async (repositories) => {
              const command = request.command;
              const credentials = {
                schemaVersion: 1 as const,
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
              };
              let principal: AdminPrincipal | undefined;
              const authorize = async (
                permission: InformationPageAuthorizationCommand["permission"],
                locales: SupportedLocale[],
                optional = false,
              ) => {
                const result = adminAuthorizationResponseSchema.parse(
                  await repositories.authorization.authorize({
                    ...credentials,
                    permission,
                    locales,
                  } as InformationPageAuthorizationCommand),
                );
                if (result.outcome === "FAILURE") {
                  if (optional && result.code === "FORBIDDEN") return false;
                  rejectAdminContent(result.code);
                }
                if (result.outcome !== "SUCCESS") return false;
                if (
                  Date.parse(result.principal.expiresAt) <=
                  Date.parse(result.principal.authorizedAt)
                )
                  rejectAdminContent("CONTENT_UNAVAILABLE");
                if (
                  principal &&
                  (principal.actorId !== result.principal.actorId ||
                    principal.sessionId !== result.principal.sessionId ||
                    principal.expiresAt !== result.principal.expiresAt)
                )
                  rejectAdminContent("CONTENT_UNAVAILABLE");
                principal = result.principal;
                return true;
              };
              await authorize(
                "content.read",
                command.action === "LIST" ? [] : [command.locale],
              );
              if (command.action === "SAVE_DRAFT")
                await authorize(
                  "content.edit",
                  command.locale === "en"
                    ? [...SUPPORTED_LOCALES]
                    : [command.locale],
                );
              if (command.action === "SUBMIT_REVIEW")
                await authorize("content.edit", [command.locale]);
              if (command.action === "APPROVE_REVIEW")
                await authorize("content.translation.review", [command.locale]);
              if (["PUBLISH", "RESTORE", "UNPUBLISH"].includes(command.action))
                await authorize("content.publish", [...SUPPORTED_LOCALES]);
              const access: InformationPageAccess = {
                readLocales: [],
                editLocales: [],
                reviewLocales: [],
                canPublish: await authorize(
                  "content.publish",
                  [...SUPPORTED_LOCALES],
                  true,
                ),
                canPreview: await authorize(
                  "content.preview",
                  [command.locale],
                  true,
                ),
              };
              for (const locale of SUPPORTED_LOCALES) {
                if (await authorize("content.read", [locale], true))
                  access.readLocales.push(locale);
                if (await authorize("content.edit", [locale], true))
                  access.editLocales.push(locale);
                if (
                  await authorize("content.translation.review", [locale], true)
                )
                  access.reviewLocales.push(locale);
              }
              if (!principal) throw new Error("Missing principal");
              return JSON.parse(
                JSON.stringify(
                  await repositories.informationPages.execute({
                    command,
                    principal,
                    requestId: request.requestId,
                    requestHash: createHash("sha256")
                      .update(JSON.stringify(command))
                      .digest("hex"),
                    access,
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
  };
}
export function createPublicInformationPageUseCases(dependencies: {
  transactions: InformationPageTransactionManager;
}) {
  return {
    async execute(input: unknown) {
      const parsed = publicInformationPageRequestSchema.safeParse(input);
      if (!parsed.success)
        return {
          schemaVersion: 1 as const,
          outcome: "FAILURE" as const,
          code: "INVALID_COMMAND" as const,
        };
      try {
        return publicInformationPageResponseSchema.parse(
          await dependencies.transactions.runInInformationPageTransaction(
            async (r) =>
              JSON.parse(
                JSON.stringify(
                  await r.informationPages.readPublished(parsed.data),
                ),
              ),
          ),
        );
      } catch {
        return {
          schemaVersion: 1 as const,
          outcome: "FAILURE" as const,
          code: "CONTENT_UNAVAILABLE" as const,
        };
      }
    },
    async index(input: unknown) {
      const parsed = publicInformationPageIndexRequestSchema.safeParse(input);
      if (!parsed.success)
        return {
          schemaVersion: 1 as const,
          outcome: "FAILURE" as const,
          code: "INVALID_COMMAND" as const,
        };
      try {
        return publicInformationPageIndexResponseSchema.parse(
          await dependencies.transactions.runInInformationPageTransaction(
            async (r) =>
              JSON.parse(
                JSON.stringify(await r.informationPages.readIndex(parsed.data)),
              ),
          ),
        );
      } catch {
        return {
          schemaVersion: 1 as const,
          outcome: "FAILURE" as const,
          code: "CONTENT_UNAVAILABLE" as const,
        };
      }
    },
  };
}
