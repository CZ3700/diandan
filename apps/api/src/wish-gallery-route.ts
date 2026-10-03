import type { FastifyInstance, FastifyReply } from "fastify";
import {
  wishGalleryReadCommandSchema,
  wishGalleryReadResponseSchema,
  type WishGalleryFailureCode,
} from "@fan-support/contracts";

export type WishGalleryRouteDependencies = {
  read(command: unknown): Promise<unknown>;
};
function failure(reply: FastifyReply, code: WishGalleryFailureCode) {
  const status =
    code === "INVALID_REQUEST"
      ? 400
      : code === "ACCESS_DENIED"
        ? 403
        : code === "RATE_LIMITED"
          ? 429
          : 503;
  return reply
    .code(status)
    .send({ schemaVersion: 1, outcome: "FAILURE", code });
}
function query(rawUrl: string) {
  const command: Record<string, unknown> = { schemaVersion: 1 };
  const seen = new Set<string>();
  const search = new URLSearchParams(
    rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?") + 1) : "",
  );
  for (const [key, value] of search) {
    if (!["locale", "idol", "limit", "cursor"].includes(key) || seen.has(key))
      return undefined;
    seen.add(key);
    if (key === "limit") {
      if (!/^[1-9]\d?$/u.test(value)) return undefined;
      command[key] = Number(value);
    } else command[key === "idol" ? "idolId" : key] = value;
  }
  return command;
}
/** Public, consent-filtered projection: no order session or personal checkout fields. */
export function registerWishGalleryRoute(
  app: FastifyInstance,
  options: WishGalleryRouteDependencies,
): void {
  app.register(async (scope) => {
    scope.addHook("onRequest", async (_request, reply) => {
      void reply
        .header("cache-control", "no-store")
        .header("x-content-type-options", "nosniff");
    });
    scope.setErrorHandler((_error, _request, reply) =>
      failure(reply, "TEMPORARY_UNAVAILABLE"),
    );
    scope.route({
      method: "GET",
      url: "/api/v1/storefront/wish-gallery",
      exposeHeadRoute: false,
      handler: async (request, reply) => {
        const command = wishGalleryReadCommandSchema.safeParse(
          query(request.raw.url ?? ""),
        );
        if (
          !command.success ||
          request.body !== undefined ||
          request.headers["transfer-encoding"] !== undefined ||
          (request.headers["content-length"] !== undefined &&
            request.headers["content-length"] !== "0")
        )
          return failure(reply, "INVALID_REQUEST");
        try {
          const result = wishGalleryReadResponseSchema.parse(
            await options.read(command.data),
          );
          if (result.outcome === "FAILURE") return failure(reply, result.code);
          const entries = result.page.entries;
          if (
            entries.length > (command.data.limit ?? 20) ||
            new Set(entries.map((entry) => entry.entryId.toLowerCase()))
              .size !== entries.length
          )
            return failure(reply, "TEMPORARY_UNAVAILABLE");
          return reply.code(200).send(result);
        } catch {
          return failure(reply, "TEMPORARY_UNAVAILABLE");
        }
      },
    });
  });
}
