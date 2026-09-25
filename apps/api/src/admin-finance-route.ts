import type { FastifyInstance } from "fastify";
import {
  adminFinanceCommandSchema,
  adminFinanceRequestSchema,
  adminFinanceResponseSchema,
  type AdminFinanceCommand,
  type AdminFinanceResponse,
} from "@fan-support/contracts";
import { registerPrivateAdminEndpoint } from "./admin-workspace-transport.js";
export type AdminFinanceRouteDependencies = Readonly<{
  allowedOrigin: string;
  useCases: Readonly<{ execute(input: unknown): Promise<unknown> }>;
}>;
function matches(command: AdminFinanceCommand, result: AdminFinanceResponse) {
  if (result.outcome === "FAILURE") return true;
  switch (command.action) {
    case "LIST":
      return (
        result.kind === "LIST" &&
        result.page === command.page &&
        result.pageSize === command.pageSize
      );
    case "DETAIL":
      return (
        result.kind === "DETAIL" && result.order.orderId === command.orderId
      );
    case "REFUND":
      return (
        result.kind === "MUTATION" &&
        result.orderId === command.orderId &&
        result.refundId !== null
      );
    case "CANCEL":
      return (
        result.kind === "MUTATION" &&
        result.orderId === command.orderId &&
        result.refundId === null
      );
    case "RECONCILE":
      return (
        result.kind === "MUTATION" &&
        result.orderId === command.orderId &&
        result.refundId ===
          (command.target.kind === "REFUND" ? command.target.refundId : null)
      );
  }
}
/** Financial authority is evaluated in the same PostgreSQL transaction as the durable command receipt. */
export function registerAdminFinanceRoute(
  instance: FastifyInstance,
  options: AdminFinanceRouteDependencies,
): void {
  for (const [path, action, mutation] of [
    ["list", "LIST", false],
    ["detail", "DETAIL", false],
    ["refund", "REFUND", true],
    ["cancel", "CANCEL", true],
    ["reconcile", "RECONCILE", true],
  ] as const)
    registerPrivateAdminEndpoint(instance, {
      path: `/api/v1/admin/finance/${path}`,
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
          throw new TypeError("Invalid finance operation");
        return adminFinanceRequestSchema.parse({
          ...envelope,
          command: adminFinanceCommandSchema.parse({
            ...body,
            action,
            ...(mutation ? { idempotencyKey: key } : {}),
          }),
        });
      },
      execute: (input) => options.useCases.execute(input),
      parseResponse(input, request) {
        const response = adminFinanceResponseSchema.parse(input);
        if (
          !matches(adminFinanceRequestSchema.parse(request).command, response)
        )
          throw new TypeError("Mismatched finance operation");
        return response;
      },
    });
}
