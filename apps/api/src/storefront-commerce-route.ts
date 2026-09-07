import type { FastifyInstance, FastifyReply } from "fastify";
import {
  storefrontContextResponseSchema,
  storefrontGiftReadCommandSchema,
  storefrontGiftResponseSchema,
  type StorefrontContextResponse,
  type StorefrontGiftResponse,
} from "@fan-support/contracts";

export type StorefrontCommerceRouteDependencies = Readonly<{
  useCases: Readonly<{
    readContext(input: unknown): Promise<StorefrontContextResponse>;
    readGift(input: unknown): Promise<StorefrontGiftResponse>;
  }>;
}>;
type Failure = Extract<
  StorefrontContextResponse | StorefrontGiftResponse,
  { outcome: "FAILURE" }
>;
function privacy(reply: FastifyReply) {
  void reply
    .header("cache-control", "no-store")
    .header("x-robots-tag", "noindex, nofollow")
    .header("referrer-policy", "no-referrer");
}
function failure(reply: FastifyReply, code: Failure["code"]) {
  privacy(reply);
  return reply
    .code(
      code === "INVALID_QUERY"
        ? 400
        : code === "NOT_FOUND"
          ? 404
          : code === "MARKET_UNAVAILABLE"
            ? 409
            : 503,
    )
    .send({ schemaVersion: 1, outcome: "FAILURE", code });
}
export function registerStorefrontCommerceRoute(
  instance: FastifyInstance,
  options: StorefrontCommerceRouteDependencies,
): void {
  instance.register(async (scope) => {
    scope.addHook("onRequest", async (_request, reply) => {
      privacy(reply);
    });
    scope.addHook("onSend", async (_request, reply, payload) => {
      privacy(reply);
      return payload;
    });
    scope.setErrorHandler((_error, request, reply) =>
      failure(
        reply,
        request.url.split("?")[0] === "/api/v1/storefront-context"
          ? "COMMERCE_UNAVAILABLE"
          : "CONTENT_UNAVAILABLE",
      ),
    );
    scope.get(
      "/api/v1/storefront-context",
      { exposeHeadRoute: false },
      async (request, reply) => {
        const raw = request.raw.url ?? "";
        if (
          raw.includes("?") &&
          [...new URLSearchParams(raw.slice(raw.indexOf("?") + 1))].length !== 0
        )
          return failure(reply, "INVALID_QUERY");
        try {
          const result = storefrontContextResponseSchema.parse(
            await options.useCases.readContext({ schemaVersion: 1 }),
          );
          return result.outcome === "FAILURE"
            ? failure(reply, result.code)
            : reply.send(result);
        } catch {
          return failure(reply, "COMMERCE_UNAVAILABLE");
        }
      },
    );
    scope.get(
      "/api/v1/storefront-gifts/:handle",
      { exposeHeadRoute: false },
      async (request, reply) => {
        const raw = request.raw.url ?? "";
        const entries = raw.includes("?")
          ? [...new URLSearchParams(raw.slice(raw.indexOf("?") + 1))]
          : [];
        if (
          entries.some(
            ([key]) => !["locale", "market", "currency", "idol"].includes(key),
          ) ||
          new Set(entries.map(([key]) => key)).size !== entries.length
        )
          return failure(reply, "INVALID_QUERY");
        const values = Object.fromEntries(entries);
        const command = storefrontGiftReadCommandSchema.safeParse({
          schemaVersion: 1,
          handle: (request.params as Record<string, unknown>)["handle"],
          locale: values["locale"],
          market: values["market"],
          currency: values["currency"],
          ...(values["idol"] === undefined ? {} : { idolId: values["idol"] }),
        });
        if (!command.success) return failure(reply, "INVALID_QUERY");
        try {
          const result = storefrontGiftResponseSchema.parse(
            await options.useCases.readGift(command.data),
          );
          if (result.outcome === "FAILURE") return failure(reply, result.code);
          const recipient = result.recipient;
          const contexts = [
            result.content.view.localeContext,
            ...(recipient.kind === "PUBLISHED"
              ? [recipient.idol.localeContext]
              : []),
          ];
          if (
            result.content.view.handle !== command.data.handle ||
            result.market !== command.data.market ||
            result.currency !== command.data.currency ||
            contexts.some(
              (locale) =>
                locale.requestedLocale !== command.data.locale ||
                locale.resolvedLocale !== command.data.locale ||
                locale.fallbackUsed,
            ) ||
            (recipient.kind === "NONE"
              ? command.data.idolId !== undefined
              : command.data.idolId === undefined ||
                (recipient.kind === "PUBLISHED"
                  ? recipient.idol.id
                  : recipient.idolId
                ).toLowerCase() !== command.data.idolId.toLowerCase())
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
