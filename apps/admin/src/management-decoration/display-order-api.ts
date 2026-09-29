import {
  catalogDisplayOrderResponseSchema,
  type CatalogDisplayOrderKind,
  type CatalogDisplayOrderResponse,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "../workspace/client";
import { createMutationKeys } from "../workspace/state";

// L2-10: the operator's storefront order for artists and gifts.
export type DisplayOrderState = Extract<
  CatalogDisplayOrderResponse,
  { kind: "DISPLAY_ORDER" }
>;

export function createDisplayOrderApi(client: AdminClient) {
  const keys = createMutationKeys();
  async function read(
    kind: CatalogDisplayOrderKind,
  ): Promise<DisplayOrderState> {
    const result = await client.call(
      "display-order-read",
      { schemaVersion: 1, kind },
      catalogDisplayOrderResponseSchema,
    );
    if (result.outcome !== "SUCCESS" || result.orderKind !== kind)
      throw new AdminClientError("INVALID_RESPONSE");
    return result;
  }
  return {
    read,
    /** Saving publishes at once; a replayed request rereads the current order. */
    async save(
      kind: CatalogDisplayOrderKind,
      orderedIds: readonly string[],
      expectedVersion: number,
    ): Promise<DisplayOrderState> {
      const body = {
        schemaVersion: 1,
        kind,
        orderedIds: [...orderedIds],
        expectedVersion,
      };
      const result = await client.call(
        "display-order-save",
        body,
        catalogDisplayOrderResponseSchema,
        true,
        keys.forCommand("display-order-save", body),
      );
      if (
        result.outcome !== "SUCCESS" ||
        result.orderKind !== kind ||
        (!result.replayed && result.version !== expectedVersion + 1)
      )
        throw new AdminClientError("INVALID_RESPONSE");
      keys.succeeded("display-order-save", body);
      return result.replayed ? read(kind) : result;
    },
  };
}
export type DisplayOrderApi = ReturnType<typeof createDisplayOrderApi>;
