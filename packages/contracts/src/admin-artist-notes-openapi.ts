import { z } from "zod";
import { adminArtistNoteCommandSchema } from "./admin-artist-notes.js";

type JsonObject = Record<string, unknown>;
const paths = [
  ["context", "CONTEXT"],
  ["read", "READ"],
  ["save", "SAVE"],
] as const;
/** ADR-022 / L3-13: private notes about an artist, for idols.private on a second-factor sign-in. */
export function adminArtistNotesPaths(): JsonObject {
  return Object.fromEntries(
    paths.map(([path, action]) => {
      const command = adminArtistNoteCommandSchema.options.find(
        (candidate) => candidate.shape.action.value === action,
      )!;
      const body = z.toJSONSchema(command, {
        target: "draft-2020-12",
        io: "input",
      }) as JsonObject;
      delete body["$schema"];
      delete (body["properties"] as JsonObject)["action"];
      body["required"] = (body["required"] as string[]).filter(
        (name) => name !== "action",
      );
      return [
        `/api/v1/admin/artist-notes/${path}`,
        {
          post: {
            operationId: `adminArtistNotes${action[0]}${action.slice(1).toLowerCase()}`,
            summary: action.toLowerCase(),
            description:
              "Requires a current admin session, exact Origin and CSRF, and idols.private. Reading and saving also need a built-in sign-in that used a TOTP code or a recovery code while the account still has TOTP; otherwise the context reports why and the other calls answer SECOND_FACTOR_REQUIRED. Every save is a new encrypted version checked against the version the editor started from. A read commits an audit and a five-minute access receipt before decryption and rechecks authority before returning plaintext. Unknown fields, query parameters and caller-supplied authority are rejected.",
            security: [{ AdminSession: [], AdminCsrf: [] }],
            parameters: [
              {
                name: "Origin",
                in: "header",
                required: true,
                schema: { type: "string", format: "uri" },
              },
            ],
            requestBody: {
              required: true,
              "x-fan-support-max-body-bytes": 64 * 1024,
              content: { "application/json": { schema: body } },
            },
            responses: Object.fromEntries(
              ["200", "400", "401", "403", "404", "409", "413", "503"].map(
                (status) => [
                  status,
                  {
                    description:
                      status === "200"
                        ? "Strict result; note plaintext only from a read."
                        : "Safe typed rejection without private plaintext, encrypted payloads or credentials.",
                    headers: {
                      "Cache-Control": {
                        schema: { type: "string", const: "private, no-store" },
                      },
                      "X-Robots-Tag": {
                        schema: { type: "string", const: "noindex, nofollow" },
                      },
                      "Referrer-Policy": {
                        schema: { type: "string", const: "no-referrer" },
                      },
                    },
                    content: {
                      "application/json": {
                        schema: {
                          $ref: "#/components/schemas/AdminArtistNoteResponse",
                        },
                      },
                    },
                  },
                ],
              ),
            ),
          },
        },
      ];
    }),
  );
}
