import { expect, test } from "vitest";

import { createStructuredLogger } from "./logging.js";

type RequestContext = Readonly<{
  schemaVersion: 1;
  requestId: string;
  traceId: string;
  spanId: string;
}>;

type RequestContextModule = Readonly<{
  createPropagationHeaders: () => Readonly<Record<string, string>>;
  currentRequestContext: () => RequestContext | undefined;
  runWithServerRequest: <T>(
    input: Readonly<{
      headers?: unknown;
      logger: ReturnType<typeof createStructuredLogger>;
      method: string;
      route: string;
      service: string;
    }>,
    handler: (requestContext: RequestContext) => Promise<T> | T,
  ) => Promise<T>;
  runWithServerRequestOutcome: <T>(
    input: Readonly<{
      headers?: unknown;
      logger: ReturnType<typeof createStructuredLogger>;
      method: string;
      route: string;
      service: string;
    }>,
    handler: (requestContext: RequestContext) =>
      | Promise<
          Readonly<{
            errorCode?: "INTERNAL_ERROR" | "UPSTREAM_UNAVAILABLE";
            statusCode: number;
            value: T;
          }>
        >
      | Readonly<{
          errorCode?: "INTERNAL_ERROR" | "UPSTREAM_UNAVAILABLE";
          statusCode: number;
          value: T;
        }>,
  ) => Promise<T>;
}>;

type TelemetryHandle = Readonly<{
  forceFlush: () => Promise<void>;
  shutdown: () => Promise<void>;
}>;

type NodeModule = Readonly<{
  startNodeTelemetry: (
    options: Readonly<{ service: string }>,
  ) => TelemetryHandle;
}>;

async function loadRequestContextModule(): Promise<RequestContextModule> {
  let loaded: unknown;
  try {
    loaded = await import("./request-context.js");
  } catch {
    loaded = undefined;
  }

  expect(loaded, "request context module must exist").toBeDefined();
  return loaded as RequestContextModule;
}

async function loadNodeModule(): Promise<NodeModule> {
  let loaded: unknown;
  try {
    loaded = await import("./node.js");
  } catch {
    loaded = undefined;
  }

  expect(loaded, "Node telemetry module must exist").toBeDefined();
  return loaded as NodeModule;
}

test("continues W3C trace context and propagates only correlation headers", async () => {
  const { startNodeTelemetry } = await loadNodeModule();
  const {
    createPropagationHeaders,
    currentRequestContext,
    runWithServerRequest,
  } = await loadRequestContextModule();
  const telemetry = startNodeTelemetry({ service: "storefront" });
  const lines: string[] = [];
  const logger = createStructuredLogger({
    service: "storefront",
    write: (line) => lines.push(line),
  });
  const requestId = "018f47a4-7b7c-4f27-8b35-25c984619a11";
  const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";

  try {
    const result = await runWithServerRequest(
      {
        service: "storefront",
        method: "GET",
        route: "/_internal/observability",
        headers: {
          "x-request-id": requestId,
          traceparent: `00-${traceId}-00f067aa0ba902b7-01`,
          baggage: "fan_message=must-not-propagate",
          authorization: "must-not-propagate",
        },
        logger,
      },
      async (requestContext) => {
        expect(currentRequestContext()).toEqual(requestContext);
        const propagationHeaders = createPropagationHeaders();

        expect(propagationHeaders).toEqual({
          "x-request-id": requestId,
          traceparent: `00-${traceId}-${requestContext.spanId}-01`,
        });
        expect(Object.isFrozen(propagationHeaders)).toBe(true);
        expect(JSON.stringify(propagationHeaders)).not.toContain(
          "must-not-propagate",
        );
        return requestContext;
      },
    );

    expect(result.requestId).toBe(requestId);
    expect(result.traceId).toBe(traceId);
    expect(result.spanId).not.toBe("00f067aa0ba902b7");
    expect(currentRequestContext()).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
      service: "storefront",
      event: "http.request.completed",
      requestId,
      traceId,
      spanId: result.spanId,
      httpMethod: "GET",
      httpRoute: "/_internal/observability",
      httpStatusCode: 200,
      outcome: "success",
    });
  } finally {
    await telemetry.shutdown();
  }
});

