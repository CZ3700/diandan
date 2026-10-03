import { expect, test } from "vitest";
import { createContractArtifactDocuments } from "./artifact-documents.js";
import { contractArtifactRegistry } from "./artifact-registry.js";

type JsonObject = Record<string, unknown>;
const operations = [
  ["list", "content.read", false],
  ["read", "content.read", false],
  ["save", "content.edit", true],
  ["submit", "content.edit", true],
  ["approve", "content.translation.review", true],
  ["publish", "content.publish", true],
  ["unpublish", "content.publish", true],
  ["restore", "content.publish", true],
  ["history", "content.read", false],
] as const;
const roots = {
  InformationPageAuthorizationCommand: "internal",
  InformationPageCommand: "internal",
  InformationPageRequest: "internal",
  InformationPageWorkspace: "admin-http",
  InformationPageResponse: "admin-http",
  InformationPagePreviewDocument: "admin-http",
  InformationPagePreviewMessage: "admin-http",
  InformationPagePreviewReady: "admin-http",
  PublicInformationPageRequest: "internal",
  PublicInformationPageIndexRequest: "internal",
  PublicInformationPageResponse: "public-http",
  PublicInformationPageIndexResponse: "public-http",
} as const;

test("registers independent information-page boundaries without exposing internal requests in OpenAPI", () => {
  const document = createContractArtifactDocuments();
  const definitions = document.jsonSchema["$defs"] as JsonObject;
  const components = (document.openapi["components"] as JsonObject)[
    "schemas"
  ] as JsonObject;
  for (const [name, audience] of Object.entries(roots)) {
    expect(
      contractArtifactRegistry.find((entry) => entry.name === name),
      name,
    ).toMatchObject({ audience, versionedRoot: true });
    expect(definitions, name).toHaveProperty(name);
    expect(Object.hasOwn(components, name), name).toBe(audience !== "internal");
  }
});

test("documents only the nine private information operations with canonical header authority", () => {
  const paths = createContractArtifactDocuments().openapi[
    "paths"
  ] as JsonObject;
  expect(
    Object.keys(paths)
      .filter((path) => path.startsWith("/api/v1/admin/information-pages/"))
      .sort(),
  ).toEqual(
    operations
      .map(([suffix]) => `/api/v1/admin/information-pages/${suffix}`)
      .sort(),
  );
  for (const [suffix, permission, mutation] of operations) {
    const path = paths[
      `/api/v1/admin/information-pages/${suffix}`
    ] as JsonObject;
    expect(Object.keys(path)).toEqual(["post"]);
    const operation = path["post"] as JsonObject;
    expect(operation["security"]).toEqual([
      { AdminSession: [], AdminCsrf: [] },
    ]);
    expect(operation["x-fan-support-rbac"]).toBe(permission);
    const parameters = operation["parameters"] as {
      name: string;
      required: boolean;
      in: string;
    }[];
    expect(parameters.map((parameter) => parameter.name)).toEqual(
      mutation ? ["Origin", "Idempotency-Key"] : ["Origin"],
    );
    expect(
      parameters.every(
        (parameter) => parameter.required && parameter.in === "header",
      ),
    ).toBe(true);
    const request = operation["requestBody"] as {
      "x-fan-support-max-body-bytes": number;
      content: {
        "application/json": {
          schema: {
            properties: JsonObject;
            required: string[];
            additionalProperties: boolean;
          };
        };
      };
    };
    expect(request["x-fan-support-max-body-bytes"]).toBe(256 * 1024);
    const schema = request.content["application/json"].schema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain("schemaVersion");
    expect(schema.required.includes("expectedVersion")).toBe(mutation);
    for (const key of [
      "action",
      "idempotencyKey",
      "sessionToken",
      "csrfToken",
      "requestId",
      "actorId",
      "sessionId",
    ])
      expect(schema.properties).not.toHaveProperty(key);
    const responses = operation["responses"] as Record<
      string,
      {
        headers: Record<string, { schema: { const: string } }>;
        content: { "application/json": { schema: { $ref: string } } };
      }
    >;
    expect(responses).not.toHaveProperty("304");
    for (const response of Object.values(responses)) {
      expect(response.headers["Cache-Control"]?.schema.const).toBe(
        "private, no-store",
      );
      expect(response.headers["X-Robots-Tag"]?.schema.const).toBe(
        "noindex, nofollow",
      );
      expect(response.headers["Referrer-Policy"]?.schema.const).toBe(
        "no-referrer",
      );
      expect(response.content["application/json"].schema.$ref).toBe(
        "#/components/schemas/InformationPageResponse",
      );
    }
  }
});

test("documents two published-only reads with exact key and locale parameters and no preview grant", () => {
  const paths = createContractArtifactDocuments().openapi[
    "paths"
  ] as JsonObject;
  const base = "/api/v1/storefront/information-pages";
  expect(
    Object.keys(paths)
      .filter((path) => path.startsWith(base))
      .sort(),
  ).toEqual([base, `${base}/{pageKey}`]);
  for (const [path, schemaName] of [
    [base, "PublicInformationPageIndexResponse"],
    [`${base}/{pageKey}`, "PublicInformationPageResponse"],
  ]) {
    const pathItem = paths[path!] as JsonObject;
    expect(Object.keys(pathItem)).toEqual(["get"]);
    const operation = pathItem["get"] as JsonObject;
    expect(operation["security"]).toEqual([]);
    expect(operation).not.toHaveProperty("requestBody");
    const parameters = operation["parameters"] as {
      name: string;
      in: string;
      required: boolean;
      schema: JsonObject;
    }[];
    expect(parameters.map((parameter) => parameter.name)).toEqual(
      path === base ? ["locale"] : ["pageKey", "locale"],
    );
    expect(parameters.every((parameter) => parameter.required)).toBe(true);
    expect(
      parameters.find((parameter) => parameter.name === "locale"),
    ).toMatchObject({
      in: "query",
      schema: { $ref: "#/components/schemas/SupportedLocale" },
    });
    if (path !== base)
      expect(parameters[0]).toMatchObject({
        in: "path",
        schema: { enum: ["ABOUT", "FAQ", "SUPPORT"] },
      });
    const responses = operation["responses"] as Record<
      string,
      {
        headers: Record<string, { schema: { const: string } }>;
        content: { "application/json": { schema: { $ref: string } } };
      }
    >;
    expect(Object.keys(responses).sort()).toEqual(
      path === base ? ["200", "400", "503"] : ["200", "400", "404", "503"],
    );
    for (const response of Object.values(responses)) {
      expect(response.headers["Cache-Control"]?.schema.const).toBe("no-store");
      expect(response.content["application/json"].schema.$ref).toBe(
        `#/components/schemas/${schemaName}`,
      );
    }
  }
  expect(
    Object.keys(paths).filter(
      (path) => path.includes("information") && path.includes("preview"),
    ),
  ).toEqual([]);
});
