import type { FastifyInstance } from "fastify";
import {
  managementCenterCommandSchema,
  managementCenterRequestSchema,
  managementCenterResponseSchema,
  type ManagementCenterCommand,
  type ManagementCenterResponse,
} from "@fan-support/contracts";
import { registerPrivateAdminEndpoint } from "./admin-workspace-transport.js";

export type ManagementCenterRouteDependencies = Readonly<{
  allowedOrigin: string;
  useCases: Readonly<{ execute(input: unknown): Promise<unknown> }>;
}>;
const routes = [
  ["context", "CONTEXT", false],
  ["list", "LIST", false],
  ["images/read", "READ_IMAGE_SOURCE", false],
  ["uploads/prepare", "PREPARE_UPLOAD", true],
  ["submit", "SUBMIT", true],
  ["operations/read", "READ_OPERATION", false],
  ["operations/retry", "RETRY_OPERATION", true],
  ["posters/archive", "ARCHIVE_POSTER", true],
] as const;
const same = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();
function matches(
  command: ManagementCenterCommand,
  result: ManagementCenterResponse,
): boolean {
  if (result.outcome === "FAILURE") return true;
  switch (command.action) {
    case "CONTEXT":
      return result.kind === "CONTEXT";
    case "LIST":
      return (
        result.kind === "LIST" &&
        result.section === command.section &&
        result.page === command.page &&
        result.pageSize === command.pageSize
      );
    case "PREPARE_UPLOAD":
      return result.kind === "UPLOAD_GRANT";
    case "READ_IMAGE_SOURCE":
      return (
        result.kind === "ORIGINAL_IMAGE" &&
        result.target.kind === command.target.kind &&
        same(result.target.id, command.target.id) &&
        result.target.expectedVersion === command.target.expectedVersion
      );
    case "READ_OPERATION":
    case "RETRY_OPERATION":
      return (
        result.kind === "OPERATION" &&
        same(result.operation.operationId, command.operationId)
      );
    case "ARCHIVE_POSTER":
      return (
        result.kind === "POSTER_ARCHIVED" &&
        same(result.revisionId, command.revisionId)
      );
    case "SUBMIT":
      return (
        result.kind === "OPERATION" &&
        result.operation.kind === command.intent.kind &&
        result.operation.sourceLocale === command.intent.sourceLocale &&
        (!("id" in command.intent) ||
          command.intent.id === null ||
          (result.operation.targetId !== null &&
            same(result.operation.targetId, command.intent.id)))
      );
  }
}
export function registerManagementCenterRoute(
  instance: FastifyInstance,
  options: ManagementCenterRouteDependencies,
): void {
  for (const [path, action, mutation] of routes)
    registerPrivateAdminEndpoint(instance, {
      path: `/api/v1/admin/management/${path}`,
      allowedOrigin: options.allowedOrigin,
      bodyLimit: 64 * 1024,
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
          throw new TypeError("Invalid management body");
        return managementCenterRequestSchema.parse({
          ...envelope,
          command: managementCenterCommandSchema.parse({
            ...body,
            action,
            ...(mutation ? { idempotencyKey: key } : {}),
          }),
        });
      },
      execute: (input) => options.useCases.execute(input),
      parseResponse(input, request) {
        const response = managementCenterResponseSchema.parse(input);
        if (
          !matches(
            managementCenterRequestSchema.parse(request).command,
            response,
          )
        )
          throw new TypeError("Mismatched management response");
        return response;
      },
    });
}
