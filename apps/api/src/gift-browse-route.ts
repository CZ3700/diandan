import type { FastifyInstance, FastifyReply } from "fastify";
import {
  catalogDirectoryFailureSchema,
  giftBrowseQuerySchema,
  giftBrowseResponseSchema,
  type CatalogDirectoryFailure,
  type GiftBrowseResponse,
} from "@fan-support/contracts";
import { sendRevalidatedPublicJson } from "./public-revalidation-response.js";
import { matchesPublicContentLocale } from "./public-content-locale.js";

export type GiftBrowseRouteOptions = Readonly<{
  browseGifts(input: unknown): Promise<GiftBrowseResponse>;
}>;
const fields = new Set([
  "locale",
  "page",
  "pageSize",
  "category",
  "kind",
  "idol",
]);
function parseQuery(rawUrl: string) {
  const values: Record<string, unknown> = { schemaVersion: 1 };
  const seen = new Set<string>();
  if (!rawUrl.includes("?")) return values;
  for (const [key, value] of new URLSearchParams(
    rawUrl.slice(rawUrl.indexOf("?") + 1),
  )) {
    if (!fields.has(key) || seen.has(key)) return undefined;
    seen.add(key);
    if (key === "page" || key === "pageSize") {
      if (
        !/^(?:0|[1-9]\d{0,15})$/u.test(value) ||
        !Number.isSafeInteger(Number(value))
      )
        return undefined;
      values[key] = Number(value);
    } else values[key === "idol" ? "idolId" : key] = value;
  }
  return values;
}
function privacy(reply: FastifyReply) {
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
function failure(reply: FastifyReply, code: CatalogDirectoryFailure["code"]) {
  privacy(reply);
  const status =
    code === "CATALOG_UNAVAILABLE"
      ? 503
      : code === "ANCHOR_NOT_FOUND"
        ? 404
        : code === "CATALOG_CHANGED"
          ? 409
          : 400;
  return reply.code(status).send(
    catalogDirectoryFailureSchema.parse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code,
    }),
  );
}

/** Read-only published content is available before a shopper chooses commerce context. */
export function registerGiftBrowseRoute(
  instance: FastifyInstance,
  options: GiftBrowseRouteOptions,
): void {
  instance.register(async (scope) => {
    scope.addHook("onRequest", async (_request, reply) => {
      privacy(reply);
    });
    scope.setErrorHandler((_error, _request, reply) =>
      failure(reply, "CATALOG_UNAVAILABLE"),
    );
    scope.get("/api/v1/gift-browse", async (request, reply) => {
      const query = giftBrowseQuerySchema.safeParse(
        parseQuery(request.raw.url ?? ""),
      );
      if (!query.success) return failure(reply, "INVALID_QUERY");
      try {
        const result = giftBrowseResponseSchema.parse(
          await options.browseGifts(query.data),
        );
        if (result.outcome === "FAILURE") return failure(reply, result.code);
        if (
          result.pageInfo.page !== query.data.page ||
          result.pageInfo.pageSize !== query.data.pageSize ||
          result.items.some(
            (gift) =>
              !matchesPublicContentLocale(
                gift.localeContext,
                query.data.locale,
              ) ||
              (gift.localeContext.schemaVersion === 1 &&
                gift.localeContext.fallbackUsed &&
                !gift.localeContext.translationRevision?.trim()) ||
              (query.data.category !== undefined &&
                gift.category !== query.data.category) ||
              (query.data.kind !== undefined &&
                gift.giftKind !== query.data.kind),
          )
        )
          return failure(reply, "CATALOG_UNAVAILABLE");
        return sendRevalidatedPublicJson(request, reply, result, {
          resource: "gift-browse",
          query: query.data,
        });
      } catch {
        return failure(reply, "CATALOG_UNAVAILABLE");
      }
    });
  });
}
