import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  adminContentFailureSchema,
  adminOrdersFailureSchema,
  adminOpaqueTokenSchema,
} from "@fan-support/contracts";
import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "@fan-support/observability";
import { currentRequestContext } from "@fan-support/observability/node";

type CredentialEnvelope = Readonly<{
  schemaVersion: 1;
  requestId: string;
  sessionToken: string;
  csrfToken: string;
}>;
export type PrivateAdminEndpoint = Readonly<{
  path: string;
  allowedOrigin: string;
  bodyLimit: number;
  unavailableCode?: "TEMPORARY_UNAVAILABLE";
  parseRequest(
    body: unknown,
    envelope: CredentialEnvelope,
    idempotencyKey: string | undefined,
  ): unknown;
  execute(input: unknown): Promise<unknown>;
  parseResponse(input: unknown, request: unknown): unknown;
}>;
function privacy(reply: FastifyReply): void {
  void reply
    .header("cache-control", "private, no-store")
    .header("x-robots-tag", "noindex, nofollow")
    .header("referrer-policy", "no-referrer");
}
export function adminFailureStatus(code: string): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
    case "CSRF_INVALID":
    case "SELF_REVIEW":
    case "NEEDS_AUTHORIZATION":
    case "SECOND_FACTOR_REQUIRED":
      return 403;
    case "NOT_FOUND":
    case "PREVIEW_UNAVAILABLE":
      return 404;
    case "INVALID_COMMAND":
    case "INVALID_CONTENT":
      return 400;
    case "RATE_LIMITED":
      return 429;
    case "TEMPORARY_UNAVAILABLE":
    case "ACCESS_UNAVAILABLE":
    case "CONTENT_UNAVAILABLE":
    case "COMMERCE_UNAVAILABLE":
    case "MANAGEMENT_UNAVAILABLE":
      return 503;
    default:
      return 409;
  }
}
function failure(
  reply: FastifyReply,
  code:
    | "INVALID_COMMAND"
    | "UNAUTHENTICATED"
    | "FORBIDDEN"
    | "CSRF_INVALID"
    | "NOT_FOUND"
    | "CONTENT_UNAVAILABLE"
    | "TEMPORARY_UNAVAILABLE",
  status = adminFailureStatus(code),
) {
  return reply.code(status).send(
    (code === "TEMPORARY_UNAVAILABLE"
      ? adminOrdersFailureSchema
      : adminContentFailureSchema
    ).parse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code,
    }),
  );
}
function singleHeader(
  request: FastifyRequest,
  name: string,
): string | undefined {
  let count = 0;
  for (let index = 0; index < request.raw.rawHeaders.length; index += 2)
    if (request.raw.rawHeaders[index]?.toLowerCase() === name) count++;
  const value = request.headers[name];
  return count === 1 && typeof value === "string" ? value : undefined;
}
function sessionToken(request: FastifyRequest): string | undefined {
  const cookie = singleHeader(request, "cookie");
  if (cookie === undefined) return undefined;
  let value: string | undefined;
  for (const segment of cookie.split(";")) {
    const index = segment.indexOf("=");
    if (index < 1) return undefined;
    if (segment.slice(0, index).trim() !== "__Host-fan-admin-session") continue;
    if (value !== undefined) return undefined;
    value = segment.slice(index + 1).trim();
  }
  const parsed = adminOpaqueTokenSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Shared transport for the additive workspace endpoints; business authorization remains in Application. */
export function registerPrivateAdminEndpoint(
  instance: FastifyInstance,
  options: PrivateAdminEndpoint,
): void {
  const origin = new URL(options.allowedOrigin);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== options.allowedOrigin
  )
    throw new TypeError("Invalid administrative origin");
  void instance.register(
    async (scope) => {
      installBoundary(scope, options.allowedOrigin, options.unavailableCode);
      scope.post(
        "",
        { bodyLimit: options.bodyLimit },
        async (request, reply) => {
          const session = sessionToken(request);
          if (!session) return failure(reply, "UNAUTHENTICATED");
          const csrf = adminOpaqueTokenSchema.safeParse(
            singleHeader(request, "x-csrf-token"),
          );
          if (!csrf.success) return failure(reply, "CSRF_INVALID");
          let input: unknown;
          try {
            input = options.parseRequest(
              request.body,
              {
                schemaVersion: 1,
                requestId:
                  currentRequestContext()?.requestId ??
                  resolveRequestId(request.headers[REQUEST_ID_HEADER]),
                sessionToken: session,
                csrfToken: csrf.data,
              },
              singleHeader(request, "idempotency-key"),
            );
          } catch {
            return failure(reply, "INVALID_COMMAND");
          }
          try {
            const result = options.parseResponse(
              await options.execute(input),
              input,
            ) as { outcome: string; code?: string };
            return reply
              .code(
                result.outcome === "FAILURE"
                  ? adminFailureStatus(result.code ?? "CONTENT_UNAVAILABLE")
                  : 200,
              )
              .send(result);
          } catch {
            return failure(
              reply,
              options.unavailableCode ?? "CONTENT_UNAVAILABLE",
            );
          }
        },
      );
    },
    { prefix: options.path },
  );
}

