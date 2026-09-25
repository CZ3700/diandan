import { expect, test } from "vitest";

import { createStructuredLogger } from "./logging.js";

type QueuePropagationCarrier = Readonly<{
  schemaVersion: 1;
  requestId: string;
  traceparent: string;
}>;

type PropagationCarrierModule = Readonly<{
  createQueuePropagationCarrier: () => QueuePropagationCarrier | undefined;
  parseQueuePropagationCarrier: (
    value: unknown,
  ) => Readonly<Record<string, string>> | undefined;
}>;

type RequestContextModule = Readonly<{
  runWithServerRequest: <T>(
    input: Readonly<{
      headers?: unknown;
      logger: ReturnType<typeof createStructuredLogger>;
      method: string;
      route: string;
      service: string;
    }>,
    handler: (
      requestContext: Readonly<{
        schemaVersion: 1;
        requestId: string;
        traceId: string;
        spanId: string;
      }>,
    ) => Promise<T> | T,
  ) => Promise<T>;
}>;

async function loadModules(): Promise<
  Readonly<{
    carrier: PropagationCarrierModule;
    node: Readonly<{
      startNodeTelemetry: (options: Readonly<{ service: string }>) => Readonly<{
        shutdown: () => Promise<void>;
      }>;
    }>;
    request: RequestContextModule;
  }>
> {
  const [carrier, node, request] = await Promise.all([
    import("./propagation-carrier.js").catch(() => undefined),
    import("./node.js").catch(() => undefined),
    import("./request-context.js").catch(() => undefined),
  ]);

  expect(carrier, "propagation carrier module must exist").toBeDefined();
  expect(node, "Node telemetry module must exist").toBeDefined();
  expect(request, "request context module must exist").toBeDefined();
  return {
    carrier: carrier as PropagationCarrierModule,
    node: node as Readonly<{
      startNodeTelemetry: (options: Readonly<{ service: string }>) => Readonly<{
        shutdown: () => Promise<void>;
      }>;
    }>,
    request: request as RequestContextModule,
  };
}

test("round-trips an exact serializable queue carrier without baggage", async () => {
  const { carrier, node, request } = await loadModules();
  const telemetry = node.startNodeTelemetry({ service: "api" });
  const logger = createStructuredLogger({ service: "worker", write: () => {} });
  const requestId = "b7ef69f9-f4be-46cb-b1e2-ab906e357810";

  try {
    await request.runWithServerRequest(
      {
        service: "api",
        method: "POST",
        route: "/jobs/{type}",
        headers: {
          "x-request-id": requestId,
          traceparent:
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
          tracestate: "vendor=alice@example.invalid/private-token",
          baggage: "private_message=must-not-propagate",
        },
        logger,
      },
      async (producerContext) => {
        const created = carrier.createQueuePropagationCarrier();

        expect(created).toEqual({
          schemaVersion: 1,
          requestId,
          traceparent: `00-${producerContext.traceId}-${producerContext.spanId}-01`,
        });
        expect(Object.isFrozen(created)).toBe(true);
        expect(Object.keys(created ?? {}).sort()).toEqual([
          "requestId",
          "schemaVersion",
          "traceparent",
        ]);
        expect(JSON.stringify(created)).not.toContain("must-not-propagate");
        expect(JSON.stringify(created)).not.toContain("example.invalid");

        const parsed = carrier.parseQueuePropagationCarrier(
          JSON.parse(JSON.stringify(created)) as unknown,
        );
        expect(Object.isFrozen(parsed)).toBe(true);

        await request.runWithServerRequest(
          {
            service: "worker",
            method: "POST",
            route: "/jobs/{type}",
            headers: parsed,
            logger,
          },
          (consumerContext) => {
            expect(consumerContext.requestId).toBe(requestId);
            expect(consumerContext.traceId).toBe(producerContext.traceId);
            expect(consumerContext.spanId).not.toBe(producerContext.spanId);
          },
        );
      },
    );
  } finally {
    await telemetry.shutdown();
  }
});

test("rejects hostile, unknown-version, extra-field, and malformed carriers", async () => {
  const { carrier } = await loadModules();
  const canary = "PRIVATE_QUEUE_VALUE_41297";
  let getterInvoked = false;
  const accessor = Object.defineProperty({}, "schemaVersion", {
    enumerable: true,
    get() {
      getterInvoked = true;
      throw new Error(canary);
    },
  });

  for (const value of [
    undefined,
    null,
    [],
    accessor,
    { schemaVersion: 2 },
    {
      schemaVersion: 1,
      requestId: "not-a-uuid",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    },
    {
      schemaVersion: 1,
      requestId: "b7ef69f9-f4be-46cb-b1e2-ab906e357810",
      traceparent: "invalid",
    },
    {
      schemaVersion: 1,
      requestId: "b7ef69f9-f4be-46cb-b1e2-ab906e357810",
      traceparent:
        "01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-PRIVATE_QUEUE_SUFFIX_79213",
    },
    {
      schemaVersion: 1,
      requestId: "b7ef69f9-f4be-46cb-b1e2-ab906e357810",
      traceparent: `01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-${"a".repeat(500)}`,
    },
    {
      schemaVersion: 1,
      requestId: "b7ef69f9-f4be-46cb-b1e2-ab906e357810",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=alice@example.invalid/private-token",
    },
    {
      schemaVersion: 1,
      requestId: "b7ef69f9-f4be-46cb-b1e2-ab906e357810",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      rawPayload: canary,
    },
  ]) {
    expect(carrier.parseQueuePropagationCarrier(value)).toBeUndefined();
  }

  expect(getterInvoked).toBe(false);
  expect(carrier.createQueuePropagationCarrier()).toBeUndefined();
});
