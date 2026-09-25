import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  adminContentFailureSchema,
  adminOpaqueTokenSchema,
  contentAuthoringCommandSchema,
  contentAuthoringRequestSchema,
  contentAuthoringResponseSchema,
  type AdminContentFailure,
  type ContentAuthoringCommand,
  type ContentAuthoringResponse,
  type ContentAuthoringTarget,
} from "@fan-support/contracts";
import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "@fan-support/observability";
import { currentRequestContext } from "@fan-support/observability/node";

export type ContentAuthoringRouteDependencies = Readonly<{
  allowedOrigin: string;
  useCases: Readonly<{
    execute(input: unknown): Promise<ContentAuthoringResponse>;
  }>;
}>;

const BODY_LIMIT_BYTES = 16 * 1024 * 1024;
const SESSION_COOKIE = "__Host-fan-admin-session";
const ROUTES = [
  ["/read", "READ"],
  ["/create", "CREATE"],
  ["/copy", "COPY"],
] as const;

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
  action: ContentAuthoringCommand["action"],
  idempotencyKey: string | undefined,
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
  const parsed = contentAuthoringCommandSchema.safeParse({
    ...body,
    action,
    ...(action === "READ" ? {} : { idempotencyKey }),
  });
  return parsed.success ? parsed.data : undefined;
}

function targetIdentity(target: ContentAuthoringTarget): string {
  switch (target.kind) {
    case "IDOL":
      return `IDOL:${target.idolId.toLowerCase()}`;
    case "GIFT":
      return `GIFT:${target.giftId.toLowerCase()}`;
    case "MEDIA_METADATA":
      return `MEDIA_METADATA:${target.mediaAssetId.toLowerCase()}`;
    case "POLICY":
      return `POLICY:${target.policyKey}`;
    case "HOMEPAGE":
      return "HOMEPAGE";
  }
}

function responseMatchesCommand(
  response: ContentAuthoringResponse,
  command: ContentAuthoringCommand,
): boolean {
  if (response.outcome === "FAILURE") return true;
  if (command.action !== "READ") return response.kind === "MUTATION";
  return (
    response.kind === "REVISION" &&
    response.snapshot.revisionId.toLowerCase() ===
      command.revisionId.toLowerCase() &&
    targetIdentity(response.snapshot.target) === targetIdentity(command.target)
  );
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

export function registerContentAuthoringRoute(
  instance: FastifyInstance,
  dependencies: ContentAuthoringRouteDependencies,
): void {
  let canonicalOrigin: string;
  try {
    const origin = new URL(dependencies.allowedOrigin);
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.origin !== dependencies.allowedOrigin
    )
      throw new Error();
    canonicalOrigin = origin.origin;
  } catch {
    throw new Error("Content authoring allowed origin is invalid");
  }
  instance.register(
    async (scope) => {
      installBoundary(scope, canonicalOrigin);
      for (const [url, action] of ROUTES) {
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
            );
            if (command === undefined)
              return sendFailure(reply, "INVALID_COMMAND");
            const input = contentAuthoringRequestSchema.safeParse({
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
              const response = contentAuthoringResponseSchema.parse(
                await dependencies.useCases.execute(input.data),
              );
              if (!responseMatchesCommand(response, command))
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
    { prefix: "/api/v1/admin/content-authoring" },
  );
}
