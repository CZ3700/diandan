import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  wishGalleryWithdrawCommandSchema,
  wishGalleryWithdrawResponseSchema,
  checkoutSessionIdSchema,
  deliveryProofRenditionNameSchema,
  publicOrderIdSchema,
  orderAccessBootstrapCommandSchema,
  orderAccessBootstrapRequestSchema,
  orderAccessConfigurationSchema,
  orderAccessExchangeCommandSchema,
  orderAccessExchangeRequestSchema,
  orderAccessFailureSchema,
  orderAccessLocateCommandSchema,
  orderAccessLocateRequestSchema,
  orderAccessProofCommandSchema,
  orderAccessRateResultSchema,
  orderAccessReadCommandSchema,
  orderAccessResponseSchema,
  orderAccessRevokeCommandSchema,
  orderAccessRevokeRequestSchema,
  type OrderAccessConfiguration,
  type OrderAccessFailureCode,
} from "@fan-support/contracts";
import { registerWishGalleryRoute } from "./wish-gallery-route.js";
import { resolveRequestId } from "@fan-support/observability";
import { currentRequestContext } from "@fan-support/observability/node";
import { cookieToken, privacy, singleHeader } from "./cart-route.js";
import type { createCartSessionCredentials } from "./cart-session-credentials.js";
import {
  isOrderAccessCredential,
  type createOrderAccessCredentials,
} from "./order-access-credentials.js";

type Action = "exchange" | "bootstrap" | "read" | "revoke" | "locate";
export type OrderAccessRouteDependencies = Readonly<{
  configuration: OrderAccessConfiguration;
  credentials: ReturnType<typeof createOrderAccessCredentials>;
  cartCredentials: ReturnType<typeof createCartSessionCredentials>;
  useCases: Record<
    Action | "consumeRateLimit",
    (command: unknown) => Promise<unknown>
  >;
  wishGallery?:
    | {
        read(command: unknown): Promise<unknown>;
        withdraw(command: unknown): Promise<unknown>;
      }
    | undefined;
  /** Session-authorized private delivery photo bytes; absent deployments answer 503. */
  readProof?: ((command: unknown) => Promise<unknown>) | undefined;
}>;
const proofResultSchema = z.union([
  z.strictObject({
    outcome: z.literal("FAILURE"),
    code: orderAccessFailureSchema.shape.code,
  }),
  z.strictObject({
    outcome: z.literal("SUCCESS"),
    mimeType: z.literal("image/webp"),
    bytes: z
      .instanceof(Uint8Array)
      .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= 4194304),
  }),
]);
const proofParamsSchema = z.strictObject({
  publicOrderId: publicOrderIdSchema,
  proofId: z.uuid(),
  rendition: deliveryProofRenditionNameSchema,
});
// Direct navigation to a photo renders an inert image document: no scripts, framing or sniffing.
const proofHeaders = {
  "content-type": "image/webp",
  "content-disposition": 'inline; filename="delivery-photo.webp"',
  "content-security-policy":
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox",
  "cross-origin-resource-policy": "same-origin",
  "x-content-type-options": "nosniff",
} as const;
const cookieName = "__Host-fan-order";
const attributes = "Path=/; HttpOnly; Secure; SameSite=Strict";
function status(code: OrderAccessFailureCode) {
  switch (code) {
    case "INVALID_REQUEST":
      return 400;
    case "ACCESS_DENIED":
      return 401;
    case "PAYMENT_NOT_CONFIRMED":
      return 409;
    case "RATE_LIMITED":
      return 429;
    case "TEMPORARY_UNAVAILABLE":
      return 503;
  }
}
function fail(
  reply: FastifyReply,
  code: OrderAccessFailureCode,
  httpStatus = status(code),
) {
  return reply.code(httpStatus).send(
    orderAccessFailureSchema.parse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code,
    }),
  );
}
function orderCookie(request: FastifyRequest): string | undefined {
  const header = singleHeader(request, "cookie");
  if (!header) return undefined;
  let token: string | undefined;
  for (const part of header.split(";")) {
    const offset = part.indexOf("=");
    if (offset < 1) return undefined;
    if (part.slice(0, offset).trim() !== cookieName) continue;
    if (token !== undefined) return undefined;
    token = part.slice(offset + 1).trim();
  }
  return isOrderAccessCredential(token) ? token : undefined;
}
function trace(request: FastifyRequest) {
  const requestId =
    currentRequestContext()?.requestId ??
    resolveRequestId(singleHeader(request, "x-request-id"));
  return { requestId, correlationId: requestId, taskName: "order-access-http" };
}

