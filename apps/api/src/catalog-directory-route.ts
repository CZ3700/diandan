import type { FastifyInstance, FastifyReply } from "fastify";
import { sendRevalidatedPublicJson } from "./public-revalidation-response.js";
import { matchesPublicContentLocale } from "./public-content-locale.js";
import {
  catalogDirectoryFailureSchema,
  giftDirectoryResponseSchema,
  giftDiscoveryQuerySchema,
  idolDirectoryResponseSchema,
  idolDiscoveryQuerySchema,
  type CatalogDirectoryFailure,
  type GiftDirectoryResponse,
  type IdolDirectoryResponse,
} from "@fan-support/contracts";

export type CatalogDirectoryRouteOptions = Readonly<{
  readIdols(input: unknown): Promise<IdolDirectoryResponse>;
  readGifts(input: unknown): Promise<GiftDirectoryResponse>;
}>;

const IDOL_QUERY_FIELDS = new Set([
  "locale",
  "q",
  "limit",
  "after",
  "anchorId",
]);
const GIFT_QUERY_FIELDS = new Set([
  "locale",
  "market",
  "currency",
  "idol",
  "page",
  "pageSize",
  "sort",
  "category",
  "priceMinMinor",
  "priceMaxMinor",
  "availability",
]);
const NUMERIC_QUERY_FIELDS = new Set([
  "limit",
  "page",
  "pageSize",
  "priceMinMinor",
  "priceMaxMinor",
]);

function parseQuery(
  rawUrl: string,
  fields: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  const entries = new URLSearchParams(rawUrl.slice(rawUrl.indexOf("?") + 1));
  const query: Record<string, unknown> = { schemaVersion: 1 };
  const seen = new Set<string>();
  if (!rawUrl.includes("?")) return query;
  for (const [key, value] of entries) {
    if (!fields.has(key) || seen.has(key)) return undefined;
    seen.add(key);
    if (NUMERIC_QUERY_FIELDS.has(key)) {
      if (!/^(?:0|[1-9]\d{0,15})$/u.test(value)) return undefined;
      const numeric = Number(value);
      if (!Number.isSafeInteger(numeric)) return undefined;
      query[key] = numeric;
    } else {
      query[key === "idol" ? "idolId" : key] = value;
    }
  }
  return query;
}

function statusForFailure(code: CatalogDirectoryFailure["code"]): number {
  switch (code) {
    case "ANCHOR_NOT_FOUND":
      return 404;
    case "CATALOG_CHANGED":
      return 409;
    case "CATALOG_UNAVAILABLE":
      return 503;
    default:
      return 400;
  }
}

function sendFailure(
  reply: FastifyReply,
  code: CatalogDirectoryFailure["code"],
) {
  privacy(reply);
  return reply.code(statusForFailure(code)).send(
    catalogDirectoryFailureSchema.parse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code,
    }),
  );
}

function privacy(reply: FastifyReply): void {
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

export function registerCatalogDirectoryRoute(
  instance: FastifyInstance,
  options: CatalogDirectoryRouteOptions,
): void {
  instance.register(async (scope) => {
    scope.addHook("onRequest", async (_request, reply) => {
      privacy(reply);
    });
    scope.setErrorHandler((_error, _request, reply) =>
      sendFailure(reply, "CATALOG_UNAVAILABLE"),
    );
    scope.get("/api/v1/idols", async (request, reply) => {
      const query = idolDiscoveryQuerySchema.safeParse(
        parseQuery(request.raw.url ?? "", IDOL_QUERY_FIELDS),
      );
      if (!query.success) return sendFailure(reply, "INVALID_QUERY");
      try {
        const response = idolDirectoryResponseSchema.parse(
          await options.readIdols(query.data),
        );
        if (response.outcome === "FAILURE")
          return sendFailure(reply, response.code);
        if (
          response.items.length > query.data.limit ||
          new Set(response.items.map((item) => item.id.toLowerCase())).size !==
            response.items.length ||
          response.items.some(
            (item) =>
              !matchesPublicContentLocale(
                item.localeContext,
                query.data.locale,
              ),
          )
        )
          return sendFailure(reply, "CATALOG_UNAVAILABLE");
        return sendRevalidatedPublicJson(request, reply, response, {
          resource: "idol-directory",
          query: query.data,
        });
      } catch {
        return sendFailure(reply, "CATALOG_UNAVAILABLE");
      }
    });
    scope.get("/api/v1/gifts", async (request, reply) => {
      const query = giftDiscoveryQuerySchema.safeParse(
        parseQuery(request.raw.url ?? "", GIFT_QUERY_FIELDS),
      );
      if (!query.success) return sendFailure(reply, "INVALID_QUERY");
      try {
        const response = giftDirectoryResponseSchema.parse(
          await options.readGifts(query.data),
        );
        if (response.outcome === "FAILURE")
          return sendFailure(reply, response.code);
        if (
          response.pageInfo.page !== query.data.page ||
          response.pageInfo.pageSize !== query.data.pageSize ||
          response.items.length !==
            Math.max(
              0,
              Math.min(
                query.data.pageSize,
                response.pageInfo.totalItems -
                  (query.data.page - 1) * query.data.pageSize,
              ),
            ) ||
          new Set(response.items.map((item) => item.gift.id.toLowerCase()))
            .size !== response.items.length ||
          response.items.some(
            (item) =>
              item.offer.market !== query.data.market ||
              item.offer.currency !== query.data.currency ||
              !matchesPublicContentLocale(
                item.gift.localeContext,
                query.data.locale,
              ),
          )
        )
          return sendFailure(reply, "CATALOG_UNAVAILABLE");
        return sendRevalidatedPublicJson(request, reply, response, {
          resource: "gift-directory",
          query: query.data,
        });
      } catch {
        return sendFailure(reply, "CATALOG_UNAVAILABLE");
      }
    });
  });
}
