import {
  homeLayoutResponseSchema,
  type HomeLayout,
  type HomeLayoutResponse,
  type HomeLayoutState,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "../workspace/client";
import { createMutationKeys } from "../workspace/state";
import { sameLayout } from "./model";
export type LayoutHistory = Extract<HomeLayoutResponse, { kind: "HISTORY" }>;

export function createHomeLayoutApi(client: AdminClient) {
  const keys = createMutationKeys();
  async function read(): Promise<HomeLayoutState> {
    const result = await client.call(
      "home-layout-read",
      { schemaVersion: 1 },
      homeLayoutResponseSchema,
    );
    if (result.kind !== "STATE") throw new AdminClientError("INVALID_RESPONSE");
    return result.state;
  }
  async function mutate(
    operation: string,
    command: Record<string, unknown>,
    matches: (state: HomeLayoutState) => boolean,
  ): Promise<HomeLayoutState> {
    const body = { schemaVersion: 1, ...command };
    const result = await client.call(
      operation,
      body,
      homeLayoutResponseSchema,
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
    async history(page = 1): Promise<LayoutHistory> {
      const result = await client.call(
        "home-layout-history",
        { schemaVersion: 1, page, pageSize: 10 },
        homeLayoutResponseSchema,
      );
      if (
        result.kind !== "HISTORY" ||
        result.page !== page ||
        result.pageSize !== 10
      )
        throw new AdminClientError("INVALID_RESPONSE");
      return result;
    },
    save(layout: HomeLayout, expectedVersion: number) {
      return mutate("home-layout-draft", { layout, expectedVersion }, (state) =>
        Boolean(state.draft && sameLayout(state.draft.layout, layout)),
      );
    },
    publish(draftRevisionId: string, expectedVersion: number) {
      return mutate(
        "home-layout-publish",
        { draftRevisionId, expectedVersion },
        (state) =>
          state.draft === null &&
          state.published?.revisionId === draftRevisionId &&
          state.published.action === "PUBLISH",
      );
    },
    restore(publicationId: string, expectedVersion: number) {
      return mutate(
        "home-layout-restore",
        { publicationId, expectedVersion },
        (state) =>
          state.draft === null &&
          state.published?.restoredFromPublicationId === publicationId &&
          state.published.action === "RESTORE",
      );
    },
  };
}
export type HomeLayoutApi = ReturnType<typeof createHomeLayoutApi>;
