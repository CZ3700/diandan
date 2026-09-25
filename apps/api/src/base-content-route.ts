import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  baseContentCommandSchema,
  adminContentFailureSchema,
  baseContentRequestSchema,
  baseContentResponseSchema,
  adminOpaqueTokenSchema,
  baseContentPreviewRequestSchema,
  baseContentPreviewResponseSchema,
  type BaseContentCommand,
  type BaseContentTarget,
  type AdminContentFailure,
  type BaseContentResponse,
  type BaseContentPreviewResponse,
} from "@fan-support/contracts";
import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "@fan-support/observability";
import { currentRequestContext } from "@fan-support/observability/node";

export type BaseContentRouteDependencies = Readonly<{
  allowedOrigin: string;
  useCases: Readonly<{
    execute(input: unknown): Promise<BaseContentResponse>;
    readPreview(input: unknown): Promise<BaseContentPreviewResponse>;
  }>;
}>;

const BODY_LIMIT_BYTES = 64 * 1024;
const SESSION_COOKIE = "__Host-fan-admin-session";
const ROUTES = [
  ["/read", "READ_REVIEW", false],
  ["/submit", "SUBMIT_REVIEW", true],
  ["/approve", "APPROVE_REVIEW", true],
  ["/preview/issue", "ISSUE_PREVIEW", false],
  ["/preview/revoke", "REVOKE_PREVIEW", true],
] as const;

function successKind(
  action: BaseContentCommand["action"],
): "REVIEW" | "PREVIEW_GRANT" | "MUTATION" {
  switch (action) {
    case "READ_REVIEW":
      return "REVIEW";
    case "ISSUE_PREVIEW":
      return "PREVIEW_GRANT";
    default:
      return "MUTATION";
  }
}

function sameTarget(
  left: BaseContentTarget,
  right: BaseContentTarget,
): boolean {
  if (
    left.revisionId.toLowerCase() !== right.revisionId.toLowerCase() ||
    left.locale !== right.locale ||
    left.owner.kind !== right.owner.kind
  )
    return false;
  const owner = left.owner;
  const expected = right.owner;
  switch (owner.kind) {
    case "IDOL":
      return (
        expected.kind === "IDOL" &&
        owner.idolId.toLowerCase() === expected.idolId.toLowerCase()
      );
    case "GIFT":
      return (
        expected.kind === "GIFT" &&
        owner.giftId.toLowerCase() === expected.giftId.toLowerCase()
      );
    case "MEDIA_METADATA":
      return (
        expected.kind === "MEDIA_METADATA" &&
        owner.mediaAssetId.toLowerCase() === expected.mediaAssetId.toLowerCase()
      );
    case "POLICY":
      return (
        expected.kind === "POLICY" && owner.policyKey === expected.policyKey
      );
    case "HOMEPAGE":
      return expected.kind === "HOMEPAGE";
  }
}

function statusForFailure(code: AdminContentFailure["code"]): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
    case "CSRF_INVALID":
    case "SELF_REVIEW":
      return 403;
    case "NOT_FOUND":
    case "PREVIEW_UNAVAILABLE":
      return 404;
    case "CONTENT_UNAVAILABLE":
      return 503;
    case "INVALID_COMMAND":
    case "INVALID_CONTENT":
      return 400;
    default:
      return 409;
  }
}

function sendFailure(
  reply: FastifyReply,
  code: AdminContentFailure["code"],
  status = statusForFailure(code),
) {
  return reply.code(status).send(
    adminContentFailureSchema.parse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code,
    }),
  );
}

function privacy(reply: FastifyReply): void {
  void reply
    .header("cache-control", "private, no-store")
    .header("x-robots-tag", "noindex, nofollow")
    .header("referrer-policy", "no-referrer");
}

function singleHeader(
  request: FastifyRequest,
  name: string,
): string | undefined {
  const raw = request.raw.rawHeaders;
  let occurrences = 0;
  for (let index = 0; index < raw.length; index += 2) {
    if (raw[index]?.toLowerCase() === name) occurrences++;
  }
  const value = request.headers[name];
  return occurrences === 1 && typeof value === "string" ? value : undefined;
}

function sessionToken(request: FastifyRequest): string | undefined {
  const header = singleHeader(request, "cookie");
  if (header === undefined) return undefined;
  let value: string | undefined;
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 1) return undefined;
    if (segment.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    if (value !== undefined) return undefined;
    value = segment.slice(separator + 1).trim();
  }
  const parsed = adminOpaqueTokenSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function readCommand(
  body: unknown,
  action: BaseContentCommand["action"],
  idempotencyKey: string | undefined,
  requiresKey: boolean,
) {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return undefined;
  if (
    [
      "action",
      "idempotencyKey",
      "requestId",
      "actorId",
      "sessionToken",
      "csrfToken",
    ].some((key) => Object.hasOwn(body, key))
  )
    return undefined;
  const parsed = baseContentCommandSchema.safeParse({
    ...body,
    action,
    ...(requiresKey ? { idempotencyKey } : {}),
  });
  return parsed.success ? parsed.data : undefined;
}

