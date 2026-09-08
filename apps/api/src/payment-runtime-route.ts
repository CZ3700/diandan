import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  paymentRuntimeCommandSchema,
  paymentRuntimeCreateRequestSchema,
  paymentRuntimeRecoverRequestSchema,
  paymentRuntimeResponseSchema,
  paymentRuntimeFailureSchema,
  paymentRuntimeOriginSchema,
  cartRuntimeAccessesSchema,
  idempotencyKeySchema,
  type PaymentRuntimeCommand,
  type PaymentRuntimeResponse,
  type PaymentRuntimeFailureCode,
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

export type PaymentRuntimeRouteDependencies = Omit<
  CartRouteDependencies,
  "useCases"
> & {
  actionOrigins: readonly string[];
  useCases: Record<
    "capabilities" | "current" | "create" | "read" | "recover",
    (
      command: PaymentRuntimeCommand,
      context: CartHttpTrustedContext,
    ) => Promise<unknown>
  >;
};
type Action = keyof PaymentRuntimeRouteDependencies["useCases"];
function status(code: string) {
  if (
    ["CHECKOUT_NOT_FOUND", "PREFLIGHT_NOT_FOUND", "ATTEMPT_NOT_FOUND"].includes(
      code,
    )
  )
    return 404;
  if (["PROVIDER_UNAVAILABLE", "CONFIGURATION_ERROR"].includes(code))
    return 503;
  return failureStatus(code);
}
function fail(
  reply: FastifyReply,
  code: PaymentRuntimeFailureCode,
  httpStatus = status(code),
) {
  return reply.code(httpStatus).send(
    paymentRuntimeFailureSchema.parse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code,
    }),
  );
}
function commandFor(
  request: FastifyRequest,
  action: Action,
): PaymentRuntimeCommand {
  const url = new URL(request.raw.url ?? "", "http://internal.invalid");
  const params = request.params as {
    checkoutSessionId?: string;
    attemptId?: string;
  };
  if (action !== "capabilities" && url.search)
    throw new Error("Unexpected payment query");
  if (action === "capabilities") {
    const allowed = ["presentationLocale", "country", "supportedActionTypes"];
    for (const key of url.searchParams.keys())
      if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1)
        throw new Error("Invalid capability query");
    return paymentRuntimeCommandSchema.parse({
      schemaVersion: 1,
      operation: "READ_PAYMENT_CAPABILITIES",
      ...params,
      presentationLocale: url.searchParams.get("presentationLocale"),
      ...(url.searchParams.has("country")
        ? { country: url.searchParams.get("country") }
        : {}),
      supportedActionTypes: url.searchParams
        .get("supportedActionTypes")
        ?.split(","),
    });
  }
  const body =
    action === "create"
      ? paymentRuntimeCreateRequestSchema.parse(request.body)
      : action === "recover"
        ? paymentRuntimeRecoverRequestSchema.parse(request.body)
        : { schemaVersion: 1 };
  return paymentRuntimeCommandSchema.parse({
    ...body,
    ...params,
    operation: {
      current: "READ_CURRENT_CHECKOUT",
      create: "CREATE_PAYMENT_ATTEMPT",
      read: "READ_PAYMENT_ATTEMPT",
      recover: "RECOVER_PAYMENT_ATTEMPT",
    }[action],
  });
}
function matches(
  command: PaymentRuntimeCommand,
  result: Exclude<PaymentRuntimeResponse, { outcome: "FAILURE" }>,
  origins: readonly string[],
) {
  const attempt = "attempt" in result ? result.attempt : undefined;
  const action = attempt?.action;
  if (
    action &&
    "url" in action &&
    !origins.includes(new URL(action.url).origin)
  )
    return false;
  switch (command.operation) {
    case "READ_CURRENT_CHECKOUT":
      return result.action === "CURRENT" || result.action === "EMPTY";
    case "READ_PAYMENT_CAPABILITIES":
      return (
        result.action === "CAPABILITIES" &&
        result.capabilities.checkoutSessionId.toLowerCase() ===
          command.checkoutSessionId.toLowerCase() &&
        result.capabilities.presentationLocale === command.presentationLocale &&
        (command.country === undefined ||
          result.capabilities.country === command.country) &&
        result.capabilities.capabilities.every((entry) =>
          entry.supportedActionTypes.every((type) =>
            command.supportedActionTypes.includes(type),
          ),
        )
      );
    default:
      return (
        attempt !== undefined &&
        attempt !== null &&
        attempt.checkoutSessionId.toLowerCase() ===
          command.checkoutSessionId.toLowerCase() &&
        ("attemptId" in command
          ? attempt.id.toLowerCase() === command.attemptId.toLowerCase()
          : true) &&
        (command.operation === "CREATE_PAYMENT_ATTEMPT"
          ? ["CREATED", "REPLAYED"].includes(result.action)
          : command.operation === "RECOVER_PAYMENT_ATTEMPT"
            ? result.action === "RECOVERED"
            : result.action === "READ") &&
        (command.operation !== "CREATE_PAYMENT_ATTEMPT" ||
          !action ||
          action.type === "WAIT" ||
          command.supportedActionTypes.includes(action.type))
      );
  }
}

/** Only the established cart credential authorizes a session; reads never dispatch provider recovery. */
export function registerPaymentRuntimeRoute(
  app: FastifyInstance,
  options: PaymentRuntimeRouteDependencies,
): void {
  paymentRuntimeOriginSchema.parse(options.allowedOrigin);
  const origins = options.actionOrigins.map((value) =>
    paymentRuntimeOriginSchema.parse(value),
  );
  for (const [method, url, action] of [
    ["GET", "/api/v1/checkout/current/status", "current"],
    [
      "GET",
      "/api/v1/checkout/sessions/:checkoutSessionId/capabilities",
      "capabilities",
    ],
    ["POST", "/api/v1/checkout/sessions/:checkoutSessionId/attempts", "create"],
    [
      "GET",
      "/api/v1/checkout/sessions/:checkoutSessionId/attempts/:attemptId",
      "read",
    ],
    [
      "POST",
      "/api/v1/checkout/sessions/:checkoutSessionId/attempts/:attemptId/recover",
      "recover",
    ],
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
          let command: PaymentRuntimeCommand;
          let idempotencyKey: string | undefined;
          try {
            command = commandFor(request, action);
            if (method === "POST")
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
            const result = paymentRuntimeResponseSchema.parse(
              await options.useCases[action](command, context),
            );
            if (result.outcome === "FAILURE") {
              if (result.code === "CART_EXPIRED") clearCookie(reply);
              return reply.code(status(result.code)).send(result);
            }
            if (!matches(command, result, origins))
              throw new Error("Payment response mismatch");
            void reply.header("x-csrf-token", proof.csrfToken);
            return reply.code(200).send(result);
          } catch {
            return fail(
              reply,
              method === "POST" && dispatched
                ? "TRANSACTION_OUTCOME_UNKNOWN"
                : "TEMPORARY_UNAVAILABLE",
            );
          }
        },
      });
    });
}
