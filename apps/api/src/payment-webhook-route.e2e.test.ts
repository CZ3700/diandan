import { Buffer } from "node:buffer";

import Fastify, { type FastifyInstance } from "fastify";
import {
  receivePaymentWebhookResponseSchema,
  type PaymentWebhookEndpointPreflightCommand,
  type PaymentWebhookEndpointPreflightResult,
  type ReceivePaymentWebhookCommand,
  type ReceivePaymentWebhookResponse,
} from "@fan-support/contracts";
import { registerFastifyObservability } from "@fan-support/observability/fastify";
import { startNodeTelemetry } from "@fan-support/observability/node";
import { expect, test } from "vitest";

type Receiver = Readonly<{
  receive: (
    command: ReceivePaymentWebhookCommand,
  ) => Promise<ReceivePaymentWebhookResponse>;
}>;

type EndpointPreflight = (
  command: PaymentWebhookEndpointPreflightCommand,
) => Promise<PaymentWebhookEndpointPreflightResult>;

type RouteModule = Readonly<{
  registerPaymentWebhookRoute: (
    instance: FastifyInstance,
    options: Readonly<{
      receiver: Receiver;
      endpointPreflight: EndpointPreflight;
      now?: () => Date;
      createCorrelationId?: () => string;
      verificationHeaderNames?: readonly string[];
    }>,
  ) => void;
}>;

async function loadRouteModule(): Promise<RouteModule | undefined> {
  return import("./payment-webhook-route.js").catch(() => undefined) as Promise<
    RouteModule | undefined
  >;
}

const acceptedResponse = receivePaymentWebhookResponseSchema.parse({
  schemaVersion: 1,
  operation: "RECEIVE_PAYMENT_WEBHOOK",
  outcome: "SUCCESS",
  value: {
    decision: "ACCEPTED_NEW",
    webhookInboxId: "40000000-0000-4000-8000-000000000001",
    providerEventRowId: "50000000-0000-4000-8000-000000000001",
  },
});

const eligibleEndpointPreflight: EndpointPreflight = () =>
  Promise.resolve(Object.freeze({ schemaVersion: 1, outcome: "ELIGIBLE" }));