function installBoundary(scope: FastifyInstance, allowedOrigin: string): void {
  scope.addHook("onRequest", async (request, reply) => {
    privacy(reply);
    if ((request.raw.url ?? "").includes("?"))
      return sendFailure(reply, "INVALID_COMMAND");
    if (
      singleHeader(request, "origin") !== allowedOrigin ||
      request.headers["sec-fetch-site"] === "cross-site"
    )
      return sendFailure(reply, "FORBIDDEN");
    const contentType = singleHeader(request, "content-type");
    if (
      contentType === undefined ||
      !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(contentType)
    )
      return sendFailure(reply, "INVALID_COMMAND");
  });
  scope.addHook("onSend", async (_request, reply, payload) => {
    privacy(reply);
    return payload;
  });
  scope.setNotFoundHandler((_request, reply) =>
    sendFailure(reply, "NOT_FOUND"),
  );
  scope.setErrorHandler((error, _request, reply) => {
    const details =
      typeof error === "object" && error !== null
        ? (error as Record<string, unknown>)
        : {};
    if (details["code"] === "FST_ERR_CTP_BODY_TOO_LARGE")
      return sendFailure(reply, "INVALID_COMMAND", 413);
    const status = details["statusCode"];
    if (typeof status === "number" && status >= 400 && status < 500)
      return sendFailure(reply, "INVALID_COMMAND");
    return sendFailure(reply, "CONTENT_UNAVAILABLE");
  });
}

export function registerBaseContentRoute(
  instance: FastifyInstance,
  options: BaseContentRouteDependencies,
): void {
  let canonicalOrigin: string;
  try {
    const origin = new URL(options.allowedOrigin);
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.origin !== options.allowedOrigin
    )
      throw new Error();
    canonicalOrigin = origin.origin;
  } catch {
    throw new Error("Base content allowed origin is invalid");
  }
  instance.register(
    async (scope) => {
      installBoundary(scope, canonicalOrigin);
      for (const [url, action, requiresKey] of ROUTES) {
        scope.post(
          url,
          { bodyLimit: BODY_LIMIT_BYTES },
          async (request, reply) => {
            const session = sessionToken(request);
            if (session === undefined)
              return sendFailure(reply, "UNAUTHENTICATED");
            const csrf = adminOpaqueTokenSchema.safeParse(
              singleHeader(request, "x-csrf-token"),
            );
            if (!csrf.success) return sendFailure(reply, "CSRF_INVALID");
            const command = readCommand(
              request.body,
              action,
              singleHeader(request, "idempotency-key"),
              requiresKey,
            );
            if (command === undefined)
              return sendFailure(reply, "INVALID_COMMAND");
            const input = baseContentRequestSchema.safeParse({
              schemaVersion: 1,
              requestId: resolveRequestId(
                currentRequestContext()?.requestId ??
                  reply.getHeader(REQUEST_ID_HEADER),
              ),
              sessionToken: session,
              csrfToken: csrf.data,
              command,
            });
            if (!input.success) return sendFailure(reply, "INVALID_COMMAND");
            try {
              const response = baseContentResponseSchema.parse(
                await options.useCases.execute(input.data),
              );
              if (
                response.outcome === "SUCCESS" &&
                (response.kind !== successKind(action) ||
                  (response.kind === "REVIEW" &&
                    command.action === "READ_REVIEW" &&
                    !sameTarget(response.context.target, command.target)))
              )
                return sendFailure(reply, "CONTENT_UNAVAILABLE");
              return response.outcome === "FAILURE"
                ? sendFailure(reply, response.code)
                : reply.send(response);
            } catch {
              return sendFailure(reply, "CONTENT_UNAVAILABLE");
            }
          },
        );
      }
    },
    { prefix: "/api/v1/admin/content-review" },
  );
  instance.register(
    async (scope) => {
      installBoundary(scope, canonicalOrigin);
      scope.post(
        "/read",
        { bodyLimit: BODY_LIMIT_BYTES },
        async (request, reply) => {
          const input = baseContentPreviewRequestSchema.safeParse(request.body);
          if (!input.success) return sendFailure(reply, "INVALID_COMMAND");
          try {
            const response = baseContentPreviewResponseSchema.parse(
              await options.useCases.readPreview(input.data),
            );
            if (
              response.outcome === "SUCCESS" &&
              !sameTarget(response.target, input.data.target)
            )
              return sendFailure(reply, "CONTENT_UNAVAILABLE");
            return response.outcome === "FAILURE"
              ? sendFailure(reply, response.code)
              : reply.send(response);
          } catch {
            return sendFailure(reply, "CONTENT_UNAVAILABLE");
          }
        },
      );
    },
    { prefix: "/api/v1/content-review-preview" },
  );
}
