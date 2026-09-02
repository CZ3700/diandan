import { z } from "zod";

import { contractArtifactRegistry } from "./artifact-registry.js";

type JsonObject = Record<string, unknown>;

function withoutDialect(schema: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(schema).filter(([key]) => key !== "$schema"),
  );
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function assertUniqueRegistrationNames(): void {
  const names = contractArtifactRegistry.map(({ name }) => name);
  if (new Set(names).size !== names.length) {
    throw new Error("contract artifact registry names must be unique");
  }
}

function renderJson(value: unknown): string {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function renderSchema(schema: z.ZodType): JsonObject {
  return withoutDialect(
    z.toJSONSchema(schema, {
      target: "draft-2020-12",
      unrepresentable: "throw",
      cycles: "throw",
      reused: "inline",
      io: "input",
    }) as JsonObject,
  );
}

export function createContractArtifactDocuments(): Readonly<{
  jsonSchema: JsonObject;
  openapi: JsonObject;
}> {
  assertUniqueRegistrationNames();
  const definitions = Object.fromEntries(
    contractArtifactRegistry.map((registration) => [
      registration.name,
      renderSchema(registration.schema),
    ]),
  );
  const httpComponents = Object.fromEntries(
    contractArtifactRegistry
      .filter((registration) => registration.audience !== "internal")
      .map((registration) => [
        registration.name,
        {
          ...(definitions[registration.name] as JsonObject),
          "x-fan-support-audience": registration.audience,
        },
      ]),
  );

  return Object.freeze({
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Fan Support Platform Contracts",
      $defs: definitions,
    },
    openapi: {
      openapi: "3.1.0",
      "x-fan-support-document-kind": "schema-components",
      info: {
        title: "Fan Support Platform API Contracts",
        version: "1.0.0",
      },
      paths: {},
      components: {
        schemas: httpComponents,
      },
    },
  });
}

export function renderContractArtifactDocuments(): Readonly<{
  jsonSchema: string;
  openapi: string;
}> {
  const documents = createContractArtifactDocuments();
  return Object.freeze({
    jsonSchema: renderJson(documents.jsonSchema),
    openapi: renderJson(documents.openapi),
  });
}