test("isolates concurrent request and trace contexts", async () => {
  const { startNodeTelemetry } = await loadNodeModule();
  const { currentRequestContext, runWithServerRequest } =
    await loadRequestContextModule();
  const telemetry = startNodeTelemetry({ service: "api" });
  const logger = createStructuredLogger({ service: "api", write: () => {} });
  const firstRequestId = "112c06de-9518-43e1-b7d2-08df5269ed3b";
  const secondRequestId = "7f751e8c-5831-4de2-819f-b4dd11a286fe";

  try {
    const results = await Promise.all(
      [
        [firstRequestId, "0af7651916cd43dd8448eb211c80319c", 10] as const,
        [secondRequestId, "1bf7651916cd43dd8448eb211c80319c", 0] as const,
      ].map(async ([requestId, traceId, delay]) =>
        runWithServerRequest(
          {
            service: "api",
            method: "GET",
            route: "/healthz",
            headers: {
              "x-request-id": requestId,
              traceparent: `00-${traceId}-b7ad6b7169203331-01`,
            },
            logger,
          },
          async (requestContext) => {
            await new Promise((resolve) => setTimeout(resolve, delay));
            expect(currentRequestContext()).toEqual(requestContext);
            return requestContext;
          },
        ),
      ),
    );

    expect(results.map(({ requestId }) => requestId)).toEqual([
      firstRequestId,
      secondRequestId,
    ]);
    expect(results.map(({ traceId }) => traceId)).toEqual([
      "0af7651916cd43dd8448eb211c80319c",
      "1bf7651916cd43dd8448eb211c80319c",
    ]);
    expect(currentRequestContext()).toBeUndefined();
  } finally {
    await telemetry.shutdown();
  }
});

test("records a fixed failure classification without serializing the error", async () => {
  const { startNodeTelemetry } = await loadNodeModule();
  const { runWithServerRequest } = await loadRequestContextModule();
  const telemetry = startNodeTelemetry({ service: "worker" });
  const lines: string[] = [];
  const logger = createStructuredLogger({
    service: "worker",
    write: (line) => lines.push(line),
  });
  const canary = "PRIVATE_ERROR_MESSAGE_81273";

  try {
    await expect(
      runWithServerRequest(
        {
          service: "worker",
          method: "POST",
          route: "/jobs/{type}",
          headers: {},
          logger,
        },
        () => {
          throw new Error(canary, { cause: { secret: canary } });
        },
      ),
    ).rejects.toThrow(canary);

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(canary);
    expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
      service: "worker",
      event: "http.request.failed",
      errorCode: "INTERNAL_ERROR",
      outcome: "failure",
    });
  } finally {
    await telemetry.shutdown();
  }
});

test("returns an explicit response outcome with one correlated failure record", async () => {
  const { startNodeTelemetry } = await loadNodeModule();
  const { runWithServerRequestOutcome } = await loadRequestContextModule();
  const telemetry = startNodeTelemetry({ service: "storefront" });
  const lines: string[] = [];
  const logger = createStructuredLogger({
    service: "storefront",
    write: (line) => lines.push(line),
  });
  const requestId = "ddf329e6-21bb-438f-b209-4a41df4fecab";
  const traceId = "5af7651916cd43dd8448eb211c80319c";

  try {
    const result = await runWithServerRequestOutcome(
      {
        service: "storefront",
        method: "GET",
        route: "/_internal/observability",
        headers: {
          "x-request-id": requestId,
          traceparent: `00-${traceId}-d7ad6b7169203331-01`,
        },
        logger,
      },
      () => ({
        errorCode: "UPSTREAM_UNAVAILABLE",
        statusCode: 503,
        value: "unavailable" as const,
      }),
    );

    expect(result).toBe("unavailable");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
      service: "storefront",
      event: "http.request.failed",
      requestId,
      traceId,
      httpStatusCode: 503,
      errorCode: "UPSTREAM_UNAVAILABLE",
      outcome: "failure",
    });
  } finally {
    await telemetry.shutdown();
  }
});

test("normalizes an invalid explicit outcome without reflecting its values", async () => {
  const { startNodeTelemetry } = await loadNodeModule();
  const { runWithServerRequestOutcome } = await loadRequestContextModule();
  const telemetry = startNodeTelemetry({ service: "api" });
  const lines: string[] = [];
  const logger = createStructuredLogger({
    service: "api",
    write: (line) => lines.push(line),
  });

  try {
    await runWithServerRequestOutcome(
      {
        service: "api",
        method: "GET",
        route: "/healthz",
        logger,
      },
      () => ({
        errorCode: "PRIVATE_MESSAGE_74812" as "INTERNAL_ERROR",
        statusCode: 799,
        value: undefined,
      }),
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("74812");
    expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
      event: "http.request.failed",
      httpStatusCode: 500,
      errorCode: "INTERNAL_ERROR",
      outcome: "failure",
    });
  } finally {
    await telemetry.shutdown();
  }
});

test("starts once per process and shuts down idempotently", async () => {
  const { startNodeTelemetry } = await loadNodeModule();
  const first = startNodeTelemetry({ service: "api" });
  const second = startNodeTelemetry({ service: "api" });
  const canary = "PRIVATE_SERVICE_NAME_73618";

  expect(second).toBe(first);
  expect(() => startNodeTelemetry({ service: `api-${canary}` })).toThrow(
    "Telemetry service name is invalid",
  );
  await first.forceFlush();
  await Promise.all([first.shutdown(), second.shutdown(), first.shutdown()]);
});
