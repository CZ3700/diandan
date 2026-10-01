import type { FastifyInstance } from "fastify";
import {
  storefrontBrandCommandSchema,
  storefrontBrandRequestSchema,
  storefrontBrandResponseSchema,
  publicStorefrontBrandResponseSchema,
  type StorefrontBrandCommand,
  type StorefrontBrandResponse,
} from "@fan-support/contracts";
import { registerPrivateAdminEndpoint } from "./admin-workspace-transport.js";
export type StorefrontBrandRouteDependencies = Readonly<{
  allowedOrigin: string;
  useCases: Readonly<{ execute(input: unknown): Promise<unknown> }>;
}>;
export type PublicStorefrontBrandRouteDependencies = Readonly<{
  useCases: Readonly<{ execute(): Promise<unknown> }>;
}>;
function matches(
  command: StorefrontBrandCommand,
  response: StorefrontBrandResponse,
): boolean {
  if (response.outcome === "FAILURE") return true;
  if (command.action === "HISTORY")
    return (
      response.kind === "HISTORY" &&
      response.page === command.page &&
      response.pageSize === command.pageSize
    );
  if (command.action === "PREPARE_LOGO") return response.kind === "LOGO";
  if (response.kind !== "STATE") return false;
  if (command.action === "READ") return true;
  if (response.state.version !== command.expectedVersion + 1) return false;
  if (command.action === "SAVE_DRAFT")
    return (
      response.state.draft !== null &&
      JSON.stringify(response.state.draft.brand) ===
        JSON.stringify(command.brand)
    );
  if (response.state.draft !== null || response.state.published === null)
    return false;
  return command.action === "PUBLISH"
    ? response.state.published.action === "PUBLISH" &&
        response.state.published.revisionId.toLowerCase() ===
          command.draftRevisionId.toLowerCase()
    : response.state.published.action === "RESTORE" &&
        response.state.published.restoredFromPublicationId?.toLowerCase() ===
          command.publicationId.toLowerCase();
}
export function registerStorefrontBrandRoute(
  instance: FastifyInstance,
  options: StorefrontBrandRouteDependencies,
): void {
  for (const [path, action] of [
    ["read", "READ"],
    ["prepare", "PREPARE_LOGO"],
    ["draft", "SAVE_DRAFT"],
    ["publish", "PUBLISH"],
    ["restore", "RESTORE"],
    ["history", "HISTORY"],
  ] as const) {
    registerPrivateAdminEndpoint(instance, {
      path: `/api/v1/admin/storefront-brand/${path}`,
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
          throw new TypeError("Invalid brand body");
        return storefrontBrandRequestSchema.parse({
          ...envelope,
          command: storefrontBrandCommandSchema.parse({
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
        const response = storefrontBrandResponseSchema.parse(input);
        if (
          !matches(
            storefrontBrandRequestSchema.parse(request).command,
            response,
          )
        )
          throw new TypeError("Mismatched brand response");
        return response;
      },
    });
  }
}
export function registerPublicStorefrontBrandRoute(
  instance: FastifyInstance,
  options: PublicStorefrontBrandRouteDependencies,
): void {
  instance.get(
    "/api/v1/storefront/storefront-brand",
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
        const response = publicStorefrontBrandResponseSchema.parse(
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
