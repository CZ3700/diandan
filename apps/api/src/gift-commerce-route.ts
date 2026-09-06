import type { FastifyInstance } from "fastify";
import {
  giftCommerceCommandSchema,
  giftCommerceRequestSchema,
  giftCommerceResponseSchema,
  type GiftCommerceCommand,
  type GiftCommerceResponse,
} from "@fan-support/contracts";
import { registerPrivateAdminEndpoint } from "./admin-workspace-transport.js";

export type GiftCommerceRouteDependencies = Readonly<{
  allowedOrigin: string;
  useCases: Readonly<{ execute(input: unknown): Promise<unknown> }>;
}>;

export function registerGiftCommerceRoute(
  instance: FastifyInstance,
  options: GiftCommerceRouteDependencies,
): void {
  for (const [path, action, mutation, bodyLimit] of routes)
    registerPrivateAdminEndpoint(instance, {
      path: `/api/v1/admin/gift-commerce/${path}`,
      allowedOrigin: options.allowedOrigin,
      bodyLimit,
      parseRequest(body, envelope, key) {
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          [
            "action",
            "idempotencyKey",
            "requestId",
            "actorId",
            "sessionToken",
            "csrfToken",
          ].some((name) => Object.hasOwn(body, name))
        )
          throw new Error("Invalid commerce body");
        return giftCommerceRequestSchema.parse({
          ...envelope,
          command: giftCommerceCommandSchema.parse({
            ...body,
            action,
            ...(mutation ? { idempotencyKey: key } : {}),
          }),
        });
      },
      execute: (input) => options.useCases.execute(input),
      parseResponse(input, request) {
        const result = giftCommerceResponseSchema.parse(input);
        if (
          !responseMatches(
            giftCommerceRequestSchema.parse(request).command,
            result,
          )
        )
          throw new Error("Mismatched commerce response");
        return result;
      },
    });
}

const SMALL = 64 * 1024;
const routes = [
  ["context/read", "CONTEXT", false, SMALL],
  ["gifts/read", "READ_GIFT", false, SMALL],
  ["prices/read", "READ_PRICES", false, SMALL],
  ["inventory/read", "READ_INVENTORY", false, SMALL],
  ["gifts/create", "CREATE_GIFT", true, SMALL],
  ["gifts/status", "SET_GIFT_STATUS", true, SMALL],
  ["variants/save", "SAVE_VARIANT", true, 128 * 1024],
  ["content/save", "SAVE_GIFT_CONTENT", true, 16 * 1024 * 1024],
  ["prices/create", "CREATE_PRICE_REVISION", true, SMALL],
  ["prices/publish", "PUBLISH_PRICE_BOOK", true, SMALL],
  ["prices/rollback", "ROLLBACK_PRICE_BOOK", true, SMALL],
  ["inventory/locations/create", "CREATE_INVENTORY_LOCATION", true, SMALL],
  ["inventory/adjust", "ADJUST_INVENTORY", true, SMALL],
] as const;
const sameId = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();
function responseMatches(
  command: GiftCommerceCommand,
  result: GiftCommerceResponse,
): boolean {
  if (result.outcome === "FAILURE") return true;
  if ("idempotencyKey" in command) {
    if (result.kind !== "MUTATION" || result.action !== command.action)
      return false;
    if (
      "giftId" in command &&
      (!("giftId" in result) || !sameId(result.giftId, command.giftId))
    )
      return false;
    if (
      "giftVariantId" in command &&
      command.giftVariantId !== null &&
      (!("giftVariantId" in result) ||
        !sameId(result.giftVariantId, command.giftVariantId))
    )
      return false;
    if (
      "market" in command &&
      (!("market" in result) ||
        result.market !== command.market ||
        result.currency !== command.currency)
    )
      return false;
    return (
      command.action !== "SAVE_GIFT_CONTENT" ||
      (result.action === "SAVE_GIFT_CONTENT" &&
        sameId(result.giftId, command.authoring.target.giftId))
    );
  }
  switch (command.action) {
    case "CONTEXT":
      return result.kind === "COMMERCE_CONTEXT";
    case "READ_GIFT":
      return (
        result.kind === "GIFT" &&
        sameId(result.value.gift.id, command.giftId) &&
        result.value.locale === command.locale &&
        (command.revisionId === undefined ||
          sameId(result.value.selectedRevisionId ?? "", command.revisionId))
      );
    case "READ_PRICES":
      return (
        (result.kind === "PRICE_BOOKS" || result.kind === "PRICES") &&
        result.market === command.market &&
        result.currency === command.currency &&
        result.page === command.page &&
        result.pageSize === command.pageSize &&
        (command.revision === null
          ? result.kind === "PRICE_BOOKS"
          : result.kind === "PRICES" &&
            result.book.revision === command.revision)
      );
    case "READ_INVENTORY":
      return (
        (result.kind === "INVENTORY_BALANCES" ||
          result.kind === "INVENTORY_LEDGER") &&
        result.kind === `INVENTORY_${command.view}` &&
        sameId(result.giftVariantId, command.giftVariantId) &&
        result.page === command.page &&
        result.pageSize === command.pageSize &&
        (result.inventoryLocationId === null
          ? command.inventoryLocationId === null
          : command.inventoryLocationId !== null &&
            sameId(result.inventoryLocationId, command.inventoryLocationId))
      );
  }
}
