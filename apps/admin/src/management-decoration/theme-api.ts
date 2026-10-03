import {
  storefrontThemeResponseSchema,
  type StorefrontTheme,
  type StorefrontThemeResponse,
  type StorefrontThemeState,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "../workspace/client";
import { createMutationKeys } from "../workspace/state";
import { sameTheme } from "./theme-model";
export type ThemeHistory = Extract<
  StorefrontThemeResponse,
  { kind: "HISTORY" }
>;

export function createStorefrontThemeApi(client: AdminClient) {
  const keys = createMutationKeys();
  async function read(): Promise<StorefrontThemeState> {
    const result = await client.call(
      "storefront-theme-read",
      { schemaVersion: 1 },
      storefrontThemeResponseSchema,
    );
    if (result.kind !== "STATE") throw new AdminClientError("INVALID_RESPONSE");
    return result.state;
  }
  async function mutate(
    operation: string,
    command: Record<string, unknown>,
    matches: (state: StorefrontThemeState) => boolean,
  ): Promise<StorefrontThemeState> {
    const body = { schemaVersion: 1, ...command };
    const result = await client.call(
      operation,
      body,
      storefrontThemeResponseSchema,
      true,
      keys.forCommand(operation, body),
    );
    if (
      result.kind !== "STATE" ||
      result.state.version !== Number(command["expectedVersion"]) + 1 ||
      !matches(result.state)
    )
      throw new AdminClientError("INVALID_RESPONSE");
    // A retried command may be older than another operator's changes; reread current authority.
    const current = result.replayed ? await read() : result.state;
    keys.succeeded(operation, body);
    return current;
  }
  return {
    read,
    async history(page = 1): Promise<ThemeHistory> {
      const result = await client.call(
        "storefront-theme-history",
        { schemaVersion: 1, page, pageSize: 10 },
        storefrontThemeResponseSchema,
      );
      if (
        result.kind !== "HISTORY" ||
        result.page !== page ||
        result.pageSize !== 10
      )
        throw new AdminClientError("INVALID_RESPONSE");
      return result;
    },
    save(theme: StorefrontTheme, expectedVersion: number) {
      return mutate(
        "storefront-theme-draft",
        { theme, expectedVersion },
        (state) => Boolean(state.draft && sameTheme(state.draft.theme, theme)),
      );
    },
    publish(draftRevisionId: string, expectedVersion: number) {
      return mutate(
        "storefront-theme-publish",
        { draftRevisionId, expectedVersion },
        (state) =>
          state.draft === null &&
          state.published?.revisionId === draftRevisionId &&
          state.published.action === "PUBLISH",
      );
    },
    restore(publicationId: string, expectedVersion: number) {
      return mutate(
        "storefront-theme-restore",
        { publicationId, expectedVersion },
        (state) =>
          state.draft === null &&
          state.published?.restoredFromPublicationId === publicationId &&
          state.published.action === "RESTORE",
      );
    },
  };
}
export type StorefrontThemeApi = ReturnType<typeof createStorefrontThemeApi>;
