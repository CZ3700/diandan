import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  publishedContentFailureSchema,
  publishedContentReadCommandSchema,
  publishedContentResponseSchema,
  type PublishedContentFailure,
  type PublishedContentReadCommand,
  type PublishedContentResponse,
} from "@fan-support/contracts";

export type PublishedContentRouteDependencies = Readonly<{
  useCases: Readonly<{
    execute(input: unknown): Promise<PublishedContentResponse>;
  }>;
}>;

const ROUTES = [
  ["/idols/:handle", "IDOL"],
  ["/gifts/:handle", "GIFT"],
  ["/homepage", "HOMEPAGE"],
  ["/policies/:policyKey", "POLICY"],
  ["/media/:mediaAssetId", "MEDIA_METADATA"],
] as const;

function privacy(reply: FastifyReply): void {
  void reply
    .header("cache-control", "no-store")
    .header("x-robots-tag", "noindex, nofollow")
    .header("referrer-policy", "no-referrer");
}
function statusForFailure(code: PublishedContentFailure["code"]): number {
  switch (code) {
    case "INVALID_QUERY":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "CONTENT_UNAVAILABLE":
      return 503;
  }
}

function sendFailure(
  reply: FastifyReply,
  code: PublishedContentFailure["code"],
) {
  privacy(reply);
  return reply.code(statusForFailure(code)).send(
    publishedContentFailureSchema.parse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code,
    }),
  );
}
function readCommand(
  request: FastifyRequest,
  kind: PublishedContentReadCommand["locator"]["kind"],
): PublishedContentReadCommand | undefined {
  const rawUrl = request.raw.url ?? "";
  if (!rawUrl.includes("?")) return undefined;
  const entries = [
    ...new URLSearchParams(rawUrl.slice(rawUrl.indexOf("?") + 1)),
  ];
  if (entries.length !== 1 || entries[0]?.[0] !== "locale") return undefined;
  const parsed = publishedContentReadCommandSchema.safeParse({
    schemaVersion: 1,
    locator: { ...(request.params as Record<string, unknown>), kind },
    locale: entries[0][1],
  });
  return parsed.success ? parsed.data : undefined;
}
function responseMatches(
  command: PublishedContentReadCommand,
  response: Extract<PublishedContentResponse, { outcome: "SUCCESS" }>,
): boolean {
  const content = response.content;
  const locale =
    content.kind === "MEDIA_METADATA"
      ? content.localeContext
      : content.view.localeContext;
  if (
    locale.requestedLocale !== command.locale ||
    locale.resolvedLocale !== command.locale ||
    locale.fallbackUsed
  )
    return false;
  const locator = command.locator;
  switch (locator.kind) {
    case "IDOL":
      return content.kind === "IDOL" && content.view.handle === locator.handle;
    case "GIFT":
      return content.kind === "GIFT" && content.view.handle === locator.handle;
    case "POLICY":
      return (
        content.kind === "POLICY" &&
        content.view.policyKey === locator.policyKey
      );
    default:
      return content.kind === locator.kind;
  }
}

export function registerPublishedContentRoute(
  instance: FastifyInstance,
  options: PublishedContentRouteDependencies,
): void {
  for (const [path, kind] of ROUTES)
    instance.register(
      async (scope) => {
        scope.addHook("onRequest", async (_request, reply) => {
          privacy(reply);
        });
        scope.addHook("onSend", async (_request, reply, payload) => {
          privacy(reply);
          return payload;
        });
        scope.setNotFoundHandler((_request, reply) =>
          sendFailure(reply, "NOT_FOUND"),
        );
        scope.setErrorHandler((_error, _request, reply) =>
          sendFailure(reply, "CONTENT_UNAVAILABLE"),
        );
        scope.get("", { exposeHeadRoute: false }, async (request, reply) => {
          const command = readCommand(request, kind);
          if (command === undefined) return sendFailure(reply, "INVALID_QUERY");
          try {
            const response = publishedContentResponseSchema.parse(
              await options.useCases.execute(command),
            );
            if (response.outcome === "FAILURE")
              return sendFailure(reply, response.code);
            if (!responseMatches(command, response))
              return sendFailure(reply, "CONTENT_UNAVAILABLE");
            return reply.send(response);
          } catch {
            return sendFailure(reply, "CONTENT_UNAVAILABLE");
          }
        });
      },
      { prefix: `/api/v1${path}` },
    );
}
