import type { FastifyInstance } from "fastify";
import {
  catalogDisplayOrderCommandSchema,
  catalogDisplayOrderRequestSchema,
  catalogDisplayOrderResponseSchema,
  type CatalogDisplayOrderCommand,
  type CatalogDisplayOrderResponse,
} from "@fan-support/contracts";
import { registerPrivateAdminEndpoint } from "./admin-workspace-transport.js";

// L2-10: operator-chosen storefront order for artists and gifts.
export type CatalogDisplayOrderRouteDependencies = Readonly<{
  allowedOrigin: string;
  useCases: Readonly<{ execute(input: unknown): Promise<unknown> }>;
}>;
function matches(
  command: CatalogDisplayOrderCommand,
  response: CatalogDisplayOrderResponse,
): boolean {
  if (response.outcome === "FAILURE") return true;
  if (response.orderKind !== command.kind) return false;
  if (command.action === "READ") return true;
  if (response.replayed) return true;
  // Items not visible on the storefront (e.g. unpublished) may be saved but are not listed back.
  const saved = command.orderedIds.map((id) => id.toLowerCase());
  let cursor = 0;
  for (const item of response.items.filter((entry) => entry.manual)) {
    cursor = saved.indexOf(item.id.toLowerCase(), cursor);
    if (cursor < 0) return false;
    cursor += 1;
  }
  return response.version === command.expectedVersion + 1;
}
export function registerCatalogDisplayOrderRoute(
  instance: FastifyInstance,
  options: CatalogDisplayOrderRouteDependencies,
): void {
  for (const [path, action] of [
    ["read", "READ"],
    ["save", "SAVE"],
  ] as const) {
    registerPrivateAdminEndpoint(instance, {
      path: `/api/v1/admin/display-order/${path}`,
      allowedOrigin: options.allowedOrigin,
      bodyLimit: 32 * 1024,
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
            "sessionId",
            "sessionToken",
            "csrfToken",
          ].some((name) => Object.hasOwn(body, name))
        )
          throw new TypeError("Invalid display order body");
        return catalogDisplayOrderRequestSchema.parse({
          ...envelope,
          command: catalogDisplayOrderCommandSchema.parse({
            ...body,
            action,
            ...(action === "SAVE" ? { idempotencyKey: key } : {}),
          }),
        });
      },
      execute: (input) => options.useCases.execute(input),
      parseResponse(input, request) {
        const response = catalogDisplayOrderResponseSchema.parse(input);
        if (
          !matches(
            catalogDisplayOrderRequestSchema.parse(request).command,
            response,
          )
        )
          throw new TypeError("Mismatched display order response");
        return response;
      },
    });
  }
}
