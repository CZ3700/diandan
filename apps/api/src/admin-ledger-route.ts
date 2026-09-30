import type { FastifyInstance } from "fastify";
import {
  adminLedgerCommandSchema,
  adminLedgerMessageResponseSchema,
  adminLedgerRequestSchema,
  adminLedgerResponseSchema,
  type AdminLedgerCommand,
  type AdminLedgerMessageResponse,
  type AdminLedgerResponse,
} from "@fan-support/contracts";
import { registerPrivateAdminEndpoint } from "./admin-workspace-transport.js";

/** ADR-022 / L3-12: the artist ledger. Authority and scope are decided in Application and PostgreSQL. */
export type AdminLedgerRouteDependencies = Readonly<{
  allowedOrigin: string;
  useCases: Readonly<{ execute(input: unknown): Promise<unknown> }>;
}>;
export const ADMIN_LEDGER_ROUTES = [
  ["context", "CONTEXT"],
  ["overview", "OVERVIEW"],
  ["artist", "ARTIST"],
  ["export", "EXPORT"],
  ["message/read", "READ_MESSAGE"],
] as const;

function matches(
  command: AdminLedgerCommand,
  result: AdminLedgerResponse | AdminLedgerMessageResponse,
): boolean {
  if (result.outcome === "FAILURE") return true;
  switch (command.action) {
    case "READ_MESSAGE":
      return (
        result.kind === "MESSAGE" &&
        result.orderId === command.orderId &&
        result.itemId === command.itemId &&
        result.intentVersion === command.expectedIntentVersion &&
        result.reviewLocale === command.reviewLocale
      );
    case "ARTIST":
      return (
        result.kind === "ARTIST" && result.artist.artistId === command.artistId
      );
    default:
      return result.kind === command.action;
  }
}

export function registerAdminLedgerRoute(
  instance: FastifyInstance,
  options: AdminLedgerRouteDependencies,
): void {
  for (const [path, action] of ADMIN_LEDGER_ROUTES)
    registerPrivateAdminEndpoint(instance, {
      path: `/api/v1/admin/ledger/${path}`,
      allowedOrigin: options.allowedOrigin,
      bodyLimit: 16 * 1024,
      unavailableCode: "TEMPORARY_UNAVAILABLE",
      parseRequest(body, envelope) {
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          [
            "action",
            "requestId",
            "actorId",
            "sessionId",
            "sessionToken",
            "csrfToken",
            "timeZone",
          ].some((name) => Object.hasOwn(body, name))
        )
          throw new TypeError("Invalid ledger operation");
        return adminLedgerRequestSchema.parse({
          ...envelope,
          command: adminLedgerCommandSchema.parse({ ...body, action }),
        });
      },
      execute: (input) => options.useCases.execute(input),
      parseResponse(input, request) {
        const response = (
          action === "READ_MESSAGE"
            ? adminLedgerMessageResponseSchema
            : adminLedgerResponseSchema
        ).parse(input);
        if (!matches(adminLedgerRequestSchema.parse(request).command, response))
          throw new TypeError("Mismatched ledger operation");
        return response;
      },
    });
}
