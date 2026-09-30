import { z } from "zod";
import { adminLedgerCommandSchema } from "./admin-ledger.js";

type JsonObject = Record<string, unknown>;
const paths = [
  ["context", "CONTEXT"],
  ["overview", "OVERVIEW"],
  ["artist", "ARTIST"],
  ["export", "EXPORT"],
  ["message/read", "READ_MESSAGE"],
] as const;
/** ADR-022 / L3-12: the read-only artist ledger. */
export function adminLedgerPaths(): JsonObject {
  return Object.fromEntries(
    paths.map(([path, action]) => {
      const command = adminLedgerCommandSchema.options.find(
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
        `/api/v1/admin/ledger/${path}`,
        {
          post: {
            operationId: `adminLedger${action
              .toLowerCase()
              .split("_")
              .map((word) => word[0]!.toUpperCase() + word.slice(1))
              .join("")}`,
            summary: action.toLowerCase().replaceAll("_", " "),
            description:
              "Requires a current admin session, exact Origin and CSRF, and ledger.read (every artist) or ledger.assigned (only the reader's current artists; others read as missing). Figures cover lines whose order's succeeded payment falls inside the period, counted in the deployment's ledger time zone; amounts never mix currencies or TEST with LIVE. Exports record an audit and a receipt and never carry fan messages, signatures or emails. A message read needs ledger.messages on the reader's own artist (rejected or redacted messages stay withheld) or the orders message rules; it commits an audit before decryption and rechecks authority before returning plaintext. Unknown fields, query parameters and caller-supplied authority or time zone are rejected.",
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
              "x-fan-support-max-body-bytes": 16 * 1024,
              content: { "application/json": { schema: body } },
            },
            responses: Object.fromEntries(
              ["200", "400", "401", "403", "404", "409", "413", "503"].map(
                (status) => [
                  status,
                  {
                    description:
                      status === "200"
                        ? "Strict ledger result; message plaintext only from the message read."
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
                          $ref:
                            action === "READ_MESSAGE"
                              ? "#/components/schemas/AdminLedgerMessageResponse"
                              : "#/components/schemas/AdminLedgerResponse",
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
