import { afterAll, beforeAll, expect, test, vi } from "vitest";

import {
  createStructuredLogger,
  isCanonicalRequestId,
  type StructuredLogger,
} from "@fan-support/observability";
import { startNodeTelemetry } from "@fan-support/observability/node";

vi.mock("server-only", () => ({}));

type Environment = Readonly<Record<string, string | undefined>>;
type InternalObservabilityOptions = Readonly<{
  environment?: Environment;
  fetcher?: typeof fetch;
  logger?: StructuredLogger;
}>;
type InternalObservabilityModule = Readonly<{
  handleInternalObservabilityRequest: (
    request: Request,
    options?: InternalObservabilityOptions,
  ) => Promise<Response>;
}>;

const LOCAL_REQUEST_ID = "018f47a4-7b7c-4f27-8b35-25c984619a11";
const API_REQUEST_ID = "018f47a4-7b7c-4f27-8b35-25c984619a12";
const TRACE_ID = "11111111111111111111111111111111";
const PARENT_SPAN_ID = "2222222222222222";

async function loadInternalObservabilityModule(): Promise<InternalObservabilityModule> {
  let loaded: unknown;
  try {
    loaded = await import("./observability-probe.js");
  } catch {
    loaded = undefined;
  }

  expect(
    loaded,
    "storefront internal observability helper must exist",
  ).toBeDefined();
  return loaded as InternalObservabilityModule;
}

function runtimeEnvironment(
  deploymentEnvironment: "development" | "test" | "preview",
): Environment {
  return Object.freeze({
    FAN_SUPPORT_DEPLOYMENT_ENV: deploymentEnvironment,
    FAN_SUPPORT_INTERNAL_API_ORIGIN: "https://api.preview.example.invalid",
  });
}

function createTestLogger(): Readonly<{
  logger: StructuredLogger;
  lines: string[];
}> {
  const lines: string[] = [];
  return {
    logger: createStructuredLogger({
      service: "storefront",
      write: (line) => lines.push(line),
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    }),
    lines,
  };
}

let telemetryShutdown: (() => Promise<void>) | undefined;

beforeAll(() => {
  telemetryShutdown = startNodeTelemetry({ service: "storefront" }).shutdown;
});

afterAll(async () => {
  await telemetryShutdown?.();
});

