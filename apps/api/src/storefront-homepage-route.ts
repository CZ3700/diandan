import { sendRevalidatedPublicJson } from "./public-revalidation-response.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  storefrontHomepageReadCommandSchema,
  storefrontHomepageResponseSchema,
  publishedContentFailureSchema,
  type PublishedContentFailure,
  type StorefrontHomepageResponse,
} from "@fan-support/contracts";

export type StorefrontHomepageRouteDependencies = Readonly<{
  useCases: Readonly<{
    execute(input: unknown): Promise<StorefrontHomepageResponse>;
  }>;
}>;
function securityHeaders(reply: FastifyReply): void {
  void reply
    .header("x-robots-tag", "noindex, nofollow")
    .header("referrer-policy", "no-referrer");
}
function privacy(reply: FastifyReply): void {
  securityHeaders(reply);
  void reply
    .header(
      "cache-control",
      reply.request.headers.cookie !== undefined ||
        reply.request.headers.authorization !== undefined
        ? "private, no-store"
        : "no-store",
    )
    .removeHeader("etag");
}
function failure(reply: FastifyReply, code: PublishedContentFailure["code"]) {
  privacy(reply);
  return reply
    .code(code === "INVALID_QUERY" ? 400 : code === "NOT_FOUND" ? 404 : 503)
    .send(
      publishedContentFailureSchema.parse({
        schemaVersion: 1,
        outcome: "FAILURE",
        code,
      }),
    );
}
export function registerStorefrontHomepageRoute(
  instance: FastifyInstance,
  options: StorefrontHomepageRouteDependencies,
): void {
  instance.register(async (scope) => {
    scope.addHook("onRequest", async (_request, reply) => {
      privacy(reply);
    });
    scope.addHook("onSend", async (_request, reply, payload) => {
      securityHeaders(reply);
      return payload;
    });
    scope.setErrorHandler((_error, _request, reply) =>
      failure(reply, "CONTENT_UNAVAILABLE"),
    );
    scope.get(
      "/api/v1/storefront-homepage",
      { exposeHeadRoute: false },
      async (request, reply) => {
        const raw = request.raw.url ?? "";
        const entries = [
          ...new URLSearchParams(raw.slice(raw.indexOf("?") + 1)),
        ];
        if (
          !raw.includes("?") ||
          entries.length !== 1 ||
          entries[0]?.[0] !== "locale"
        )
          return failure(reply, "INVALID_QUERY");
        const command = storefrontHomepageReadCommandSchema.safeParse({
          schemaVersion: 1,
          locale: entries[0][1],
        });
        if (!command.success) return failure(reply, "INVALID_QUERY");
        try {
          const result = storefrontHomepageResponseSchema.parse(
            await options.useCases.execute(command.data),
          );
          if (result.outcome === "FAILURE") return failure(reply, result.code);
          const locales = [
            result.homepage.content.view.localeContext,
            ...result.slots.flatMap((slot) =>
              slot.status === "AVAILABLE"
                ? [slot.content.content.view.localeContext]
                : [],
            ),
          ];
          if (
            locales.some(
              (locale) =>
                locale.requestedLocale !== command.data.locale ||
                locale.resolvedLocale !== command.data.locale ||
                locale.fallbackUsed,
            )
          )
            return failure(reply, "CONTENT_UNAVAILABLE");
          return sendRevalidatedPublicJson(request, reply, result, {
            resource: "storefront-homepage",
            query: command.data,
          });
        } catch {
          return failure(reply, "CONTENT_UNAVAILABLE");
        }
      },
    );
  });
}