function installBoundary(
  scope: FastifyInstance,
  allowedOrigin: string,
  unavailableCode:
    "CONTENT_UNAVAILABLE" | "TEMPORARY_UNAVAILABLE" = "CONTENT_UNAVAILABLE",
): void {
  scope.addHook("onRequest", async (request, reply) => {
    privacy(reply);
    if ((request.raw.url ?? "").includes("?"))
      return failure(reply, "INVALID_COMMAND");
    if (
      singleHeader(request, "origin") !== allowedOrigin ||
      request.headers["sec-fetch-site"] === "cross-site"
    )
      return failure(reply, "FORBIDDEN");
    const contentType = singleHeader(request, "content-type");
    if (
      !contentType ||
      !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(contentType)
    )
      return failure(reply, "INVALID_COMMAND");
  });
  scope.addHook("onSend", async (_request, reply, payload) => {
    privacy(reply);
    return payload;
  });
  scope.setNotFoundHandler((_request, reply) => failure(reply, "NOT_FOUND"));
  scope.setErrorHandler((error, _request, reply) => {
    const value =
      typeof error === "object" && error !== null
        ? (error as Record<string, unknown>)
        : {};
    if (value["code"] === "FST_ERR_CTP_BODY_TOO_LARGE")
      return failure(reply, "INVALID_COMMAND", 413);
    if (
      typeof value["statusCode"] === "number" &&
      value["statusCode"] >= 400 &&
      value["statusCode"] < 500
    )
      return failure(reply, "INVALID_COMMAND");
    return failure(reply, unavailableCode);
  });
}

export function registerPreviewAdminEndpoint(
  instance: FastifyInstance,
  options: Readonly<{
    path: string;
    allowedOrigin: string;
    parseRequest(input: unknown): unknown;
    execute(input: unknown): Promise<unknown>;
    parseResponse(input: unknown, request: unknown): unknown;
  }>,
): void {
  const origin = new URL(options.allowedOrigin);
  if (
    origin.origin !== options.allowedOrigin ||
    !["http:", "https:"].includes(origin.protocol)
  )
    throw new TypeError("Invalid administrative origin");
  void instance.register(
    async (scope) => {
      installBoundary(scope, options.allowedOrigin);
      scope.post("", { bodyLimit: 64 * 1024 }, async (request, reply) => {
        let input: unknown;
        try {
          input = options.parseRequest(request.body);
        } catch {
          return failure(reply, "INVALID_COMMAND");
        }
        try {
          const result = options.parseResponse(
            await options.execute(input),
            input,
          ) as { outcome: string; code?: string };
          return reply
            .code(
              result.outcome === "FAILURE"
                ? adminFailureStatus(result.code ?? "CONTENT_UNAVAILABLE")
                : 200,
            )
            .send(result);
        } catch {
          return failure(reply, "CONTENT_UNAVAILABLE");
        }
      });
    },
    { prefix: options.path },
  );
}
