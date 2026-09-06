import {
  translationWorkspaceRequestSchema,
  translationWorkspaceContextResponseSchema,
  translationWorkspaceResponseSchema,
  SUPPORTED_LOCALES,
  type TranslationWorkspaceResponse,
  type SupportedLocale,
} from "@fan-support/contracts";
import { projectTranslationWorkspace } from "@fan-support/content";
import type {
  TranslationWorkspaceTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";
import { validateAdminContentTokenPepper } from "./admin-content-tokens.js";
import {
  adminContentFailure,
  adminContentErrorResult,
  requireAdminSuccess,
} from "./admin-content-results.js";
import {
  authorizeTranslation,
  translationAuthorization,
} from "./translation-authorization.js";
export type TranslationWorkspaceUseCases = Readonly<{
  execute(input: unknown): Promise<TranslationWorkspaceResponse>;
}>;
export function createTranslationWorkspaceUseCases(dependencies: {
  transactions: TranslationWorkspaceTransactionManager;
  tokenPepper: string;
}): TranslationWorkspaceUseCases {
  if (
    !dependencies ||
    typeof dependencies.transactions?.runInTranslationWorkspaceTransaction !==
      "function"
  )
    throw new TypeError("Invalid translation workspace configuration");
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  return {
    async execute(input) {
      const parsed = translationWorkspaceRequestSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      try {
        const authorization = translationAuthorization(
          parsed.data,
          dependencies.tokenPepper,
        );
        const result =
          await dependencies.transactions.runInTranslationWorkspaceTransaction(
            async (repositories) => {
              const { command } = parsed.data;
              const principal = (await authorizeTranslation(
                repositories.authorization,
                authorization,
                "content.read",
                [command.target.locale],
              ))!;
              const { context } = requireAdminSuccess(
                translationWorkspaceContextResponseSchema.parse(
                  await repositories.translationWorkspace.read(command),
                ),
              );
              const readableLocales: SupportedLocale[] = [
                  command.target.locale,
                ],
                editableLocales: SupportedLocale[] = [];
              for (const locale of SUPPORTED_LOCALES) {
                if (
                  locale !== command.target.locale &&
                  (await authorizeTranslation(
                    repositories.authorization,
                    authorization,
                    "content.read",
                    [locale],
                    principal,
                    true,
                  ))
                )
                  readableLocales.push(locale);
                if (
                  await authorizeTranslation(
                    repositories.authorization,
                    authorization,
                    "content.edit",
                    [locale],
                    principal,
                    true,
                  )
                )
                  editableLocales.push(locale);
              }
              return JSON.parse(
                JSON.stringify(
                  projectTranslationWorkspace(context, command.target, {
                    readableLocales,
                    editableLocales,
                  }),
                ),
              ) as JsonValue;
            },
          );
        return translationWorkspaceResponseSchema.parse(result);
      } catch (error) {
        return adminContentErrorResult(error);
      }
    },
  };
}
