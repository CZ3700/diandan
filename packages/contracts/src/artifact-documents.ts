import { z } from "zod";

import { contractArtifactRegistry } from "./artifact-registry.js";

type JsonObject = Record<string, unknown>;

const PAYMENT_WEBHOOK_PATH = "/api/v1/webhooks/payments/{endpointId}" as const;
const PAYMENT_WEBHOOK_MAX_BODY_BYTES = 49_152;

function rawWebhookMediaType(): JsonObject {
  return {
    schema: {
      type: "string",
      format: "binary",
      maxLength: PAYMENT_WEBHOOK_MAX_BODY_BYTES,
      description:
        "Exact request bytes before parsing, decoding, normalization, or re-serialization.",
    },
  };
}

function webhookResponse(
  description: string,
  schemaName: "PaymentWebhookAcceptedResponse" | "PublicErrorEnvelope",
  options: Readonly<{ retryAfter?: boolean }> = {},
): JsonObject {
  return {
    description,
    headers: {
      "X-Request-ID": { $ref: "#/components/headers/RequestId" },
      ...(options.retryAfter === true
        ? { "Retry-After": { $ref: "#/components/headers/RetryAfter" } }
        : {}),
    },
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${schemaName}` },
      },
    },
  };
}

function paymentWebhookPath(): JsonObject {
  return {
    post: {
      operationId: "receivePaymentWebhook",
      summary: "Receive a payment provider webhook",
      description:
        "Authenticates the endpoint and both signature headers before accepting the exact, unparsed request bytes for durable processing.",
      security: [
        {
          PaymentWebhookSignature: [],
          PaymentWebhookTimestamp: [],
        },
      ],
      parameters: [
        {
          name: "endpointId",
          in: "path",
          required: true,
          description:
            "Opaque, non-secret UUID that selects the configured webhook endpoint before the body is read.",
          schema: { type: "string", format: "uuid" },
        },
      ],
      requestBody: {
        required: true,
        description: `Exact request bytes used for signature verification. The decoded HTTP body must be at most ${PAYMENT_WEBHOOK_MAX_BODY_BYTES} bytes; parsing or re-serialization before verification is forbidden.`,
        "x-fan-support-body-handling": "exact-raw-bytes",
        "x-fan-support-max-body-bytes": PAYMENT_WEBHOOK_MAX_BODY_BYTES,
        content: {
          "application/json": rawWebhookMediaType(),
          "application/*+json": rawWebhookMediaType(),
          "application/x-www-form-urlencoded": rawWebhookMediaType(),
          "text/plain": rawWebhookMediaType(),
          "application/octet-stream": rawWebhookMediaType(),
        },
      },
      responses: {
        "202": webhookResponse(
          "The durable receipt was accepted or safely replayed; downstream business processing may still be pending.",
          "PaymentWebhookAcceptedResponse",
        ),
        "400": webhookResponse(
          "The endpoint identifier, required authentication headers, payload, signature, timestamp, or normalized event was invalid.",
          "PublicErrorEnvelope",
        ),
        "404": webhookResponse(
          "The webhook endpoint is unavailable.",
          "PublicErrorEnvelope",
        ),
        "409": webhookResponse(
          "The event conflicts with an earlier receipt using the same idempotency identity.",
          "PublicErrorEnvelope",
        ),
        "413": webhookResponse(
          `The exact request body exceeds ${PAYMENT_WEBHOOK_MAX_BODY_BYTES} bytes.`,
          "PublicErrorEnvelope",
        ),
        "503": webhookResponse(
          "The webhook endpoint is temporarily unavailable. Retry-After is present when retrying the same request is safe.",
          "PublicErrorEnvelope",
          { retryAfter: true },
        ),
      },
    },
  };
}

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
      "x-fan-support-document-kind": "implemented-paths-and-schema-components",
      info: {
        title: "Fan Support Platform API Contracts",
        version: "1.0.0",
      },
      paths: {
        [PAYMENT_WEBHOOK_PATH]: paymentWebhookPath(),
      },
      components: {
        schemas: httpComponents,
        headers: {
          RequestId: {
            description:
              "Canonical request identifier for support and tracing.",
            schema: { type: "string", format: "uuid" },
          },
          RetryAfter: {
            description:
              "Minimum whole seconds to wait before retrying the same request.",
            schema: { type: "integer", minimum: 1 },
          },
        },
        securitySchemes: {
          PaymentWebhookSignature: {
            type: "apiKey",
            in: "header",
            name: "X-Fan-Support-Signature",
            description:
              "Provider signature calculated over the exact request bytes; required together with PaymentWebhookTimestamp.",
          },
          PaymentWebhookTimestamp: {
            type: "apiKey",
            in: "header",
            name: "X-Fan-Support-Timestamp",
            description:
              "Provider signature timestamp used for replay-window validation; required together with PaymentWebhookSignature.",
          },
        },
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
