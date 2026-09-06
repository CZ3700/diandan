import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  adminContentFailureSchema,
  adminOpaqueTokenSchema,
  publicationRuntimeCommandSchema,
  publicationRuntimeRequestSchema,
  publicationRuntimeResponseSchema,
  type AdminContentFailure,
  type PublicationRuntimeResponse,
  type PublicationRuntimeCommand,
  type PublicationPreflightTarget,
} from "@fan-support/contracts";
import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "@fan-support/observability";
import { currentRequestContext } from "@fan-support/observability/node";

export type PublicationRuntimeRouteDependencies = Readonly<{
  allowedOrigin: string;
  useCases: Readonly<{
    execute(input: unknown): Promise<PublicationRuntimeResponse>;
  }>;
}>;

const BODY_LIMIT_BYTES = 64 * 1024;
const SESSION_COOKIE = "__Host-fan-admin-session";
const ROUTES = [
  ["/validate", "VALIDATE"],
  ["/publish", "PUBLISH"],
  ["/rollback", "ROLLBACK"],
  ["/status", "STATUS"],
  ["/retry", "RETRY_PURGE"],
] as const;

function sameTarget(
  left: PublicationPreflightTarget,
  right: PublicationPreflightTarget,
): boolean {
  if (left.revisionId.toLowerCase() !== right.revisionId.toLowerCase())
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

function readCommand(
  body: unknown,
  action: PublicationRuntimeCommand["action"],
  idempotencyKey: string | undefined,
): PublicationRuntimeCommand | undefined {
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
  const parsed = publicationRuntimeCommandSchema.safeParse({
    ...body,
    action,
    ...(action === "STATUS" ? {} : { idempotencyKey }),
  });
  return parsed.success ? parsed.data : undefined;
}

function responseMatches(
  command: PublicationRuntimeCommand,
  response: Extract<PublicationRuntimeResponse, { outcome: "SUCCESS" }>,
): boolean {
  switch (command.action) {
    case "STATUS":
      return (
        response.kind === "PUBLICATION_STATUS" &&
        response.publicationId.toLowerCase() ===
          command.publicationId.toLowerCase() &&
        response.jobs.every(
          (job) =>
            job.publicationId.toLowerCase() ===
            command.publicationId.toLowerCase(),
        )
      );
    case "RETRY_PURGE":
      return (
        response.kind === "PURGE_RETRY" &&
        response.publicationId.toLowerCase() ===
          command.publicationId.toLowerCase()
      );
    default:
      return (
        response.kind === "PUBLICATION_MUTATION" &&
        response.action === command.action &&
        sameTarget(response.target, command.target)
      );
  }
}

function statusForFailure(
  code: Extract<PublicationRuntimeResponse, { outcome: "FAILURE" }>["code"],
): number {
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
  for (let index = 0; index < raw.length; index += 2)
    if (raw[index]?.toLowerCase() === name) occurrences++;
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

export function registerPublicationRuntimeRoute(
  instance: FastifyInstance,
  options: PublicationRuntimeRouteDependencies,
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
    throw new Error("Publication runtime allowed origin is invalid");
  }
  for (const [url, action] of ROUTES) {
    instance.register(
      async (scope) => {
        installBoundary(scope, canonicalOrigin);
        scope.post(
          "",
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
            const input = publicationRuntimeRequestSchema.safeParse({
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
              const response = publicationRuntimeResponseSchema.parse(
                await options.useCases.execute(input.data),
              );
              if (response.outcome === "FAILURE")
                return reply
                  .code(statusForFailure(response.code))
                  .send(response);
              if (!responseMatches(command, response))
                return sendFailure(reply, "CONTENT_UNAVAILABLE");
              return reply.send(response);
            } catch {
              return sendFailure(reply, "CONTENT_UNAVAILABLE");
            }
          },
        );
      },
      { prefix: `/api/v1/admin/content/publication${url}` },
    );
  }
}
