import { z } from "zod";
import { adminSessionCommandSchema } from "./admin-session.js";
import { adminCatalogCommandSchema } from "./admin-catalog.js";
import { translationWorkspaceCommandSchema } from "./translation-workspace.js";
import { translationTransferCommandSchema } from "./translation-transfer.js";
import { adminPreviewMediaRequestSchema } from "./admin-preview-media.js";

type JsonObject = Record<string, unknown>;
const origin = {
  name: "Origin",
  in: "header",
  required: true,
  schema: { type: "string", format: "uri" },
};
function jsonSchema(input: z.ZodType): JsonObject {
  const value = z.toJSONSchema(input, {
    target: "draft-2020-12",
    io: "input",
  }) as JsonObject;
  delete value["$schema"];
  return value;
}
function responses(success: string): JsonObject {
  return Object.fromEntries(
    ["200", "400", "401", "403", "404", "409", "413", "503"].map((status) => [
      status,
      {
        description:
          status === "200"
            ? "Current authorized, bounded result."
            : "Safe rejection without internal details.",
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
              $ref: `#/components/schemas/${status === "200" ? success : "AdminContentFailure"}`,
            },
          },
        },
      },
    ]),
  );
}
const catalogRoutes = [
  ["owners/list", "content.read", "listAdminOwners"],
  ["owners/read", "content.read", "readAdminOwner"],
  ["history/read", "content.read", "readAdminOwnerHistory"],
  ["idols/create", "content.edit", "createAdminIdol"],
  ["idols/rename", "content.edit", "renameAdminIdol"],
  ["idols/status", "content.edit", "setAdminIdolStatus"],
] as const;
function adminOperation(input: {
  command: z.ZodType;
  operationId: string;
  response: string;
  permission: string;
  description: string;
  concurrency?: string;
  maxBytes?: number;
}): JsonObject {
  const body = jsonSchema(input.command),
    properties = body["properties"] as JsonObject;
  const idempotency = properties["idempotencyKey"];
  delete properties["action"];
  delete properties["idempotencyKey"];
  body["required"] = (body["required"] as string[]).filter(
    (key) => key !== "action" && key !== "idempotencyKey",
  );
  return {
    post: {
      operationId: input.operationId,
      description:
        input.description +
        " Current canonical session, MFA and permission are required. Unknown fields and query strings are rejected.",
      security: [{ AdminSession: [], AdminCsrf: [] }],
      "x-fan-support-rbac": input.permission,
      "x-fan-support-concurrency": input.concurrency ?? "not-applicable",
      "x-fan-support-audit-reason": idempotency
        ? "reasonCode"
        : "not-applicable",
      "x-fan-support-idempotency": idempotency
        ? "Current authorization precedes replay. The same actor, operation, key and raw body replay the original receipt; a changed body conflicts."
        : "not-applicable",
      parameters: [
        origin,
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
        "x-fan-support-max-body-bytes": input.maxBytes ?? 65536,
        content: { "application/json": { schema: body } },
      },
      responses: responses(input.response),
    },
  };
}
export function adminWorkspacePaths(): JsonObject {
  const paths: JsonObject = {
    "/api/v1/admin/session/read": adminOperation({
      command: adminSessionCommandSchema,
      operationId: "readAdminSession",
      response: "AdminSessionResponse",
      permission: "authenticated-session",
      description:
        "Read current permission and locale assignments. This endpoint does not issue login sessions or return session credentials.",
    }),
  };
  for (const [
    index,
    [path, permission, operationId],
  ] of catalogRoutes.entries()) {
    paths[`/api/v1/admin/catalog/${path}`] = adminOperation({
      command: adminCatalogCommandSchema.options[index]!,
      operationId,
      response: "AdminCatalogResponse",
      permission,
      description:
        "Read owner summaries and paged immutable history, or audit an idol identity change. Base identity version, authoring revision number and publication head version are distinct. Archived identity is terminal; status changes do not publish content.",
      concurrency:
        index < 3
          ? "not-applicable"
          : "expectedBaseVersion binds the current idol identity version; creation requires zero.",
    });
  }
  paths["/api/v1/admin/translation-workspace/read"] = adminOperation({
    command: translationWorkspaceCommandSchema,
    operationId: "readTranslationWorkspace",
    response: "TranslationWorkspaceResponse",
    permission: "content.read for selected locale",
    description:
      "Return the selected translation and actual English source, a seven-locale permission-scoped matrix and COPY editability. Restricted locale cells contain no review metadata or text. Historical English is exposed only through proven same-owner COPY lineage; otherwise source diff is explicitly unavailable. The completion matrix is not publication eligibility.",
  });
  for (const command of translationTransferCommandSchema.options) {
    const action = command.shape.action.value;
    paths[`/api/v1/admin/translation-transfer/${action.toLowerCase()}`] =
      adminOperation({
        command,
        operationId:
          action === "EXPORT" ? "exportTranslations" : "importTranslations",
        response: "TranslationTransferResponse",
        permission:
          action === "EXPORT"
            ? "content.read for all exported locales"
            : "content.edit for all locales affected by COPY and extensions",
        maxBytes: 16 * 1024 * 1024,
        concurrency:
          "The export receipt binds authoringHeadVersion, sourceSnapshotHash and actual English source. New imports reject changed canonical source or head; an authorized successful replay returns its original revision.",
        description:
          action === "EXPORT"
            ? "Create an audited JSON translation package containing exact requested locales, actual English, field constraints and immutable receipt metadata. Missing translations remain null. Replaying an export reconstructs the same package from its immutable source. No time-based package TTL is implied. An unsealed legacy DRAFT must first be copied to an immutable authored revision; export otherwise returns CONFLICT."
            : "Import an edited exported package. Only entry text may change; immutable metadata must match the canonical export receipt. Every entry must be filled explicitly. Validate field limits, controlled markup and ICU variables against actual English (or explicitly imported English), then atomically COPY to a new immutable revision with IMPORT provenance and DRAFT review state. No approval is created. Copied aliases and details retain their existing wider locale authorization requirements.",
      });
  }
  paths["/api/v1/admin-preview-media/read"] = {
    post: {
      operationId: "readAdminPreviewMedia",
      description:
        "A preview credential appears only in the JSON body. It authorizes image resolution only for media references of its exact revision and locale. Issuer session, MFA, current permission, locale grant and revocation are checked before and after signing outside database transactions. Return short-lived derivative image URLs and opaque provider headers; no arbitrary asset selector, object key, source EXIF, audit identity or fallback. Deadlines never exceed the preview/session grant; less than the storage adapter's minimum signing window safely fails. Returned URLs remain usable until their short expiry.",
      security: [],
      parameters: [origin],
      requestBody: {
        required: true,
        "x-fan-support-max-body-bytes": 65536,
        content: {
          "application/json": {
            schema: jsonSchema(adminPreviewMediaRequestSchema),
          },
        },
      },
      responses: responses("AdminPreviewMediaResponse"),
    },
  };
  return paths;
}