test.each(["development", "test", "preview"] as const)(
  "enables the internal probe in %s only",
  async (deploymentEnvironment) => {
    const { handleInternalObservabilityRequest } =
      await loadInternalObservabilityModule();
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const { logger } = createTestLogger();

    const response = await handleInternalObservabilityRequest(
      new Request("https://storefront.example.invalid/_internal/observability"),
      {
        environment: runtimeEnvironment(deploymentEnvironment),
        fetcher,
        logger,
      },
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
  },
);

test.each(["staging", "production"] as const)(
  "returns 404 in %s without reading internal API config or fetching",
  async (deploymentEnvironment) => {
    const { handleInternalObservabilityRequest } =
      await loadInternalObservabilityModule();
    const target = Object.freeze({
      FAN_SUPPORT_DEPLOYMENT_ENV: deploymentEnvironment,
    });
    const environment = new Proxy(target, {
      ownKeys() {
        throw new Error("internal API configuration must stay unread");
      },
    }) as Environment;
    const fetcher = vi.fn(async () => {
      throw new Error("fetch must stay unused");
    });
    const logger: StructuredLogger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };

    const response = await handleInternalObservabilityRequest(
      new Request("https://storefront.example.invalid/_internal/observability"),
      { environment, fetcher, logger },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(isCanonicalRequestId(response.headers.get("x-request-id"))).toBe(
      true,
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  },
);

test("propagates only W3C trace context and the local request ID", async () => {
  const { handleInternalObservabilityRequest } =
    await loadInternalObservabilityModule();
  const downstreamBody = "PRIVATE_API_BODY_72391";
  const downstreamResponse = new Response(downstreamBody, {
    status: 200,
    headers: { "x-request-id": API_REQUEST_ID },
  });
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      void input;
      void init;
      return downstreamResponse;
    },
  );
  const { logger } = createTestLogger();
  const request = new Request(
    "https://storefront.example.invalid/_internal/observability",
    {
      headers: {
        authorization: "Bearer PRIVATE_TOKEN_82391",
        cookie: "support_intent=PRIVATE_MESSAGE_29381",
        traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`,
        tracestate: "vendor=value",
        "x-request-id": LOCAL_REQUEST_ID,
        "x-private-context": "PRIVATE_CONTEXT_19382",
      },
    },
  );

  const response = await handleInternalObservabilityRequest(request, {
    environment: runtimeEnvironment("preview"),
    fetcher,
    logger,
  });

  expect(fetcher).toHaveBeenCalledOnce();
  const [url, init] = fetcher.mock.calls[0] ?? [];
  expect(url).toBe("https://api.preview.example.invalid/healthz");
  const propagatedHeaders = new Headers(init?.headers);
  expect([...propagatedHeaders.keys()].sort()).toEqual([
    "traceparent",
    "tracestate",
    "x-request-id",
  ]);
  expect(propagatedHeaders.get("x-request-id")).toBe(LOCAL_REQUEST_ID);
  expect(propagatedHeaders.get("traceparent")).toMatch(
    new RegExp(`^00-${TRACE_ID}-[0-9a-f]{16}-01$`, "u"),
  );
  expect(propagatedHeaders.get("tracestate")).toBe("vendor=value");
  expect(response.status).toBe(200);
  expect(response.headers.get("x-request-id")).toBe(LOCAL_REQUEST_ID);
  expect(response.headers.get("x-request-id")).not.toBe(API_REQUEST_ID);
  await expect(response.json()).resolves.toEqual({
    schemaVersion: 1,
    status: "ok",
    upstream: "api",
  });
  expect(downstreamResponse.bodyUsed).toBe(true);
});

test("does not expose a downstream body or request ID on an upstream failure", async () => {
  const { handleInternalObservabilityRequest } =
    await loadInternalObservabilityModule();
  const downstreamBody = "PRIVATE_API_BODY_98412";
  const downstreamResponse = new Response(downstreamBody, {
    status: 503,
    headers: { "x-request-id": API_REQUEST_ID },
  });
  const fetcher = vi.fn(async () => downstreamResponse);
  const { logger, lines } = createTestLogger();

  const response = await handleInternalObservabilityRequest(
    new Request("https://storefront.example.invalid/_internal/observability", {
      headers: { "x-request-id": LOCAL_REQUEST_ID },
    }),
    {
      environment: runtimeEnvironment("preview"),
      fetcher,
      logger,
    },
  );

  const responseText = await response.text();
  expect(response.status).toBe(503);
  expect(response.headers.get("x-request-id")).toBe(LOCAL_REQUEST_ID);
  expect(response.headers.get("x-request-id")).not.toBe(API_REQUEST_ID);
  expect(responseText).not.toContain(downstreamBody);
  expect(lines.join("\n")).not.toContain(downstreamBody);
  expect(lines.join("\n")).not.toContain(API_REQUEST_ID);
  expect(downstreamResponse.bodyUsed).toBe(true);
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
    errorCode: "UPSTREAM_UNAVAILABLE",
    event: "http.request.failed",
    httpStatusCode: 503,
    outcome: "failure",
    requestId: LOCAL_REQUEST_ID,
    traceId: expect.stringMatching(/^[0-9a-f]{32}$/u),
  });
});

test("handles hostile fetch errors without inspecting or logging them", async () => {
  const { handleInternalObservabilityRequest } =
    await loadInternalObservabilityModule();
  const canary = "PRIVATE_FETCH_ERROR_47291";
  let trapCalls = 0;
  const hostileError = new Proxy(new Error(), {
    get() {
      trapCalls += 1;
      throw new Error(canary);
    },
    getOwnPropertyDescriptor() {
      trapCalls += 1;
      throw new Error(canary);
    },
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error(canary);
    },
    ownKeys() {
      trapCalls += 1;
      throw new Error(canary);
    },
  });
  const fetcher = vi.fn(async () => Promise.reject(hostileError));
  const { logger, lines } = createTestLogger();

  const response = await handleInternalObservabilityRequest(
    new Request("https://storefront.example.invalid/_internal/observability", {
      headers: {
        cookie: "support_intent=PRIVATE_MESSAGE_37192",
        "x-request-id": LOCAL_REQUEST_ID,
      },
    }),
    {
      environment: runtimeEnvironment("preview"),
      fetcher,
      logger,
    },
  );

  const responseText = await response.text();
  expect(response.status).toBe(503);
  expect(response.headers.get("x-request-id")).toBe(LOCAL_REQUEST_ID);
  expect(trapCalls).toBe(0);
  expect(responseText).not.toContain(canary);
  expect(responseText).not.toContain("PRIVATE_MESSAGE_37192");
  expect(lines.join("\n")).not.toContain(canary);
  expect(lines.join("\n")).not.toContain("PRIVATE_MESSAGE_37192");
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
    errorCode: "UPSTREAM_UNAVAILABLE",
    event: "http.request.failed",
    httpStatusCode: 503,
    outcome: "failure",
    requestId: LOCAL_REQUEST_ID,
    traceId: expect.stringMatching(/^[0-9a-f]{32}$/u),
  });
});
