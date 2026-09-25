import type { FastifyInstance, FastifyReply } from "fastify";
import {
  cartEditCommandSchema,
  cartEditResponseSchema,
  cartEditorResponseSchema,
  cartEditFailureSchema,
  cartRuntimeAccessesSchema,
  idempotencyKeySchema,
  type CartEditCommand,
  type CartEditFailureCode,
} from "@fan-support/contracts";
import { resolveRequestId } from "@fan-support/observability";
import { currentRequestContext } from "@fan-support/observability/node";
import {
  singleHeader,
  cookieToken,
  privacy,
  failureStatus,
  clearCookie,
  type CartRouteDependencies,
  type CartHttpTrustedContext,
} from "./cart-route.js";
export type CartEditRouteDependencies = Omit<
  CartRouteDependencies,
  "useCases"
> & {
  useCases: {
    update: (
      command: CartEditCommand,
      context: CartHttpTrustedContext,
    ) => Promise<unknown>;
    remove: (
      command: CartEditCommand,
      context: CartHttpTrustedContext,
    ) => Promise<unknown>;
    readEditor: (
      command: CartEditCommand,
      context: CartHttpTrustedContext,
    ) => Promise<unknown>;
  };
};
function fail(
  reply: FastifyReply,
  code: CartEditFailureCode,
  status = failureStatus(code),
) {
  return reply.code(status).send(
    cartEditFailureSchema.parse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code,
    }),
  );
}

/** Even editor reads require the established cookie, exact Origin and cookie-bound CSRF. */
export function registerCartEditRoute(
  app: FastifyInstance,
  options: CartEditRouteDependencies,
): void {
  const origin = new URL(options.allowedOrigin);
  if (
    origin.origin !== options.allowedOrigin ||
    !["http:", "https:"].includes(origin.protocol)
  )
    throw new TypeError("Invalid cart origin");
  for (const [method, suffix, operation, action] of [
    ["PATCH", "", "UPDATE_CART_ITEM", "update"],
    ["DELETE", "", "REMOVE_CART_ITEM", "remove"],
    ["POST", "/editor", "READ_CART_ITEM_EDITOR", "readEditor"],
  ] as const) {
    void app.register(async (scope) => {
      scope.addHook("onRequest", async (request, reply) => {
        privacy(reply);
        if (
          singleHeader(request, "origin") !== options.allowedOrigin ||
          (request.headers["sec-fetch-site"] !== undefined &&
            !["same-origin", "same-site", "none"].includes(
              singleHeader(request, "sec-fetch-site") ?? "",
            ))
        )
          return fail(reply, "INVALID_ACCESS", 403);
        if (
          (request.raw.url ?? "").includes("?") ||
          !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
            singleHeader(request, "content-type") ?? "",
          )
        )
          return fail(reply, "INVALID_COMMAND");
      });
      scope.addHook("onSend", async (_request, reply, payload) => {
        privacy(reply);
        return payload;
      });
      scope.setErrorHandler((error, _request, reply) => {
        const value = error as { code?: string; statusCode?: number };
        return value.code === "FST_ERR_CTP_BODY_TOO_LARGE"
          ? fail(reply, "INVALID_COMMAND", 413)
          : value.statusCode &&
              value.statusCode >= 400 &&
              value.statusCode < 500
            ? fail(reply, "INVALID_COMMAND")
            : fail(reply, "TEMPORARY_UNAVAILABLE");
      });
      scope.route({
        method,
        url: `/api/v1/cart/items/:itemId${suffix}`,
        bodyLimit: 8192,
        exposeHeadRoute: false,
        handler: async (request, reply) => {
          let command: CartEditCommand;
          let idempotencyKey: string | undefined;
          try {
            const body = request.body;
            if (
              !body ||
              typeof body !== "object" ||
              Array.isArray(body) ||
              Object.hasOwn(body, "itemId") ||
              Object.hasOwn(body, "operation")
            )
              return fail(reply, "INVALID_COMMAND");
            command = cartEditCommandSchema.parse({
              ...body,
              itemId: (request.params as { itemId: string }).itemId,
              operation,
            });
            if (action !== "readEditor")
              idempotencyKey = idempotencyKeySchema.parse(
                singleHeader(request, "idempotency-key"),
              );
          } catch {
            return fail(reply, "INVALID_COMMAND");
          }
          const token = cookieToken(request);
          if (!token) return fail(reply, "INVALID_ACCESS");
          try {
            const proof = await options.credentials.resolve(
              token,
              singleHeader(request, "x-csrf-token"),
            );
            if (!proof.csrfValid) return fail(reply, "INVALID_ACCESS", 403);
            const requestId =
              currentRequestContext()?.requestId ??
              resolveRequestId(singleHeader(request, "x-request-id"));
            const context: CartHttpTrustedContext = {
              schemaVersion: 1,
              accesses: cartRuntimeAccessesSchema.parse(proof.accessCandidates),
              requestId,
              correlationId: requestId,
              ...(idempotencyKey ? { idempotencyKey } : {}),
            };
            const raw = await options.useCases[action](command, context);
            const result =
              action === "readEditor"
                ? cartEditorResponseSchema.parse(raw)
                : cartEditResponseSchema.parse(raw);
            if (result.outcome === "FAILURE") {
              if (result.code === "CART_EXPIRED") clearCookie(reply);
              return reply.code(failureStatus(result.code)).send(result);
            }
            if (
              result.cartItemId.toLowerCase() !== command.itemId.toLowerCase()
            )
              return fail(reply, "TEMPORARY_UNAVAILABLE");
            if (result.action === "EDITOR_READ") {
              if (
                result.cartVersion !== command.expectedCartVersion ||
                result.itemVersion !== command.expectedItemVersion
              )
                return fail(reply, "TEMPORARY_UNAVAILABLE");
            } else if (
              result.cart.presentationLocale !== command.presentationLocale ||
              !(
                action === "update"
                  ? ["UPDATED", "REPLAYED"]
                  : ["REMOVED", "REPLAYED"]
              ).includes(result.action)
            )
              return fail(reply, "TEMPORARY_UNAVAILABLE");
            void reply.header("x-csrf-token", proof.csrfToken);
            return reply.code(200).send(result);
          } catch {
            return fail(reply, "TEMPORARY_UNAVAILABLE");
          }
        },
      });
    });
  }
}
