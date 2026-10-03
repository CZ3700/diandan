import type { FastifyInstance } from "fastify";
import {
  storefrontNavigationCommandSchema,
  storefrontNavigationRequestSchema,
  storefrontNavigationResponseSchema,
  publicStorefrontNavigationResponseSchema,
  type StorefrontNavigationCommand,
  type StorefrontNavigationResponse,
} from "@fan-support/contracts";
import { registerPrivateAdminEndpoint } from "./admin-workspace-transport.js";
export type StorefrontNavigationRouteDependencies = Readonly<{
  allowedOrigin: string;
  useCases: Readonly<{ execute(input: unknown): Promise<unknown> }>;
}>;
export type PublicStorefrontNavigationRouteDependencies = Readonly<{
  useCases: Readonly<{ execute(): Promise<unknown> }>;
}>;
function matches(
  command: StorefrontNavigationCommand,
  response: StorefrontNavigationResponse,
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
      JSON.stringify(response.state.draft.navigation) ===
        JSON.stringify(command.navigation)
    );
  if (response.state.draft !== null || response.state.published === null)
    return false;
  return command.action === "PUBLISH"
    ? response.state.published.revisionId === command.draftRevisionId
    : response.state.published.restoredFromPublicationId ===
        command.publicationId;
}
export function registerStorefrontNavigationRoute(
  instance: FastifyInstance,
  options: StorefrontNavigationRouteDependencies,
): void {
  for (const [path, action] of [
    ["read", "READ"],
    ["draft", "SAVE_DRAFT"],
    ["publish", "PUBLISH"],
    ["restore", "RESTORE"],
    ["history", "HISTORY"],
  ] as const) {
    registerPrivateAdminEndpoint(instance, {
      path: `/api/v1/admin/storefront-navigation/${path}`,
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
          throw new TypeError("Invalid navigation body");
        return storefrontNavigationRequestSchema.parse({
          ...envelope,
          command: storefrontNavigationCommandSchema.parse({
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
        const response = storefrontNavigationResponseSchema.parse(input);
        if (
          !matches(
            storefrontNavigationRequestSchema.parse(request).command,
            response,
          )
        )
          throw new TypeError("Mismatched navigation response");
        return response;
      },
    });
  }
}
export function registerPublicStorefrontNavigationRoute(
  instance: FastifyInstance,
  options: PublicStorefrontNavigationRouteDependencies,
): void {
  instance.get(
    "/api/v1/storefront/storefront-navigation",
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
        const response = publicStorefrontNavigationResponseSchema.parse(
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
