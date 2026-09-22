import type { FastifyInstance } from "fastify";
import {
  adminExceptionsCommandSchema,
  adminExceptionsRequestSchema,
  adminExceptionsResponseSchema,
  adminExceptionsResponseMatches,
} from "@fan-support/contracts";
import { registerPrivateAdminEndpoint } from "./admin-workspace-transport.js";
export type AdminExceptionsRouteDependencies = Readonly<{
  allowedOrigin: string;
  useCases: Readonly<{ execute(input: unknown): Promise<unknown> }>;
}>;
/** Transport supplies credentials and action; PostgreSQL authorizes the current source atomically. */
export function registerAdminExceptionsRoute(
  instance: FastifyInstance,
  options: AdminExceptionsRouteDependencies,
): void {
  for (const [path, action, mutation] of [
    ["context", "CONTEXT", false],
    ["list", "LIST", false],
    ["detail", "DETAIL", false],
    ["replay-webhook", "REPLAY_WEBHOOK", true],
    ["retry-dead-letter", "RETRY_DEAD_LETTER", true],
    ["reconcile-payment", "RECONCILE_PAYMENT", true],
    ["retry-notification", "RETRY_NOTIFICATION", true],
  ] as const)
    registerPrivateAdminEndpoint(instance, {
      path: `/api/v1/admin/exceptions/${path}`,
      allowedOrigin: options.allowedOrigin,
      bodyLimit: 16384,
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
          throw new TypeError("Invalid exception operation");
        return adminExceptionsRequestSchema.parse({
          ...envelope,
          command: adminExceptionsCommandSchema.parse({
            ...body,
            action,
            ...(mutation ? { idempotencyKey: key } : {}),
          }),
        });
      },
      execute: (input) => options.useCases.execute(input),
      parseResponse(input, request) {
        const response = adminExceptionsResponseSchema.parse(input);
        if (
          !adminExceptionsResponseMatches(
            adminExceptionsRequestSchema.parse(request).command,
            response,
          )
        )
          throw new TypeError("Mismatched exception operation");
        return response;
      },
    });
}
