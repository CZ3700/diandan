import type { FastifyInstance, FastifyReply } from "fastify";
import {
  publishedGiftCommerceReadCommandSchema,
  publishedGiftCommerceResponseSchema,
  type PublishedGiftCommerceResponse,
  type PublishedContentFailure,
} from "@fan-support/contracts";
export type PublishedGiftCommerceRouteDependencies = Readonly<{
  useCases: Readonly<{
    execute(input: unknown): Promise<PublishedGiftCommerceResponse>;
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
    .send({ schemaVersion: 1, outcome: "FAILURE", code });
}
export function registerPublishedGiftCommerceRoute(
  instance: FastifyInstance,
  { useCases }: PublishedGiftCommerceRouteDependencies,
) {
  instance.register(
    async (scope) => {
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
      scope.setNotFoundHandler((_request, reply) =>
        failure(reply, "NOT_FOUND"),
      );
      scope.get("", { exposeHeadRoute: false }, async (request, reply) => {
        const url = request.raw.url ?? "";
        const entries = [
          ...new URLSearchParams(
            url.includes("?") ? url.slice(url.indexOf("?") + 1) : "",
          ),
        ];
        if (entries.length !== 1 || entries[0]?.[0] !== "locale")
          return failure(reply, "INVALID_QUERY");
        const command = publishedGiftCommerceReadCommandSchema.safeParse({
          schemaVersion: 1,
          locator: {
            ...(request.params as Record<string, unknown>),
            kind: "GIFT",
          },
          locale: entries[0][1],
        });
        if (!command.success) return failure(reply, "INVALID_QUERY");
        try {
          const response = publishedGiftCommerceResponseSchema.parse(
            await useCases.execute(command.data),
          );
          if (response.outcome === "FAILURE")
            return failure(reply, response.code);
          const view = response.content.view;
          if (
            view.handle !== command.data.locator.handle ||
            view.localeContext.requestedLocale !== command.data.locale ||
            view.localeContext.resolvedLocale !== command.data.locale ||
            view.localeContext.fallbackUsed
          )
            return failure(reply, "CONTENT_UNAVAILABLE");
          return reply.send(response);
        } catch {
          return failure(reply, "CONTENT_UNAVAILABLE");
        }
      });
    },
    { prefix: "/api/v1/gift-content/:handle" },
  );
}
