import type { FastifyInstance } from "fastify";
import {
  adminOrdersCommandSchema,
  adminOrdersRequestSchema,
  adminOrdersResponseSchema,
  adminOrdersPrivateResponseSchema,
  type AdminOrdersCommand,
  type AdminOrdersResponse,
  type AdminOrdersPrivateResponse,
} from "@fan-support/contracts";
import { registerPrivateAdminEndpoint } from "./admin-workspace-transport.js";
export type AdminOrdersRouteDependencies = Readonly<{
  allowedOrigin: string;
  useCases: Readonly<{ execute(input: unknown): Promise<unknown> }>;
}>;
const routes = [
  ["context", "CONTEXT", false],
  ["list", "LIST", false],
  ["detail", "DETAIL", false],
  ["message/read", "READ_MESSAGE", false],
  ["message/review", "REVIEW_MESSAGE", true],
  ["prepare", "PREPARE", true],
  ["deliver", "DELIVER", true],
  ["hold", "HOLD", true],
  ["resume", "RESUME", true],
  ["note/add", "ADD_NOTE", true],
  ["notes/read", "READ_NOTES", false],
  ["notification/resend", "RESEND_NOTIFICATION", true],
] as const;
function matches(
  command: AdminOrdersCommand,
  result: AdminOrdersResponse | AdminOrdersPrivateResponse,
) {
  if (result.outcome === "FAILURE") return true;
  switch (command.action) {
    case "CONTEXT":
      return result.kind === "CONTEXT";
    case "LIST":
      return (
        result.kind === "LIST" &&
        result.page === command.page &&
        result.pageSize === command.pageSize
      );
    case "DETAIL":
      return result.kind === "DETAIL" && result.orderId === command.orderId;
    case "READ_MESSAGE":
      return (
        result.kind === "MESSAGE" &&
        result.orderId === command.orderId &&
        result.itemId === command.itemId &&
        result.intentVersion === command.expectedIntentVersion &&
        result.reviewLocale === command.reviewLocale
      );
    case "READ_NOTES":
      return result.kind === "NOTES" && result.orderId === command.orderId;
    default:
      return result.kind === "MUTATION" && result.orderId === command.orderId;
  }
}
export function registerAdminOrdersRoute(
  instance: FastifyInstance,
  options: AdminOrdersRouteDependencies,
): void {
  for (const [path, action, mutation] of routes)
    registerPrivateAdminEndpoint(instance, {
      path: `/api/v1/admin/orders/${path}`,
      allowedOrigin: options.allowedOrigin,
      bodyLimit: 64 * 1024,
      unavailableCode: "TEMPORARY_UNAVAILABLE",
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
          throw new TypeError("Invalid order operation");
        return adminOrdersRequestSchema.parse({
          ...envelope,
          command: adminOrdersCommandSchema.parse({
            ...body,
            action,
            ...(mutation ? { idempotencyKey: key } : {}),
          }),
        });
      },
      execute: (input) => options.useCases.execute(input),
      parseResponse(input, request) {
        const response = (
          action === "READ_MESSAGE" || action === "READ_NOTES"
            ? adminOrdersPrivateResponseSchema
            : adminOrdersResponseSchema
        ).parse(input);
        if (!matches(adminOrdersRequestSchema.parse(request).command, response))
          throw new TypeError("Mismatched order operation");
        return response;
      },
    });
}
