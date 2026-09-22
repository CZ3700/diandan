import type { FastifyInstance } from "fastify";
import { adminPaymentConfigurationResponseMatches } from "@fan-support/application";
import {
  adminPaymentConfigurationCommandSchema,
  adminPaymentConfigurationRequestSchema,
  adminPaymentConfigurationResponseSchema,
} from "@fan-support/contracts";
import { registerPrivateAdminEndpoint } from "./admin-workspace-transport.js";
export type AdminPaymentConfigurationRouteDependencies = Readonly<{
  allowedOrigin: string;
  useCases: Readonly<{ execute(input: unknown): Promise<unknown> }>;
}>;
export function registerAdminPaymentConfigurationRoute(
  instance: FastifyInstance,
  options: AdminPaymentConfigurationRouteDependencies,
): void {
  for (const [path, action, mutation] of [
    ["read", "READ", false],
    ["save", "SAVE", true],
    ["submit", "SUBMIT", true],
    ["approve", "APPROVE", true],
    ["validate", "VALIDATE", false],
    ["publish", "PUBLISH", true],
    ["rollback", "ROLLBACK", true],
  ] as const)
    registerPrivateAdminEndpoint(instance, {
      path: `/api/v1/admin/payment-configuration/${path}`,
      allowedOrigin: options.allowedOrigin,
      bodyLimit: 512 * 1024,
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
          throw new TypeError("Invalid payment configuration operation");
        return adminPaymentConfigurationRequestSchema.parse({
          ...envelope,
          command: adminPaymentConfigurationCommandSchema.parse({
            ...body,
            action,
            ...(mutation ? { idempotencyKey: key } : {}),
          }),
        });
      },
      execute: (input) => options.useCases.execute(input),
      parseResponse(input, request) {
        const response = adminPaymentConfigurationResponseSchema.parse(input);
        if (
          !adminPaymentConfigurationResponseMatches(
            adminPaymentConfigurationRequestSchema.parse(request).command,
            response,
          )
        )
          throw new TypeError("Mismatched payment configuration operation");
        return response;
      },
    });
}