test("rejects noncanonical webhook endpoint IDs before preflight", async () => {
  const routeModule = await loadRouteModule();
  expect(routeModule).toBeDefined();
  if (routeModule === undefined) {
    return;
  }

  const telemetry = startNodeTelemetry({ service: "api" });
  const application = Fastify({ logger: false });
  registerFastifyObservability(application, {
    service: "api",
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
  let preflightCalls = 0;
  let receiverCalls = 0;
  routeModule.registerPaymentWebhookRoute(application, {
    endpointPreflight: () => {
      preflightCalls += 1;
      return Promise.resolve({ schemaVersion: 1, outcome: "ELIGIBLE" });
    },
    receiver: {
      receive: () => {
        receiverCalls += 1;
        return Promise.resolve(acceptedResponse);
      },
    },
  });

  try {
    await application.ready();
    const invalidEndpointIds = [
      "A0000000-0000-4000-8000-000000000011",
      "a0000000-0000-1000-8000-000000000011",
      "00000000-0000-0000-0000-000000000000",
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
    ];
    const responses = await Promise.all(
      invalidEndpointIds.map((invalidEndpointId, index) =>
        application.inject({
          method: "POST",
          url: `/api/v1/webhooks/payments/${invalidEndpointId}`,
          headers: {
            "content-type": "application/json",
            "x-request-id": `30000000-0000-4000-8000-${String(index + 20).padStart(12, "0")}`,
          },
          payload: "{}",
        }),
      ),
    );

    expect(responses.map((response) => response.statusCode)).toEqual([
      400, 400, 400, 400,
    ]);
    expect(preflightCalls).toBe(0);
    expect(receiverCalls).toBe(0);
  } finally {
    await application.close();
    await telemetry.shutdown();
  }
});

test("keeps supported provider payload bytes exact inside a scoped parser", async () => {
  const routeModule = await loadRouteModule();
  expect(
    routeModule,
    "the payment webhook transport must be implemented",
  ).toBeDefined();
  if (routeModule === undefined) {
    return;
  }

  const telemetry = startNodeTelemetry({ service: "api" });
  const logLines: string[] = [];
  const application = Fastify({ logger: false });
  registerFastifyObservability(application, {
    service: "api",
    logger: {
      info: (_event, fields) => logLines.push(JSON.stringify(fields)),
      warn: (_event, fields) => logLines.push(JSON.stringify(fields)),
      error: (_event, fields) => logLines.push(JSON.stringify(fields)),
    },
  });
  application.removeContentTypeParser("application/json");
  application.addContentTypeParser<string>(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
      try {
        done(null, JSON.parse(body) as unknown);
      } catch (error: unknown) {
        done(error as Error);
      }
    },
  );
  application.addContentTypeParser<string>(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => done(null, { rootFormBody: body }),
  );

  const commands: ReceivePaymentWebhookCommand[] = [];
  const preflightCommands: Parameters<EndpointPreflight>[0][] = [];
  const receiver: Receiver = {
    receive: (command) => {
      commands.push(command);
      return Promise.resolve(acceptedResponse);
    },
  };
  let correlationSequence = 0;

  application.post("/ordinary-json", async (request) => request.body);
  application.post("/ordinary-form", async (request) => request.body);
  application.post("/ordinary-text", async (request) => request.body);
  routeModule.registerPaymentWebhookRoute(application, {
    receiver,
    endpointPreflight: (command) => {
      preflightCommands.push(command);
      return Promise.resolve(
        Object.freeze({ schemaVersion: 1, outcome: "ELIGIBLE" }),
      );
    },
    now: () => new Date("2026-09-04T02:03:04.005Z"),
    createCorrelationId: () => {
      correlationSequence += 1;
      return `20000000-0000-4000-8000-${String(correlationSequence).padStart(12, "0")}`;
    },
  });

  const endpointId = "10000000-0000-4000-8000-000000000001";
  const requestId = "30000000-0000-4000-8000-000000000001";
  const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
  const signatureCanary = "signature-canary-90210";
  const credentialCanary = "credential-canary-18472";
  const payloads = [
    {
      contentType: "application/json",
      body: Buffer.from('{  "z": 2,\n "message": "你好", "a": 1 }', "utf8"),
    },
    {
      contentType: "application/json",
      body: Buffer.from('{"malformed":"你好"', "utf8"),
    },
    {
      contentType: "application/vnd.provider-event+json; charset=utf-8",
      body: Buffer.from('{"vendorMalformed":"你好"', "utf8"),
    },
    {
      contentType: "application/x-www-form-urlencoded",
      body: Buffer.from("event=a+b&message=%E4%BD%A0%E5%A5%BD", "utf8"),
    },
    {
      contentType: "text/plain; charset=utf-8",
      body: Buffer.from("plain webhook 你好\n", "utf8"),
    },
    {
      contentType: "application/octet-stream",
      body: Buffer.from([0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff]),
    },
  ];

  try {
    await application.ready();

    const ordinaryResponse = await application.inject({
      method: "POST",
      url: "/ordinary-json",
      headers: { "content-type": "application/json" },
      payload: '{"still":"parsed"}',
    });
    expect(ordinaryResponse.statusCode).toBe(200);
    expect(ordinaryResponse.json()).toEqual({ still: "parsed" });
    const ordinaryFormResponse = await application.inject({
      method: "POST",
      url: "/ordinary-form",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "still=parsed+as+form",
    });
    expect(ordinaryFormResponse.statusCode).toBe(200);
    expect(ordinaryFormResponse.json()).toEqual({
      rootFormBody: "still=parsed+as+form",
    });
    const ordinaryTextResponse = await application.inject({
      method: "POST",
      url: "/ordinary-text",
      headers: { "content-type": "text/plain" },
      payload: "still parsed as text",
    });
    expect(ordinaryTextResponse.statusCode).toBe(200);
    expect(ordinaryTextResponse.payload).toBe("still parsed as text");

    for (const { body, contentType } of payloads) {
      const response = await application.inject({
        method: "POST",
        url: `/api/v1/webhooks/payments/${endpointId}`,
        headers: {
          "content-type": contentType,
          "x-request-id": requestId,
          traceparent: `00-${traceId}-00f067aa0ba902b7-01`,
          "x-fan-support-signature": signatureCanary,
          "x-fan-support-timestamp": "1788487384",
          authorization: `Bearer ${credentialCanary}`,
          cookie: `session=${credentialCanary}`,
          "x-unrelated-provider-header": credentialCanary,
        },
        payload: body,
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ schemaVersion: 1, status: "accepted" });
    }

    expect(commands).toHaveLength(payloads.length);
    expect(preflightCommands).toEqual(
      payloads.map(() => ({
        schemaVersion: 1,
        endpointId,
        receivedAt: "2026-09-04T02:03:04.005Z",
      })),
    );
    expect(commands.map((command) => command.rawBodyBase64)).toEqual(
      payloads.map(({ body }) => body.toString("base64url")),
    );
    expect(commands).toEqual(
      payloads.map(({ body }, index) => ({
        schemaVersion: 1,
        operation: "RECEIVE_PAYMENT_WEBHOOK",
        endpointId,
        rawBodyBase64: body.toString("base64url"),
        headers: {
          "x-fan-support-signature": signatureCanary,
          "x-fan-support-timestamp": "1788487384",
        },
        receivedAt: "2026-09-04T02:03:04.005Z",
        correlationId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        propagation: {
          schemaVersion: 1,
          requestId,
          traceparent: expect.stringMatching(
            new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`, "u"),
          ),
        },
      })),
    );
    expect(logLines.join("\n")).not.toContain(signatureCanary);
    expect(logLines.join("\n")).not.toContain(credentialCanary);
    expect(logLines.join("\n")).not.toContain(
      payloads[0]?.body.toString("utf8"),
    );
  } finally {
    await application.close();
    await telemetry.shutdown();
  }
});

test("rejects a non-UUID endpoint before invoking the receiver", async () => {
  const routeModule = await loadRouteModule();
  expect(routeModule).toBeDefined();
  if (routeModule === undefined) {
    return;
  }

  const telemetry = startNodeTelemetry({ service: "api" });
  const logLines: string[] = [];
  const application = Fastify({ logger: false });
  registerFastifyObservability(application, {
    service: "api",
    logger: {
      info: (_event, fields) => logLines.push(JSON.stringify(fields)),
      warn: (_event, fields) => logLines.push(JSON.stringify(fields)),
      error: (_event, fields) => logLines.push(JSON.stringify(fields)),
    },
  });
  let calls = 0;
  routeModule.registerPaymentWebhookRoute(application, {
    endpointPreflight: eligibleEndpointPreflight,
    receiver: {
      receive: () => {
        calls += 1;
        return Promise.resolve(acceptedResponse);
      },
    },
  });
  const endpointCanary = "invalid-PRIVATE_ENDPOINT_CANARY_9123";
  const rawCanary = "PRIVATE_RAW_BODY_CANARY_27182";
  const signatureCanary = "PRIVATE_SIGNATURE_CANARY_31415";
  const requestId = "30000000-0000-4000-8000-000000000002";
  const oversizedPayload = Buffer.alloc(49_153, 0x78);
  oversizedPayload.write(rawCanary);

  try {
    await application.ready();
    const response = await application.inject({
      method: "POST",
      url: `/api/v1/webhooks/payments/${endpointCanary}`,
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
        "x-fan-support-signature": signatureCanary,
        "x-fan-support-timestamp": "1788487384",
      },
      payload: oversizedPayload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      code: "REQUEST_REJECTED",
      requestId,
    });
    expect(calls).toBe(0);
    const exposed = `${response.payload}\n${logLines.join("\n")}`;
    expect(exposed).not.toContain(endpointCanary);
    expect(exposed).not.toContain(rawCanary);
    expect(exposed).not.toContain(signatureCanary);
  } finally {
    await application.close();
    await telemetry.shutdown();
  }
});

test("finishes endpoint preflight before reading an oversized body", async () => {
  const routeModule = await loadRouteModule();
  expect(routeModule).toBeDefined();
  if (routeModule === undefined) {
    return;
  }

  const telemetry = startNodeTelemetry({ service: "api" });
  const logLines: string[] = [];
  const application = Fastify({ logger: false });
  registerFastifyObservability(application, {
    service: "api",
    logger: {
      info: (_event, fields) => logLines.push(JSON.stringify(fields)),
      warn: (_event, fields) => logLines.push(JSON.stringify(fields)),
      error: (_event, fields) => logLines.push(JSON.stringify(fields)),
    },
  });
  const preflightErrorCanary = "PRIVATE_PREFLIGHT_ERROR_CANARY_42424";
  const malformedPreflightCanary = "PRIVATE_PREFLIGHT_RESULT_CANARY_61616";
  const rawCanary = "PRIVATE_PREFLIGHT_RAW_CANARY_51515";
  const preflightResults: Array<
    Awaited<ReturnType<EndpointPreflight>> | Error | unknown
  > = [
    { schemaVersion: 1, outcome: "UNAVAILABLE" },
    { schemaVersion: 1, outcome: "INVALID_REQUEST" },
    { schemaVersion: 1, outcome: "TEMPORARY_UNAVAILABLE" },
    {
      schemaVersion: 1,
      outcome: "ELIGIBLE",
      unexpected: malformedPreflightCanary,
    },
    new Error(preflightErrorCanary),
  ];
  const preflightCommands: Parameters<EndpointPreflight>[0][] = [];
  let receiverCalls = 0;
  routeModule.registerPaymentWebhookRoute(application, {
    endpointPreflight: async (command) => {
      preflightCommands.push(command);
      const result = preflightResults.shift();
      if (result instanceof Error) {
        throw result;
      }
      if (result === undefined) {
        throw new Error("unexpected extra preflight call");
      }
      return result as Awaited<ReturnType<EndpointPreflight>>;
    },
    receiver: {
      receive: () => {
        receiverCalls += 1;
        return Promise.resolve(acceptedResponse);
      },
    },
    now: () => new Date("2026-09-04T03:04:05.006Z"),
  });
  const endpointId = "10000000-0000-4000-8000-000000000005";
  const requestIds = [
    "30000000-0000-4000-8000-000000000014",
    "30000000-0000-4000-8000-000000000015",
    "30000000-0000-4000-8000-000000000016",
    "30000000-0000-4000-8000-000000000017",
    "30000000-0000-4000-8000-000000000018",
  ];
  const oversizedPayload = Buffer.alloc(49_153, 0x78);
  oversizedPayload.write(rawCanary);

  try {
    await application.ready();
    const responses = [];
    for (const requestId of requestIds) {
      responses.push(
        await application.inject({
          method: "POST",
          url: `/api/v1/webhooks/payments/${endpointId}`,
          headers: {
            "content-type": "application/json",
            "x-request-id": requestId,
          },
          payload: oversizedPayload,
        }),
      );
    }

    expect(responses.map((response) => response.statusCode)).toEqual([
      404, 400, 503, 503, 503,
    ]);
    expect(responses.map((response) => response.json())).toEqual([
      { schemaVersion: 1, code: "NOT_FOUND", requestId: requestIds[0] },
      {
        schemaVersion: 1,
        code: "REQUEST_REJECTED",
        requestId: requestIds[1],
      },
      { schemaVersion: 1, code: "INTERNAL_ERROR", requestId: requestIds[2] },
      { schemaVersion: 1, code: "INTERNAL_ERROR", requestId: requestIds[3] },
      { schemaVersion: 1, code: "INTERNAL_ERROR", requestId: requestIds[4] },
    ]);
    expect(preflightCommands).toEqual(
      requestIds.map(() => ({
        schemaVersion: 1,
        endpointId,
        receivedAt: "2026-09-04T03:04:05.006Z",
      })),
    );
    expect(receiverCalls).toBe(0);
    const exposed = responses
      .map((response) => response.payload)
      .concat(logLines)
      .join("\n");
    expect(exposed).not.toContain(preflightErrorCanary);
    expect(exposed).not.toContain(malformedPreflightCanary);
    expect(exposed).not.toContain(rawCanary);
  } finally {
    await application.close();
    await telemetry.shutdown();
  }
});

test("accepts 49152 raw bytes and returns a sanitized 413 above the limit", async () => {
  const routeModule = await loadRouteModule();
  expect(routeModule).toBeDefined();
  if (routeModule === undefined) {
    return;
  }

  const telemetry = startNodeTelemetry({ service: "api" });
  const logLines: string[] = [];
  const application = Fastify({ logger: false });
  registerFastifyObservability(application, {
    service: "api",
    logger: {
      info: (_event, fields) => logLines.push(JSON.stringify(fields)),
      warn: (_event, fields) => logLines.push(JSON.stringify(fields)),
      error: (_event, fields) => logLines.push(JSON.stringify(fields)),
    },
  });
  const receivedBodies: string[] = [];
  routeModule.registerPaymentWebhookRoute(application, {
    endpointPreflight: eligibleEndpointPreflight,
    receiver: {
      receive: (command) => {
        receivedBodies.push(command.rawBodyBase64);
        return Promise.resolve(acceptedResponse);
      },
    },
  });
  const marker = "PRIVATE_BODY_LIMIT_CANARY_16180";
  const bytesAtLimit = Buffer.alloc(49_152, 0x61);
  bytesAtLimit.write(marker);
  const bytesOverLimit = Buffer.alloc(49_153, 0x62);
  bytesOverLimit.write(marker);
  const endpointId = "10000000-0000-4000-8000-000000000002";
  const requestId = "30000000-0000-4000-8000-000000000003";

  try {
    await application.ready();
    const accepted = await application.inject({
      method: "POST",
      url: `/api/v1/webhooks/payments/${endpointId}`,
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
      },
      payload: bytesAtLimit,
    });
    const rejected = await application.inject({
      method: "POST",
      url: `/api/v1/webhooks/payments/${endpointId}`,
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
      },
      payload: bytesOverLimit,
    });

    expect(accepted.statusCode).toBe(202);
    expect(rejected.statusCode).toBe(413);
    expect(rejected.json()).toEqual({
      schemaVersion: 1,
      code: "REQUEST_REJECTED",
      requestId,
    });
    expect(receivedBodies).toEqual([bytesAtLimit.toString("base64url")]);
    expect(`${rejected.payload}\n${logLines.join("\n")}`).not.toContain(marker);
  } finally {
    await application.close();
    await telemetry.shutdown();
  }
});

test("maps receiver outcomes to sanitized HTTP responses", async () => {
  const routeModule = await loadRouteModule();
  expect(routeModule).toBeDefined();
  if (routeModule === undefined) {
    return;
  }

  const telemetry = startNodeTelemetry({ service: "api" });
  const logLines: string[] = [];
  const application = Fastify({ logger: false });
  registerFastifyObservability(application, {
    service: "api",
    logger: {
      info: (_event, fields) => logLines.push(JSON.stringify(fields)),
      warn: (_event, fields) => logLines.push(JSON.stringify(fields)),
      error: (_event, fields) => logLines.push(JSON.stringify(fields)),
    },
  });
  const thrownCanary = "PRIVATE_RECEIVER_THROW_CANARY_14142";
  const malformedResultCanary = "PRIVATE_RESULT_CANARY_70710";
  const failure = (
    code:
      | "INVALID_REQUEST"
      | "ENDPOINT_UNAVAILABLE"
      | "INVALID_SIGNATURE"
      | "EVENT_OUTSIDE_TOLERANCE"
      | "UNSUPPORTED_EVENT"
      | "IDEMPOTENCY_CONFLICT"
      | "CONFIGURATION_ERROR",
  ) =>
    ({
      schemaVersion: 1,
      operation: "RECEIVE_PAYMENT_WEBHOOK",
      outcome: "FAILURE",
      error: { schemaVersion: 1, code, recovery: "NONE" },
    }) as const satisfies ReceivePaymentWebhookResponse;
  const results: Array<ReceivePaymentWebhookResponse | Error | unknown> = [
    failure("INVALID_REQUEST"),
    failure("ENDPOINT_UNAVAILABLE"),
    failure("INVALID_SIGNATURE"),
    failure("EVENT_OUTSIDE_TOLERANCE"),
    failure("UNSUPPORTED_EVENT"),
    failure("IDEMPOTENCY_CONFLICT"),
    {
      schemaVersion: 1,
      operation: "RECEIVE_PAYMENT_WEBHOOK",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "TEMPORARY_UNAVAILABLE",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 2_500,
      },
    },
    failure("CONFIGURATION_ERROR"),
    {
      schemaVersion: 2,
      operation: "RECEIVE_PAYMENT_WEBHOOK",
      outcome: "FAILURE",
      details: malformedResultCanary,
    },
    new Error(thrownCanary),
  ];
  routeModule.registerPaymentWebhookRoute(application, {
    endpointPreflight: eligibleEndpointPreflight,
    receiver: {
      receive: () => {
        const result = results.shift();
        if (result instanceof Error) {
          return Promise.reject(result);
        }
        if (result === undefined) {
          return Promise.reject(new Error("unexpected extra receiver call"));
        }
        return Promise.resolve(result as ReceivePaymentWebhookResponse);
      },
    },
  });
  const endpointId = "10000000-0000-4000-8000-000000000003";
  const signatureCanary = "PRIVATE_REJECTED_SIGNATURE_CANARY_17320";
  const rawCanary = "PRIVATE_REJECTED_RAW_CANARY_22360";
  const requestIds = Array.from(
    { length: results.length },
    (_, index) =>
      `30000000-0000-4000-8000-${String(index + 4).padStart(12, "0")}`,
  );

  try {
    await application.ready();
    const responses = [];
    for (const requestId of requestIds) {
      responses.push(
        await application.inject({
          method: "POST",
          url: `/api/v1/webhooks/payments/${endpointId}`,
          headers: {
            "content-type": "application/json",
            "x-request-id": requestId,
            "x-fan-support-signature": signatureCanary,
            "x-fan-support-timestamp": "1788487384",
          },
          payload: rawCanary,
        }),
      );
    }

    expect(responses.map((response) => response.statusCode)).toEqual([
      400, 404, 400, 400, 400, 409, 503, 503, 503, 503,
    ]);
    expect(
      responses.map((response) => response.headers["retry-after"]),
    ).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "3",
      undefined,
      undefined,
      undefined,
    ]);
    expect(responses.map((response) => response.json())).toEqual(
      requestIds.map((requestId, index) => ({
        schemaVersion: 1,
        code:
          index === 1
            ? "NOT_FOUND"
            : [6, 7, 8, 9].includes(index)
              ? "INTERNAL_ERROR"
              : "REQUEST_REJECTED",
        requestId,
      })),
    );
    const exposed = responses
      .map((response) => response.payload)
      .concat(logLines)
      .join("\n");
    expect(exposed).not.toContain(thrownCanary);
    expect(exposed).not.toContain(malformedResultCanary);
    expect(exposed).not.toContain(signatureCanary);
    expect(exposed).not.toContain(rawCanary);
    expect(exposed).not.toContain("IDEMPOTENCY_CONFLICT");
    expect(exposed).not.toContain("CONFIGURATION_ERROR");
  } finally {
    await application.close();
    await telemetry.shutdown();
  }
});

test("supports an injected provider header allowlist without forwarding credentials", async () => {
  const routeModule = await loadRouteModule();
  expect(routeModule).toBeDefined();
  if (routeModule === undefined) {
    return;
  }

  const telemetry = startNodeTelemetry({ service: "api" });
  const application = Fastify({ logger: false });
  registerFastifyObservability(application, {
    service: "api",
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
  const receivedHeaders: Array<Readonly<Record<string, string>>> = [];
  routeModule.registerPaymentWebhookRoute(application, {
    endpointPreflight: eligibleEndpointPreflight,
    receiver: {
      receive: (command) => {
        receivedHeaders.push(command.headers);
        return Promise.resolve(acceptedResponse);
      },
    },
    verificationHeaderNames: ["x-provider-signature", "x-provider-time"],
  });

  try {
    await application.ready();
    const response = await application.inject({
      method: "POST",
      url: "/api/v1/webhooks/payments/10000000-0000-4000-8000-000000000004",
      headers: {
        "content-type": "application/json",
        "x-provider-signature": "provider-signature",
        "x-provider-time": "1788487384",
        "x-fan-support-signature": "default-signature-must-not-cross",
        authorization: "credential-must-not-cross",
        cookie: "credential-must-not-cross",
      },
      payload: "{}",
    });

    expect(response.statusCode).toBe(202);
    expect(receivedHeaders).toEqual([
      {
        "x-provider-signature": "provider-signature",
        "x-provider-time": "1788487384",
      },
    ]);
  } finally {
    await application.close();
    await telemetry.shutdown();
  }
});

test("fails closed on unsafe verification header allowlists", async () => {
  const routeModule = await loadRouteModule();
  expect(routeModule).toBeDefined();
  if (routeModule === undefined) {
    return;
  }

  const unsafeAllowlists: readonly (readonly unknown[])[] = [
    [],
    ["X-Provider-Signature"],
    ["x-provider-signature", "x-provider-signature"],
    ["x provider signature"],
    [null],
    [42],
    ["authorization"],
    ["cookie"],
    ["proxy-authorization"],
    ["set-cookie"],
  ] as const;

  for (const verificationHeaderNames of unsafeAllowlists) {
    const application = Fastify({ logger: false });
    routeModule.registerPaymentWebhookRoute(application, {
      endpointPreflight: eligibleEndpointPreflight,
      receiver: { receive: () => Promise.resolve(acceptedResponse) },
      verificationHeaderNames: verificationHeaderNames as readonly string[],
    });
    let readyError: unknown;
    try {
      await application.ready();
    } catch (error: unknown) {
      readyError = error;
    } finally {
      await application.close();
    }
    expect(readyError).toBeInstanceOf(Error);
    expect((readyError as Error).message).toBe(
      "Payment webhook header allowlist is invalid",
    );
  }
});
