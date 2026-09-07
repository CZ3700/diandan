import type { FastifyInstance, FastifyReply } from "fastify";
import {
  storefrontSeoReadCommandSchema,
  storefrontSeoResponseSchema,
  storefrontSeoFailureSchema,
  type StorefrontSeoFailure,
  type StorefrontSeoLocator,
  type StorefrontSeoResponse,
} from "@fan-support/contracts";
import { sendRevalidatedPublicJson } from "./public-revalidation-response.js";

export type StorefrontSeoRouteDependencies = Readonly<{
  useCases: Readonly<{
    execute(input: unknown): Promise<StorefrontSeoResponse>;
  }>;
}>;
function privacy(reply: FastifyReply) {
  void reply
    .header("x-robots-tag", "noindex, nofollow")
    .header("referrer-policy", "no-referrer");
}
function failure(reply: FastifyReply, code: StorefrontSeoFailure["code"]) {
  privacy(reply);
  return reply
    .header(
      "cache-control",
      reply.request.headers.cookie !== undefined ||
        reply.request.headers.authorization !== undefined
        ? "private, no-store"
        : "no-store",
    )
    .removeHeader("etag")
    .code(
      code === "NOT_FOUND"
        ? 404
        : code === "CATALOG_CHANGED"
          ? 409
          : code === "CONTENT_UNAVAILABLE"
            ? 503
            : 400,
    )
    .send(
      storefrontSeoFailureSchema.parse({
        schemaVersion: 1,
        outcome: "FAILURE",
        code,
      }),
    );
}
function sameLocator(left: StorefrontSeoLocator, right: StorefrontSeoLocator) {
  return (
    left.kind === right.kind &&
    (left.kind === "HOMEPAGE" ||
      (left.kind === "POLICY"
        ? right.kind === "POLICY" && left.policyKey === right.policyKey
        : (right.kind === "IDOL" || right.kind === "GIFT") &&
          left.handle === right.handle))
  );
}
export function registerStorefrontSeoRoute(
  instance: FastifyInstance,
  options: StorefrontSeoRouteDependencies,
): void {
  instance.register(async (scope) => {
    scope.addHook("onRequest", async (_request, reply) => {
      privacy(reply);
    });
    scope.addHook("onSend", async (_request, reply, payload) => {
      privacy(reply);
      return payload;
    });
    scope.setErrorHandler((_error, _request, reply) =>
      failure(reply, "CONTENT_UNAVAILABLE"),
    );
    for (const operation of ["ENTITY", "INDEX", "CATALOG"] as const)
      scope.get(
        `/api/v1/storefront-seo/${operation.toLowerCase()}`,
        { exposeHeadRoute: false },
        async (request, reply) => {
          const raw = request.raw.url ?? "";
          const entries = [
            ...new URLSearchParams(
              raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : "",
            ),
          ];
          if (new Set(entries.map(([key]) => key)).size !== entries.length)
            return failure(reply, "INVALID_QUERY");
          const query = Object.fromEntries(entries);
          const command = storefrontSeoReadCommandSchema.safeParse({
            schemaVersion: 1,
            operation,
            ...(operation === "ENTITY" ? { locator: query } : query),
          });
          if (!command.success) return failure(reply, "INVALID_QUERY");
          try {
            const result = storefrontSeoResponseSchema.parse(
              await options.useCases.execute(command.data),
            );
            if (result.outcome === "FAILURE")
              return failure(reply, result.code);
            if (
              result.kind !== `STOREFRONT_SEO_${operation}` ||
              (command.data.operation === "ENTITY" &&
                (result.kind !== "STOREFRONT_SEO_ENTITY" ||
                  !sameLocator(command.data.locator, result.entity.locator)))
            )
              return failure(reply, "CONTENT_UNAVAILABLE");
            return sendRevalidatedPublicJson(request, reply, result, {
              resource: "storefront-seo",
              query: command.data,
            });
          } catch {
            return failure(reply, "CONTENT_UNAVAILABLE");
          }
        },
      );
  });
}
