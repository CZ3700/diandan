import type { FastifyInstance } from "fastify";
import type { AdminSessionUseCases } from "@fan-support/application";
import {
  adminSessionCommandSchema,
  adminSessionRequestSchema,
  adminSessionResponseSchema,
} from "@fan-support/contracts";
import { registerPrivateAdminEndpoint } from "./admin-workspace-transport.js";
export type AdminSessionRouteDependencies = Readonly<{
  allowedOrigin: string;
  useCases: AdminSessionUseCases;
}>;
export function registerAdminSessionRoute(
  instance: FastifyInstance,
  options: AdminSessionRouteDependencies,
): void {
  registerPrivateAdminEndpoint(instance, {
    path: "/api/v1/admin/session/read",
    allowedOrigin: options.allowedOrigin,
    bodyLimit: 64 * 1024,
    parseRequest: (body, envelope) => {
      const value = adminSessionCommandSchema
        .omit({ action: true })
        .parse(body);
      return adminSessionRequestSchema.parse({
        ...envelope,
        command: { ...value, action: "READ_SESSION" },
      });
    },
    execute: options.useCases.execute,
    parseResponse: (input) => adminSessionResponseSchema.parse(input),
  });
}
