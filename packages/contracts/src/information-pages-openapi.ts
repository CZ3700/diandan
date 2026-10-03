import { z } from "zod";
import {
  informationPageCommandSchema,
  informationPageKeySchema,
} from "./information-pages.js";

type JsonObject = Record<string, unknown>;
const operations = [
  ["list", "LIST", "content.read"],
  ["read", "READ", "content.read"],
  ["save", "SAVE_DRAFT", "content.edit"],
  ["submit", "SUBMIT_REVIEW", "content.edit"],
  ["approve", "APPROVE_REVIEW", "content.translation.review"],
  ["publish", "PUBLISH", "content.publish"],
  ["unpublish", "UNPUBLISH", "content.publish"],
  ["restore", "RESTORE", "content.publish"],
  ["history", "HISTORY", "content.read"],
] as const;

function jsonSchema(value: z.ZodType): JsonObject {
  const schema = z.toJSONSchema(value, {
    target: "draft-2020-12",
    io: "input",
  }) as JsonObject;
  delete schema["$schema"];
  return schema;
}

function responses(
  name: string,
  statuses: readonly string[],
  privateResponse: boolean,
): JsonObject {
  const successDescription = privateResponse
    ? "Authorized information-page result; re-read after an idempotent replay for current state."
    : "Current approved published information only; never a saved draft.";
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      {
        description:
          status === "200"
            ? successDescription
            : "Safe typed failure without internal or provider details.",
        headers: {
          "Cache-Control": {
            schema: {
              type: "string",
              const: privateResponse ? "private, no-store" : "no-store",
            },
          },
          "X-Robots-Tag": {
            schema: { type: "string", const: "noindex, nofollow" },
          },
          ...(privateResponse
            ? {
                "Referrer-Policy": {
                  schema: { type: "string", const: "no-referrer" },
                },
              }
            : {}),
        },
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${name}` },
          },
        },
      },
    ]),
  );
}

export function informationPagePaths(): JsonObject {
  const paths: JsonObject = {};
  for (const [suffix, action, permission] of operations) {
    const command = informationPageCommandSchema.options.find(
      (option) => option.shape.action.value === action,
    )!;
    const body = jsonSchema(command);
    const properties = body["properties"] as JsonObject;
    const idempotency = properties["idempotencyKey"];
    delete properties["action"];
    delete properties["idempotencyKey"];
    body["required"] = (body["required"] as string[]).filter(
      (name) => name !== "action" && name !== "idempotencyKey",
    );
    paths[`/api/v1/admin/information-pages/${suffix}`] = {
      post: {
        operationId: `informationPages${suffix[0]!.toUpperCase()}${suffix.slice(1)}`,
        summary: `${action.toLowerCase().replaceAll("_", " ")} an information page`,
        description:
          "Exact Origin, CSRF and current canonical MFA session are required. READ is scoped to the selected locale; saved CURRENT preview is returned only with content.preview. English source/structure edits require edit access to all seven locales; other translations require their locale. Review requires an independent authorized reviewer and current hashes. Publish/restore/unpublish require all-locale publication authority; publication and restore validate all seven approval proofs atomically. Versioned mutations, audit and publication outbox commit together. No preview grant is issued and no text belongs in the URL.",
        "x-fan-support-rbac": permission,
        security: [{ AdminSession: [], AdminCsrf: [] }],
        parameters: [
          {
            name: "Origin",
            in: "header",
            required: true,
            schema: { type: "string", format: "uri" },
          },
          ...(idempotency
            ? [
                {
                  name: "Idempotency-Key",
                  in: "header",
                  required: true,
                  schema: idempotency,
                },
              ]
            : []),
        ],
        requestBody: {
          required: true,
          "x-fan-support-max-body-bytes": 256 * 1024,
          content: { "application/json": { schema: body } },
        },
        responses: responses(
          "InformationPageResponse",
          ["200", "400", "401", "403", "404", "409", "413", "415", "503"],
          true,
        ),
      },
    };
  }
  for (const detail of [false, true]) {
    paths[`/api/v1/storefront/information-pages${detail ? "/{pageKey}" : ""}`] =
      {
        get: {
          operationId: detail
            ? "readPublicInformationPage"
            : "readPublicInformationPageIndex",
          summary: detail
            ? "Read one published information page"
            : "Read published information-page links for a locale",
          description:
            "Requires exactly one supported locale query parameter; unknown and duplicate query parameters are rejected. The detail key is uppercase ABOUT, FAQ or SUPPORT. Current approved PostgreSQL publication proofs determine content, fallback and availableLocales. Detail may fall back to the complete approved English document; the index excludes unavailable locales. No draft, reviewer identity, session, cart or order state is exposed. Responses are initially no-store; absence is distinct from an unavailable read.",
          security: [],
          parameters: [
            ...(detail
              ? [
                  {
                    name: "pageKey",
                    in: "path",
                    required: true,
                    schema: jsonSchema(informationPageKeySchema),
                  },
                ]
              : []),
            {
              name: "locale",
              in: "query",
              required: true,
              schema: { $ref: "#/components/schemas/SupportedLocale" },
            },
          ],
          responses: responses(
            detail
              ? "PublicInformationPageResponse"
              : "PublicInformationPageIndexResponse",
            detail ? ["200", "400", "404", "503"] : ["200", "400", "503"],
            false,
          ),
        },
      };
  }
  return paths;
}
