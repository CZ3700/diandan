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
function privacy(reply: FastifyReply) {
  void reply
    .header("cache-control", "no-store")
    .header("x-robots-tag", "noindex, nofollow")
    .header("referrer-policy", "no-referrer");
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
      privacy(reply);
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
          return reply.send(result);
        } catch {
          return failure(reply, "CONTENT_UNAVAILABLE");
        }
      },
    );
  });
}
