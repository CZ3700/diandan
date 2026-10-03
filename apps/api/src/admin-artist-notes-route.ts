import type { FastifyInstance } from "fastify";
import {
  adminArtistNoteCommandSchema,
  adminArtistNoteRequestSchema,
  adminArtistNoteResponseSchema,
  type AdminArtistNoteCommand,
  type AdminArtistNoteResponse,
} from "@fan-support/contracts";
import { registerPrivateAdminEndpoint } from "./admin-workspace-transport.js";

/** ADR-022 / L3-13: private artist notes. Authority and the second-factor gate live in Application and PostgreSQL. */
export type AdminArtistNotesRouteDependencies = Readonly<{
  allowedOrigin: string;
  useCases: Readonly<{ execute(input: unknown): Promise<unknown> }>;
}>;
export const ADMIN_ARTIST_NOTES_ROUTES = [
  ["context", "CONTEXT"],
  ["read", "READ"],
  ["save", "SAVE"],
] as const;

function matches(
  command: AdminArtistNoteCommand,
  result: AdminArtistNoteResponse,
): boolean {
  if (result.outcome === "FAILURE") return true;
  if (result.artistId !== command.artistId) return false;
  switch (command.action) {
    case "READ":
      return result.kind === "NOTE" && result.note.noteId === command.noteId;
    case "SAVE":
      return result.kind === "SAVED" && result.note.noteId === command.noteId;
    default:
      return result.kind === "CONTEXT";
  }
}

export function registerAdminArtistNotesRoute(
  instance: FastifyInstance,
  options: AdminArtistNotesRouteDependencies,
): void {
  for (const [path, action] of ADMIN_ARTIST_NOTES_ROUTES)
    registerPrivateAdminEndpoint(instance, {
      path: `/api/v1/admin/artist-notes/${path}`,
      allowedOrigin: options.allowedOrigin,
      bodyLimit: 64 * 1024,
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
            "gate",
          ].some((name) => Object.hasOwn(body, name))
        )
          throw new TypeError("Invalid artist note operation");
        return adminArtistNoteRequestSchema.parse({
          ...envelope,
          command: adminArtistNoteCommandSchema.parse({ ...body, action }),
        });
      },
      execute: (input) => options.useCases.execute(input),
      parseResponse(input, request) {
        const response = adminArtistNoteResponseSchema.parse(input);
        if (
          !matches(
            adminArtistNoteRequestSchema.parse(request).command,
            response,
          )
        )
          throw new TypeError("Mismatched artist note operation");
        return response;
      },
    });
}
