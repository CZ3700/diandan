import type { FastifyInstance } from "fastify";
import {
  storefrontThemeCommandSchema,
  storefrontThemeRequestSchema,
  storefrontThemeResponseSchema,
  publicStorefrontThemeResponseSchema,
  type StorefrontThemeCommand,
  type StorefrontThemeResponse,
} from "@fan-support/contracts";
import { registerPrivateAdminEndpoint } from "./admin-workspace-transport.js";
export type StorefrontThemeRouteDependencies = Readonly<{
  allowedOrigin: string;
  useCases: Readonly<{ execute(input: unknown): Promise<unknown> }>;
}>;
export type PublicStorefrontThemeRouteDependencies = Readonly<{
  useCases: Readonly<{ execute(): Promise<unknown> }>;
}>;
function matches(
  command: StorefrontThemeCommand,
  response: StorefrontThemeResponse,
): boolean {
  if (response.outcome === "FAILURE") return true;
  if (command.action === "HISTORY")
    return (
      response.kind === "HISTORY" &&
      response.page === command.page &&
      response.pageSize === command.pageSize
    );
  if (response.kind !== "STATE") return false;
  if (command.action === "READ") return true;
  if (response.state.version !== command.expectedVersion + 1) return false;
  if (command.action === "SAVE_DRAFT")
    return (
      response.state.draft !== null &&
      JSON.stringify(response.state.draft.theme) ===
        JSON.stringify(command.theme)
    );
  if (response.state.draft !== null || response.state.published === null)
    return false;
  return command.action === "PUBLISH"
    ? response.state.published.revisionId === command.draftRevisionId
    : response.state.published.restoredFromPublicationId ===
        command.publicationId;
}
export function registerStorefrontThemeRoute(
  instance: FastifyInstance,
  options: StorefrontThemeRouteDependencies,
): void {
  for (const [path, action] of [
    ["read", "READ"],
    ["draft", "SAVE_DRAFT"],
    ["publish", "PUBLISH"],
    ["restore", "RESTORE"],
    ["history", "HISTORY"],
  ] as const) {
    registerPrivateAdminEndpoint(instance, {
      path: `/api/v1/admin/storefront-theme/${path}`,
      allowedOrigin: options.allowedOrigin,
      bodyLimit: 8 * 1024,
      parseRequest(body, envelope, key) {
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          [
            "action",
            "idempotencyKey",
            "requestId",
            "actorId",
            "sessionId",
            "sessionToken",
            "csrfToken",
          ].some((name) => Object.hasOwn(body, name))
        )
          throw new TypeError("Invalid theme body");
        return storefrontThemeRequestSchema.parse({
          ...envelope,
          command: storefrontThemeCommandSchema.parse({
            ...body,
            action,
            ...(action !== "READ" && action !== "HISTORY"
              ? { idempotencyKey: key }
              : {}),
          }),
        });
      },
      execute: (input) => options.useCases.execute(input),
      parseResponse(input, request) {
        const response = storefrontThemeResponseSchema.parse(input);
        if (
          !matches(
            storefrontThemeRequestSchema.parse(request).command,
            response,
          )
        )
          throw new TypeError("Mismatched theme response");
        return response;
      },
    });
  }
}
export function registerPublicStorefrontThemeRoute(
  instance: FastifyInstance,
  options: PublicStorefrontThemeRouteDependencies,
): void {
  instance.get(
    "/api/v1/storefront/storefront-theme",
    async (request, reply) => {
      void reply
        .header("cache-control", "no-store")
        .header("x-robots-tag", "noindex, nofollow");
      if ((request.raw.url ?? "").includes("?"))
        return reply.code(400).send({
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "CONTENT_UNAVAILABLE",
        });
      try {
        const response = publicStorefrontThemeResponseSchema.parse(
          await options.useCases.execute(),
        );
        return reply
          .code(response.outcome === "SUCCESS" ? 200 : 503)
          .send(response);
      } catch {
        return reply.code(503).send({
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "CONTENT_UNAVAILABLE",
        });
      }
    },
  );
}
