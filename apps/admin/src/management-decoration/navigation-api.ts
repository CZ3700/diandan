import {
  storefrontNavigationResponseSchema,
  type StorefrontNavigation,
  type StorefrontNavigationResponse,
  type StorefrontNavigationState,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "../workspace/client";
import { createMutationKeys } from "../workspace/state";
import { sameNavigation } from "./navigation-model";
export type NavigationHistory = Extract<
  StorefrontNavigationResponse,
  { kind: "HISTORY" }
>;

export function createStorefrontNavigationApi(client: AdminClient) {
  const keys = createMutationKeys();
  async function read(): Promise<StorefrontNavigationState> {
    const result = await client.call(
      "storefront-navigation-read",
      { schemaVersion: 1 },
      storefrontNavigationResponseSchema,
    );
    if (result.kind !== "STATE") throw new AdminClientError("INVALID_RESPONSE");
    return result.state;
  }
  async function mutate(
    operation: string,
    command: Record<string, unknown>,
    matches: (state: StorefrontNavigationState) => boolean,
  ): Promise<StorefrontNavigationState> {
    const body = { schemaVersion: 1, ...command };
    const result = await client.call(
      operation,
      body,
      storefrontNavigationResponseSchema,
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
    async history(page = 1): Promise<NavigationHistory> {
      const result = await client.call(
        "storefront-navigation-history",
        { schemaVersion: 1, page, pageSize: 10 },
        storefrontNavigationResponseSchema,
      );
      if (
        result.kind !== "HISTORY" ||
        result.page !== page ||
        result.pageSize !== 10
      )
        throw new AdminClientError("INVALID_RESPONSE");
      return result;
    },
    save(navigation: StorefrontNavigation, expectedVersion: number) {
      return mutate(
        "storefront-navigation-draft",
        { navigation, expectedVersion },
        (state) =>
          Boolean(
            state.draft && sameNavigation(state.draft.navigation, navigation),
          ),
      );
    },
    publish(draftRevisionId: string, expectedVersion: number) {
      return mutate(
        "storefront-navigation-publish",
        { draftRevisionId, expectedVersion },
        (state) =>
          state.draft === null &&
          state.published?.revisionId === draftRevisionId &&
          state.published.action === "PUBLISH",
      );
    },
    restore(publicationId: string, expectedVersion: number) {
      return mutate(
        "storefront-navigation-restore",
        { publicationId, expectedVersion },
        (state) =>
          state.draft === null &&
          state.published?.restoredFromPublicationId === publicationId &&
          state.published.action === "RESTORE",
      );
    },
  };
}
export type StorefrontNavigationApi = ReturnType<
  typeof createStorefrontNavigationApi
>;
