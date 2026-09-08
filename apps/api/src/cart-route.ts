import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  cartRuntimeCommandSchema,
  cartRuntimeAccessesSchema,
  cartRuntimeCurrentResponseSchema,
  cartRuntimeFailureSchema,
  idempotencyKeySchema,
  type CartRuntimeAccesses,
  type CartRuntimeCommand,
  type CartRuntimeFailureCode,
} from "@fan-support/contracts";
import { resolveRequestId } from "@fan-support/observability";
import { currentRequestContext } from "@fan-support/observability/node";
import {
  isCartSessionToken,
  type createCartSessionCredentials,
} from "./cart-session-credentials.js";
export type CartHttpTrustedContext = Readonly<{
  schemaVersion: 1;
  accesses: CartRuntimeAccesses;
  requestId: string;
  correlationId: string;
  idempotencyKey?: string;
}>;
export type CartRouteDependencies = Readonly<{
  allowedOrigin: string;
  credentials: ReturnType<typeof createCartSessionCredentials>;
  useCases: {
    initialize(
      command: CartRuntimeCommand,
      context: CartHttpTrustedContext,
    ): Promise<unknown>;
    read(
      command: CartRuntimeCommand,
      context: CartHttpTrustedContext,
    ): Promise<unknown>;
    add(
      command: CartRuntimeCommand,
      context: CartHttpTrustedContext,
    ): Promise<unknown>;
  };
}>;
const cookieName = "__Host-fan-cart";
export function singleHeader(
  request: FastifyRequest,
  name: string,
): string | undefined {
  let count = 0;
  for (let index = 0; index < request.raw.rawHeaders.length; index += 2)
    if (request.raw.rawHeaders[index]?.toLowerCase() === name) count++;
  const value = request.headers[name];
  return count === 1 && typeof value === "string" ? value : undefined;
}
export function cookieToken(
  request: FastifyRequest,
): string | null | undefined {
  if (request.headers.cookie === undefined) return undefined;
  const header = singleHeader(request, "cookie");
  if (!header) return null;
  let result: string | undefined;
  for (const part of header.split(";")) {
    const offset = part.indexOf("=");
    if (offset < 1) return null;
    if (part.slice(0, offset).trim() !== cookieName) continue;
    if (result !== undefined) return null;
    result = part.slice(offset + 1).trim();
  }
  return result === undefined
    ? undefined
    : isCartSessionToken(result)
      ? result
      : null;
}
export function privacy(reply: FastifyReply): void {
  void reply
    .header("cache-control", "private, no-store")
    .header("x-robots-tag", "noindex, nofollow")
    .header("referrer-policy", "no-referrer");
}
export function failureStatus(code: string): number {
  if (code === "INVALID_COMMAND") return 400;
  if (code === "INVALID_ACCESS") return 401;
  if (code === "CART_NOT_FOUND" || code === "ITEM_NOT_FOUND") return 404;
  if (
    [
      "CONTENT_UNAVAILABLE",
      "COMMERCE_UNAVAILABLE",
      "TEMPORARY_UNAVAILABLE",
      "TRANSACTION_OUTCOME_UNKNOWN",
    ].includes(code)
  )
    return 503;
  return 409;
}
function fail(
  reply: FastifyReply,
  code: CartRuntimeFailureCode,
  status = failureStatus(code),
) {
  return reply.code(status).send(
    cartRuntimeFailureSchema.parse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code,
    }),
  );
}
export function clearCookie(reply: FastifyReply): void {
  void reply.header(
    "set-cookie",
    `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
}
function parseCommand(
  request: FastifyRequest,
  operation: CartRuntimeCommand["operation"],
): CartRuntimeCommand {
  if (operation === "READ_CART") {
    const query = new URL(request.raw.url ?? "", "http://cart.invalid")
      .searchParams;
    if (
      [...query.keys()].some((key) => key !== "presentationLocale") ||
      query.getAll("presentationLocale").length !== 1 ||
      request.body !== undefined
    )
      throw new Error("Invalid cart request");
    return cartRuntimeCommandSchema.parse({
      schemaVersion: 1,
      operation,
      presentationLocale: query.get("presentationLocale"),
    });
  }
  const body = request.body;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.hasOwn(body, "operation")
  )
    throw new Error("Invalid cart request");
  return cartRuntimeCommandSchema.parse({ ...body, operation });
}

/** Cookie/CSRF credentials are consumed here and never forwarded as business fields. */
export function registerCartRoute(
  app: FastifyInstance,
  options: CartRouteDependencies,
): void {
  const origin = new URL(options.allowedOrigin);
  if (
    origin.origin !== options.allowedOrigin ||
    !["http:", "https:"].includes(origin.protocol)
  )
    throw new TypeError("Invalid cart origin");
  for (const [path, method, operation, action] of [
    ["/api/v1/carts", "POST", "INITIALIZE_CART", "initialize"],
    ["/api/v1/cart", "GET", "READ_CART", "read"],
    ["/api/v1/cart/items", "POST", "ADD_CART_ITEM", "add"],
  ] as const) {
    void app.register(
      async (scope) => {
        scope.addHook("onRequest", async (request, reply) => {
          privacy(reply);
          const suppliedOrigin = singleHeader(request, "origin");
          if (
            (method === "POST" || request.headers.origin !== undefined) &&
            suppliedOrigin !== options.allowedOrigin
          )
            return fail(reply, "INVALID_ACCESS", 403);
          if (
            request.headers["sec-fetch-site"] !== undefined &&
            !["same-origin", "same-site", "none"].includes(
              singleHeader(request, "sec-fetch-site") ?? "",
            )
          )
            return fail(reply, "INVALID_ACCESS", 403);
          if (
            method === "POST" &&
            ((request.raw.url ?? "").includes("?") ||
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
        scope.setNotFoundHandler((_request, reply) =>
          fail(reply, "INVALID_COMMAND", 404),
        );
        scope.route({
          method,
          url: "",
          bodyLimit: 8192,
          exposeHeadRoute: false,
          handler: async (request, reply) => {
            let command: CartRuntimeCommand;
            let idempotencyKey: string | undefined;
            try {
              command = parseCommand(request, operation);
              if (action === "add")
                idempotencyKey = idempotencyKeySchema.parse(
                  singleHeader(request, "idempotency-key"),
                );
            } catch {
              return fail(reply, "INVALID_COMMAND");
            }
            const token = cookieToken(request);
            if (
              token === null ||
              (token === undefined && action !== "initialize")
            )
              return fail(reply, "INVALID_ACCESS");
            try {
              const issued =
                token === undefined
                  ? await options.credentials.issue()
                  : undefined;
              const proof =
                issued ??
                (await options.credentials.resolve(
                  token!,
                  singleHeader(request, "x-csrf-token"),
                ));
              if (action === "add" && !proof.csrfValid)
                return fail(reply, "INVALID_ACCESS", 403);
              const requestId =
                currentRequestContext()?.requestId ??
                resolveRequestId(singleHeader(request, "x-request-id"));
              const context: CartHttpTrustedContext = {
                schemaVersion: 1,
                accesses: cartRuntimeAccessesSchema.parse(
                  proof.accessCandidates,
                ),
                requestId,
                correlationId: requestId,
                ...(idempotencyKey ? { idempotencyKey } : {}),
              };
              const result = cartRuntimeCurrentResponseSchema.parse(
                await options.useCases[action](command, context),
              );
              if (result.outcome === "FAILURE") {
                if (result.code === "CART_EXPIRED") clearCookie(reply);
                return reply.code(failureStatus(result.code)).send(result);
              }
              if (
                result.cart.presentationLocale !== command.presentationLocale ||
                ("market" in command &&
                  (result.cart.market !== command.market ||
                    result.cart.currency !== command.currency)) ||
                (action === "initialize" && result.action !== "INITIALIZED") ||
                (action === "read" && result.action !== "READ") ||
                (action === "add" &&
                  !["ADDED", "REPLAYED"].includes(result.action))
              )
                throw new Error("Cart response mismatch");
              if (issued)
                void reply.header(
                  "set-cookie",
                  `${cookieName}=${issued.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${new Date(result.cart.expiresAt).toUTCString()}`,
                );
              void reply.header("x-csrf-token", proof.csrfToken);
              return reply.code(200).send(result);
            } catch {
              return fail(reply, "TEMPORARY_UNAVAILABLE");
            }
          },
        });
      },
      { prefix: path },
    );
  }
}
