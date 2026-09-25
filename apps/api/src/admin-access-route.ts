import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AdminAccessUseCases } from "@fan-support/application";
import {
  adminAccessBeginRequestSchema,
  adminAccessBeginResponseSchema,
  adminAccessCallbackRequestSchema,
  adminAccessCallbackResponseSchema,
  adminAccessLogoutRequestSchema,
  adminAccessLogoutResponseSchema,
  type AdminAccessFailure,
} from "@fan-support/contracts";
export type AdminAccessRouteDependencies = Readonly<{
  allowedOrigin: string;
  accessKey: string;
  useCases: AdminAccessUseCases;
}>;
function privacy(reply: FastifyReply) {
  void reply
    .header("cache-control", "private, no-store")
    .header("referrer-policy", "no-referrer")
    .header("x-robots-tag", "noindex, nofollow")
    .header("x-content-type-options", "nosniff");
}
function fail(
  reply: FastifyReply,
  code: AdminAccessFailure["code"],
  status: number,
) {
  return reply
    .code(status)
    .send({ schemaVersion: 1, outcome: "FAILURE", code });
}
function single(request: FastifyRequest, key: string): string | undefined {
  let count = 0;
  for (let i = 0; i < request.raw.rawHeaders.length; i += 2)
    if (request.raw.rawHeaders[i]?.toLowerCase() === key) count++;
  const value = request.headers[key];
  return count === 1 && typeof value === "string" ? value : undefined;
}
function status(code: string): number {
  switch (code) {
    case "ACCESS_UNAVAILABLE":
      return 503;
    case "INVALID_COMMAND":
      return 400;
    case "UNAUTHENTICATED":
      return 401;
    default:
      return 403;
  }
}
/** Private BFF-to-API commands; the browser callback is isolated in the Admin BFF. */
export function registerAdminAccessRoute(
  instance: FastifyInstance,
  options: AdminAccessRouteDependencies,
): void {
  const origin = new URL(options.allowedOrigin);
  if (
    origin.origin !== options.allowedOrigin ||
    origin.protocol !== "https:" ||
    !/^[a-f0-9]{64}$/u.test(options.accessKey)
  )
    throw new TypeError("Invalid admin access transport configuration");
  void instance.register(
    async (scope) => {
      scope.addHook("onRequest", async (request, reply) => {
        privacy(reply);
        if ((request.raw.url ?? "").includes("?"))
          return fail(reply, "INVALID_COMMAND", 400);
        const key = single(request, "x-admin-access-key");
        if (
          !key ||
          !/^[a-f0-9]{64}$/u.test(key) ||
          !timingSafeEqual(
            Buffer.from(key, "hex"),
            Buffer.from(options.accessKey, "hex"),
          ) ||
          single(request, "origin") !== options.allowedOrigin ||
          request.headers["sec-fetch-site"] === "cross-site"
        )
          return fail(reply, "ACCESS_DENIED", 403);
        if (
          !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
            single(request, "content-type") ?? "",
          )
        )
          return fail(reply, "INVALID_COMMAND", 400);
      });
      scope.addHook("onSend", async (_request, reply, payload) => {
        privacy(reply);
        return payload;
      });
      scope.setNotFoundHandler((_request, reply) =>
        fail(reply, "INVALID_COMMAND", 404),
      );
      scope.setErrorHandler((error, _request, reply) => {
        const e = error as { code?: string; statusCode?: number };
        if (e.code === "FST_ERR_CTP_BODY_TOO_LARGE")
          return fail(reply, "INVALID_COMMAND", 413);
        if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500)
          return fail(reply, "INVALID_COMMAND", 400);
        return fail(reply, "ACCESS_UNAVAILABLE", 503);
      });
      const endpoints = [
        {
          path: "/begin",
          request: adminAccessBeginRequestSchema,
          response: adminAccessBeginResponseSchema,
          execute: options.useCases.begin,
        },
        {
          path: "/callback",
          request: adminAccessCallbackRequestSchema,
          response: adminAccessCallbackResponseSchema,
          execute: options.useCases.callback,
        },
        {
          path: "/logout",
          request: adminAccessLogoutRequestSchema,
          response: adminAccessLogoutResponseSchema,
          execute: options.useCases.logout,
        },
      ];
      for (const endpoint of endpoints)
        scope.post(
          endpoint.path,
          { bodyLimit: 8192 },
          async (request, reply) => {
            const input = endpoint.request.safeParse(request.body);
            if (!input.success) return fail(reply, "INVALID_COMMAND", 400);
            try {
              const result = endpoint.response.parse(
                await endpoint.execute(input.data),
              );
              return reply
                .code(result.outcome === "SUCCESS" ? 200 : status(result.code))
                .send(result);
            } catch {
              return fail(reply, "ACCESS_UNAVAILABLE", 503);
            }
          },
        );
    },
    { prefix: "/api/v1/admin/access" },
  );
}
