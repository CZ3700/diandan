import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  checkoutPreflightValidateRequestSchema,
  checkoutPreflightCreateRequestSchema,
  checkoutPreflightReadCommandSchema,
  checkoutPreflightResponseSchema,
  checkoutPreflightFailureSchema,
  cartRuntimeAccessesSchema,
  idempotencyKeySchema,
  type CheckoutPreflightCommand,
  type CheckoutPreflightFailureCode,
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

type Action = "validate" | "create" | "read";
export type CheckoutPreflightRouteDependencies = Omit<
  CartRouteDependencies,
  "useCases"
> &
  Readonly<{
    useCases: Record<
      Action,
      (
        command: CheckoutPreflightCommand,
        context: CartHttpTrustedContext,
      ) => Promise<unknown>
    >;
  }>;
function status(code: string): number {
  return code === "CHECKOUT_NOT_FOUND" || code === "PREFLIGHT_NOT_FOUND"
    ? 404
    : failureStatus(code);
}
function fail(
  reply: FastifyReply,
  code: CheckoutPreflightFailureCode,
  httpStatus = status(code),
) {
  return reply.code(httpStatus).send(
    checkoutPreflightFailureSchema.parse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code,
    }),
  );
}
function commandFor(
  request: FastifyRequest,
  action: Action,
): CheckoutPreflightCommand {
  if (action === "read") {
    if (request.body !== undefined) throw new Error("Invalid checkout request");
    return checkoutPreflightReadCommandSchema.parse({
      schemaVersion: 1,
      operation: "READ_CHECKOUT",
      checkoutSessionId: (request.params as { checkoutSessionId: string })
        .checkoutSessionId,
    });
  }
  return action === "validate"
    ? {
        ...checkoutPreflightValidateRequestSchema.parse(request.body),
        operation: "VALIDATE_CHECKOUT",
      }
    : {
        ...checkoutPreflightCreateRequestSchema.parse(request.body),
        operation: "CREATE_CHECKOUT",
      };
}

/** The existing cart Cookie remains authority; preflight/session identifiers never authorize a request. */
export function registerCheckoutPreflightRoute(
  app: FastifyInstance,
  options: CheckoutPreflightRouteDependencies,
): void {
  const origin = new URL(options.allowedOrigin);
  if (
    origin.origin !== options.allowedOrigin ||
    !["https:", "http:"].includes(origin.protocol)
  )
    throw new TypeError("Invalid checkout origin");
  for (const [method, url, action] of [
    ["POST", "/api/v1/cart/validate", "validate"],
    ["POST", "/api/v1/checkout/sessions", "create"],
    ["GET", "/api/v1/checkout/sessions/:checkoutSessionId/status", "read"],
  ] as const)
    void app.register(async (scope) => {
      scope.addHook("onRequest", async (request, reply) => {
        privacy(reply);
        if (
          ((method === "POST" || request.headers.origin !== undefined) &&
            singleHeader(request, "origin") !== options.allowedOrigin) ||
          (request.headers["sec-fetch-site"] !== undefined &&
            !["same-origin", "same-site", "none"].includes(
              singleHeader(request, "sec-fetch-site") ?? "",
            ))
        )
          return fail(reply, "INVALID_ACCESS", 403);
        if (
          (request.raw.url ?? "").includes("?") ||
          (method === "GET" &&
            (request.headers["transfer-encoding"] !== undefined ||
              (request.headers["content-length"] !== undefined &&
                singleHeader(request, "content-length") !== "0"))) ||
          (method === "POST" &&
            !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
              singleHeader(request, "content-type") ?? "",
            ))
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
        url,
        bodyLimit: 8192,
        exposeHeadRoute: false,
        handler: async (request, reply) => {
          let command: CheckoutPreflightCommand;
          let idempotencyKey: string | undefined;
          try {
            command = commandFor(request, action);
            if (action !== "read")
              idempotencyKey = idempotencyKeySchema.parse(
                singleHeader(request, "idempotency-key"),
              );
          } catch {
            return fail(reply, "INVALID_COMMAND");
          }
          const token = cookieToken(request);
          if (!token) return fail(reply, "INVALID_ACCESS");
          let dispatched = false;
          try {
            const proof = await options.credentials.resolve(
              token,
              singleHeader(request, "x-csrf-token"),
            );
            if (method === "POST" && !proof.csrfValid)
              return fail(reply, "INVALID_ACCESS", 403);
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
            dispatched = true;
            const result = checkoutPreflightResponseSchema.parse(
              await options.useCases[action](command, context),
            );
            if (result.outcome === "FAILURE") {
              if (result.code === "CART_EXPIRED") clearCookie(reply);
              return reply.code(status(result.code)).send(result);
            }
            const matches =
              command.operation === "VALIDATE_CHECKOUT"
                ? result.action === "VALIDATED" &&
                  result.preflight.cartVersion ===
                    command.expectedCartVersion &&
                  result.preflight.presentationLocale ===
                    command.presentationLocale
                : command.operation === "READ_CHECKOUT"
                  ? result.action === "READ" &&
                    result.checkout.id.toLowerCase() ===
                      command.checkoutSessionId.toLowerCase()
                  : result.action === "CREATED" || result.action === "REPLAYED";
            if (!matches) throw new Error("Checkout response mismatch");
            void reply.header("x-csrf-token", proof.csrfToken);
            return reply.code(200).send(result);
          } catch {
            return fail(
              reply,
              action !== "read" && dispatched
                ? "TRANSACTION_OUTCOME_UNKNOWN"
                : "TEMPORARY_UNAVAILABLE",
            );
          }
        },
      });
    });
}