/** Access credentials never enter logs or business commands; reads cannot invoke financial use cases. */
export function registerOrderAccessRoute(
  app: FastifyInstance,
  options: OrderAccessRouteDependencies,
): void {
  const configuration = orderAccessConfigurationSchema.parse(
    options.configuration,
  );
  if (options.wishGallery) registerWishGalleryRoute(app, options.wishGallery);
  for (const [method, url, action, scopeName, limit] of [
    [
      "POST",
      "/api/v1/orders/:publicOrderId/wish-gallery/:entryId/withdraw",
      "wish-withdraw",
      "REVOKE",
      configuration.rateLimit.revokeMax,
    ],
    [
      "POST",
      "/api/v1/order-access/exchange",
      "exchange",
      "EXCHANGE",
      configuration.rateLimit.exchangeMax,
    ],
    [
      "POST",
      "/api/v1/checkout/sessions/:checkoutSessionId/order-access",
      "bootstrap",
      "BOOTSTRAP",
      configuration.rateLimit.bootstrapMax,
    ],
    [
      "GET",
      "/api/v1/orders/:publicOrderId",
      "read",
      "READ",
      configuration.rateLimit.readMax,
    ],
    [
      "POST",
      "/api/v1/order-access/revoke",
      "revoke",
      "REVOKE",
      configuration.rateLimit.revokeMax,
    ],
    // Locating is a read-class lookup and shares the READ bucket with protected reads.
    [
      "POST",
      "/api/v1/order-access/locate",
      "locate",
      "READ",
      configuration.rateLimit.readMax,
    ],
    // Each delivery photo read is a protected read of the same order.
    [
      "GET",
      "/api/v1/orders/:publicOrderId/delivery-proofs/:proofId/:rendition",
      "proof",
      "READ",
      configuration.rateLimit.readMax,
    ],
  ] as const)
    void app.register(async (scope) => {
      scope.addHook("onRequest", async (request, reply) => {
        privacy(reply);
        if (
          ((method === "POST" || request.headers.origin !== undefined) &&
            singleHeader(request, "origin") !==
              configuration.publicStorefrontOrigin) ||
          (request.headers["sec-fetch-site"] !== undefined &&
            !["same-origin", "none"].includes(
              singleHeader(request, "sec-fetch-site") ?? "",
            ))
        )
          return fail(reply, "ACCESS_DENIED", 403);
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
          return fail(reply, "INVALID_REQUEST");
        try {
          // The TCP peer, or the nearest address forwarded through FAN_SUPPORT_TRUSTED_PROXY_CIDRS only.
          const networkIdentity = request.ip;
          if (!networkIdentity) return fail(reply, "TEMPORARY_UNAVAILABLE");
          const rate = orderAccessRateResultSchema.parse(
            await options.useCases.consumeRateLimit({
              schemaVersion: 1,
              scope: scopeName,
              bucket:
                await options.credentials.rateLimitAccess(networkIdentity),
              windowSeconds: configuration.rateLimit.windowSeconds,
              maxRequests: limit,
            }),
          );
          if (!rate.allowed) {
            void reply.header("retry-after", String(rate.retryAfterSeconds));
            return fail(reply, "RATE_LIMITED");
          }
        } catch {
          return fail(reply, "TEMPORARY_UNAVAILABLE");
        }
      });
      scope.addHook("onSend", async (_request, reply, payload) => {
        privacy(reply);
        return payload;
      });
      scope.setErrorHandler((error, _request, reply) => {
        const parsed = error as { code?: string; statusCode?: number };
        if (parsed.code === "FST_ERR_CTP_BODY_TOO_LARGE")
          return fail(reply, "INVALID_REQUEST", 413);
        if (
          parsed.statusCode &&
          parsed.statusCode >= 400 &&
          parsed.statusCode < 500
        )
          return fail(reply, "INVALID_REQUEST");
        return fail(reply, "TEMPORARY_UNAVAILABLE");
      });
      scope.route({
        method,
        url,
        bodyLimit: 1024,
        exposeHeadRoute: false,
        handler: async (request, reply) => {
          if (action === "proof") {
            const params = proofParamsSchema.safeParse(request.params);
            if (!params.success || request.body !== undefined)
              return fail(reply, "INVALID_REQUEST");
            try {
              const token = orderCookie(request);
              if (!token) return fail(reply, "ACCESS_DENIED");
              if (!options.readProof)
                return fail(reply, "TEMPORARY_UNAVAILABLE");
              const proof = await options.credentials.resolveSession(
                token,
                undefined,
              );
              const result = proofResultSchema.parse(
                await options.readProof(
                  orderAccessProofCommandSchema.parse({
                    schemaVersion: 1,
                    ...params.data,
                    sessionCandidates: proof.accesses,
                  }),
                ),
              );
              if (result.outcome === "FAILURE") return fail(reply, result.code);
              const bytes = Buffer.from(
                result.bytes.buffer,
                result.bytes.byteOffset,
                result.bytes.byteLength,
              );
              return reply
                .code(200)
                .headers({
                  ...proofHeaders,
                  "content-length": String(bytes.byteLength),
                })
                .send(bytes);
            } catch {
              return fail(reply, "TEMPORARY_UNAVAILABLE");
            }
          }
          if (action === "wish-withdraw") {
            const params = z
              .strictObject({
                publicOrderId: publicOrderIdSchema,
                entryId: z.uuid(),
              })
              .safeParse(request.params);
            if (
              !params.success ||
              !orderAccessBootstrapRequestSchema.safeParse(request.body).success
            )
              return fail(reply, "INVALID_REQUEST");
            try {
              const token = orderCookie(request);
              if (!token) return fail(reply, "ACCESS_DENIED");
              const proof = await options.credentials.resolveSession(
                token,
                singleHeader(request, "x-csrf-token"),
              );
              if (!proof.csrfValid) return fail(reply, "ACCESS_DENIED", 403);
              if (!options.wishGallery)
                return fail(reply, "TEMPORARY_UNAVAILABLE");
              const result = wishGalleryWithdrawResponseSchema.parse(
                await options.wishGallery.withdraw(
                  wishGalleryWithdrawCommandSchema.parse({
                    schemaVersion: 1,
                    ...params.data,
                    sessionCandidates: proof.accesses,
                    ...trace(request),
                  }),
                ),
              );
              if (result.outcome === "FAILURE") return fail(reply, result.code);
              if (
                result.withdrawn.entryId.toLowerCase() !==
                params.data.entryId.toLowerCase()
              )
                return fail(reply, "TEMPORARY_UNAVAILABLE");
              return reply.code(200).send(result);
            } catch {
              return fail(reply, "TEMPORARY_UNAVAILABLE");
            }
          }
          let input:
            | { token: string }
            | { publicOrderId: string }
            | { publicOrderNo: string }
            | undefined;
          try {
            if (action === "read")
              publicOrderIdSchema.parse(
                (request.params as { publicOrderId: string }).publicOrderId,
              );
            if (action === "bootstrap")
              checkoutSessionIdSchema.parse(
                (request.params as { checkoutSessionId: string })
                  .checkoutSessionId,
              );
            if (action === "exchange")
              input = orderAccessExchangeRequestSchema.parse(request.body);
            else if (action === "bootstrap")
              orderAccessBootstrapRequestSchema.parse(request.body);
            else if (action === "revoke")
              input = orderAccessRevokeRequestSchema.parse(request.body);
            else if (action === "locate")
              input = orderAccessLocateRequestSchema.parse(request.body);
            else if (request.body !== undefined)
              return fail(reply, "INVALID_REQUEST");
          } catch {
            return fail(reply, "INVALID_REQUEST");
          }
          try {
            let command: unknown;
            let issued:
              | Awaited<ReturnType<typeof options.credentials.issueSession>>
              | undefined;
            let csrfToken: string | undefined;
            if (action === "exchange") {
              const tokenCandidates = await options.credentials.resolveLink(
                (input as { token: string }).token,
              );
              issued = await options.credentials.issueSession();
              command = orderAccessExchangeCommandSchema.parse({
                schemaVersion: 1,
                tokenCandidates,
                sessionCredential: issued.access,
                sessionTtlSeconds: configuration.sessionTtlSeconds,
                ...trace(request),
              });
            } else if (action === "bootstrap") {
              const token = cookieToken(request);
              if (!token) return fail(reply, "ACCESS_DENIED");
              const proof = await options.cartCredentials.resolve(
                token,
                singleHeader(request, "x-csrf-token"),
              );
              if (!proof.csrfValid) return fail(reply, "ACCESS_DENIED", 403);
              issued = await options.credentials.issueSession();
              const link = await options.credentials.issueLink();
              command = orderAccessBootstrapCommandSchema.parse({
                schemaVersion: 1,
                checkoutSessionId: (
                  request.params as { checkoutSessionId: string }
                ).checkoutSessionId,
                cartAccesses: proof.accessCandidates,
                tokenCredential: link.access,
                sessionCredential: issued.access,
                sessionTtlSeconds: configuration.sessionTtlSeconds,
                ...trace(request),
              });
            } else {
              const token = orderCookie(request);
              if (!token) return fail(reply, "ACCESS_DENIED");
              const proof = await options.credentials.resolveSession(
                token,
                singleHeader(request, "x-csrf-token"),
              );
              if (action === "revoke" && !proof.csrfValid)
                return fail(reply, "ACCESS_DENIED", 403);
              csrfToken = proof.csrfToken;
              command =
                action === "locate"
                  ? orderAccessLocateCommandSchema.parse({
                      schemaVersion: 1,
                      publicOrderNo: (input as { publicOrderNo: string })
                        .publicOrderNo,
                      sessionCandidates: proof.accesses,
                    })
                  : action === "read"
                    ? orderAccessReadCommandSchema.parse({
                        schemaVersion: 1,
                        publicOrderId: (
                          request.params as { publicOrderId: string }
                        ).publicOrderId,
                        sessionCandidates: proof.accesses,
                      })
                    : orderAccessRevokeCommandSchema.parse({
                        schemaVersion: 1,
                        publicOrderId: (input as { publicOrderId: string })
                          .publicOrderId,
                        sessionCandidates: proof.accesses,
                        ...trace(request),
                      });
            }
            const result = orderAccessResponseSchema.parse(
              await options.useCases[action](command),
            );
            if (result.outcome === "FAILURE")
              return reply.code(status(result.code)).send(result);
            if (action === "exchange" || action === "bootstrap") {
              if (result.action !== "GRANTED" || !issued)
                throw new Error("Order access response mismatch");
              void reply.header(
                "set-cookie",
                `${cookieName}=${issued.token}; ${attributes}; Expires=${new Date(result.grant.expiresAt).toUTCString()}`,
              );
              void reply.header("x-csrf-token", issued.csrfToken);
            } else if (action === "read") {
              const publicOrderId = (
                request.params as { publicOrderId: string }
              ).publicOrderId;
              if (
                result.action !== "READ" ||
                result.order.publicOrderId.toLowerCase() !==
                  publicOrderId.toLowerCase()
              )
                throw new Error("Order access response mismatch");
              void reply.header("x-csrf-token", csrfToken!);
            } else if (action === "locate") {
              // Only an identifier leaves; no cookie or CSRF proof is issued or echoed.
              if (result.action !== "LOCATED")
                throw new Error("Order access response mismatch");
            } else {
              if (
                result.action !== "REVOKED" ||
                result.publicOrderId.toLowerCase() !==
                  (
                    input as { publicOrderId: string }
                  ).publicOrderId.toLowerCase()
              )
                throw new Error("Order access response mismatch");
              void reply.header(
                "set-cookie",
                `${cookieName}=; ${attributes}; Max-Age=0`,
              );
            }
            return reply.code(200).send(result);
          } catch {
            return fail(reply, "TEMPORARY_UNAVAILABLE");
          }
        },
      });
    });
}
