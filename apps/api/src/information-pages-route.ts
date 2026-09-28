import type { FastifyInstance } from "fastify";
import {
  informationPageCommandSchema,
  informationPageRequestSchema,
  informationPageResponseSchema,
  publicInformationPageRequestSchema,
  publicInformationPageResponseSchema,
  publicInformationPageIndexRequestSchema,
  publicInformationPageIndexResponseSchema,
  type InformationPageCommand,
  type InformationPageResponse,
} from "@fan-support/contracts";
import { registerPrivateAdminEndpoint } from "./admin-workspace-transport.js";

export type InformationPagesRouteDependencies = Readonly<{
  allowedOrigin: string;
  useCases: Readonly<{ execute(input: unknown): Promise<unknown> }>;
}>;
export type PublicInformationPagesRouteDependencies = Readonly<{
  useCases: Readonly<{
    read(input: unknown): Promise<unknown>;
    index(input: unknown): Promise<unknown>;
  }>;
}>;

function matches(
  command: InformationPageCommand,
  response: InformationPageResponse,
): boolean {
  if (response.outcome === "FAILURE") return true;
  if (command.action === "LIST") return response.kind === "LIST";
  if (command.action === "HISTORY")
    return (
      response.kind === "HISTORY" &&
      response.page === command.page &&
      response.pageSize === command.pageSize &&
      response.entries.every((entry) => entry.pageKey === command.pageKey)
    );
  if (
    response.kind !== "STATE" ||
    response.workspace.pageKey !== command.pageKey ||
    response.workspace.locale !== command.locale
  )
    return false;
  if (command.action === "READ") return true;
  const state = response.workspace;
  if (state.version !== command.expectedVersion + 1) return false;
  if (command.action === "SAVE_DRAFT")
    return (
      state.draft !== null &&
      state.selected !== null &&
      JSON.stringify(state.selected.fields) === JSON.stringify(command.fields)
    );
  if (command.action === "PUBLISH")
    return (
      state.published?.revisionId === command.revisionId &&
      state.published.action === "PUBLISH"
    );
  if (command.action === "RESTORE")
    return state.published?.restoredFromPublicationId === command.publicationId;
  if (command.action === "UNPUBLISH") return state.published === null;
  return (
    state.draft?.revisionId === command.revisionId &&
    state.selected?.review.status ===
      (command.action === "SUBMIT_REVIEW" ? "IN_REVIEW" : "APPROVED")
  );
}

export function registerInformationPagesRoute(
  instance: FastifyInstance,
  options: InformationPagesRouteDependencies,
): void {
  for (const [path, action] of [
    ["list", "LIST"],
    ["read", "READ"],
    ["save", "SAVE_DRAFT"],
    ["submit", "SUBMIT_REVIEW"],
    ["approve", "APPROVE_REVIEW"],
    ["publish", "PUBLISH"],
    ["unpublish", "UNPUBLISH"],
    ["restore", "RESTORE"],
    ["history", "HISTORY"],
  ] as const) {
    registerPrivateAdminEndpoint(instance, {
      path: `/api/v1/admin/information-pages/${path}`,
      allowedOrigin: options.allowedOrigin,
      bodyLimit: 256 * 1024,
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
          throw new TypeError("Invalid information page body");
        return informationPageRequestSchema.parse({
          ...envelope,
          command: informationPageCommandSchema.parse({
            ...body,
            action,
            ...(!["LIST", "READ", "HISTORY"].includes(action)
              ? { idempotencyKey: key }
              : {}),
          }),
        });
      },
      execute: (input) => options.useCases.execute(input),
      parseResponse(input, request) {
        const response = informationPageResponseSchema.parse(input);
        if (
          !matches(
            informationPageRequestSchema.parse(request).command,
            response,
          )
        )
          throw new TypeError("Mismatched information page response");
        return response;
      },
    });
  }
}

const statuses = {
  NOT_FOUND: 404,
  INVALID_COMMAND: 400,
  CONTENT_UNAVAILABLE: 503,
} as const;
const failure = (code: "INVALID_COMMAND" | "CONTENT_UNAVAILABLE") => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});
export function registerPublicInformationPagesRoute(
  instance: FastifyInstance,
  options: PublicInformationPagesRouteDependencies,
): void {
  for (const detail of [false, true])
    instance.get(
      `/api/v1/storefront/information-pages${detail ? "/:pageKey" : ""}`,
      async (request, reply) => {
        void reply
          .header("cache-control", "no-store")
          .header("x-robots-tag", "noindex, nofollow");
        const query = new URL(request.raw.url ?? "", "http://internal.invalid")
          .searchParams;
        if (query.size !== 1 || query.getAll("locale").length !== 1)
          return reply.code(400).send(failure("INVALID_COMMAND"));
        const input = {
          schemaVersion: 1,
          locale: query.get("locale"),
          ...(detail
            ? { pageKey: (request.params as { pageKey: string }).pageKey }
            : {}),
        };
        const command = (
          detail
            ? publicInformationPageRequestSchema
            : publicInformationPageIndexRequestSchema
        ).safeParse(input);
        if (!command.success)
          return reply.code(400).send(failure("INVALID_COMMAND"));
        try {
          const response = detail
            ? publicInformationPageResponseSchema.parse(
                await options.useCases.read(command.data),
              )
            : publicInformationPageIndexResponseSchema.parse(
                await options.useCases.index(command.data),
              );
          if (
            response.outcome === "SUCCESS" &&
            (response.kind === "INFORMATION_PAGE"
              ? response.requestedLocale !== command.data.locale ||
                response.document.pageKey !== input.pageKey
              : response.locale !== command.data.locale)
          )
            throw new TypeError("Mismatched public page");
          return reply
            .code(
              response.outcome === "SUCCESS" ? 200 : statuses[response.code],
            )
            .send(response);
        } catch {
          return reply.code(503).send(failure("CONTENT_UNAVAILABLE"));
        }
      },
    );
}
