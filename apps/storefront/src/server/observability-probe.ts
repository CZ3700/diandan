import "server-only";

import { resolveInternalApiRuntimeConfig } from "@fan-support/config/server";
import {
  createStructuredLogger,
  REQUEST_ID_HEADER,
  resolveRequestId,
  type StructuredLogger,
} from "@fan-support/observability";
import {
  createPropagationHeaders,
  runWithServerRequestOutcome,
} from "@fan-support/observability/node";

const SERVICE = "storefront" as const;
const ROUTE = "/_internal/observability" as const;
const PROPAGATION_HEADERS = Object.freeze([
  REQUEST_ID_HEADER,
  "traceparent",
  "tracestate",
] as const);

type Environment = Readonly<Record<string, string | undefined>>;

export type InternalObservabilityOptions = Readonly<{
  environment?: Environment;
  fetcher?: typeof fetch;
  logger?: StructuredLogger;
}>;

const defaultLogger = createStructuredLogger({ service: SERVICE });

function isEnabled(environment: Environment): boolean {
  const deploymentEnvironment = environment["FAN_SUPPORT_DEPLOYMENT_ENV"];

  return (
    deploymentEnvironment === "development" ||
    deploymentEnvironment === "test" ||
    deploymentEnvironment === "preview"
  );
}

function createInboundCarrier(
  request: Request,
  requestId: string,
): Readonly<Record<string, string>> {
  const carrier: Record<string, string> = {
    [REQUEST_ID_HEADER]: requestId,
  };

  for (const headerName of ["traceparent", "tracestate"] as const) {
    const value = request.headers.get(headerName);
    if (value !== null) {
      carrier[headerName] = value;
    }
  }

  return Object.freeze(carrier);
}

function createOutboundCarrier(): Readonly<Record<string, string>> {
  const propagated = createPropagationHeaders();
  const carrier: Record<string, string> = {};

  for (const headerName of PROPAGATION_HEADERS) {
    const value = propagated[headerName];
    if (typeof value === "string") {
      carrier[headerName] = value;
    }
  }

  return Object.freeze(carrier);
}

function responseHeaders(requestId: string): Readonly<Record<string, string>> {
  return Object.freeze({
    "cache-control": "no-store",
    [REQUEST_ID_HEADER]: requestId,
  });
}

function notFoundResponse(requestId: string): Response {
  return new Response(null, {
    status: 404,
    headers: responseHeaders(requestId),
  });
}

function successResponse(requestId: string): Response {
  return Response.json(
    {
      schemaVersion: 1,
      status: "ok",
      upstream: "api",
    },
    { headers: responseHeaders(requestId) },
  );
}

function unavailableResponse(requestId: string): Response {
  return Response.json(
    {
      errorCode: "UPSTREAM_UNAVAILABLE",
      schemaVersion: 1,
      status: "unavailable",
    },
    { status: 503, headers: responseHeaders(requestId) },
  );
}

export async function handleInternalObservabilityRequest(
  request: Request,
  options: InternalObservabilityOptions = {},
): Promise<Response> {
  const environment = options.environment ?? process.env;
  const requestId = resolveRequestId(
    request.headers.get(REQUEST_ID_HEADER) ?? undefined,
  );

  if (!isEnabled(environment)) {
    return notFoundResponse(requestId);
  }

  const fetcher = options.fetcher ?? fetch;
  const logger = options.logger ?? defaultLogger;
  const inboundCarrier = createInboundCarrier(request, requestId);

  return runWithServerRequestOutcome(
    {
      headers: inboundCarrier,
      logger,
      method: "GET",
      route: ROUTE,
      service: SERVICE,
    },
    async (requestContext) => {
      try {
        const config = resolveInternalApiRuntimeConfig({ environment });
        const upstreamResponse = await fetcher(`${config.origin}/healthz`, {
          cache: "no-store",
          headers: createOutboundCarrier(),
          method: "GET",
          redirect: "error",
          signal: request.signal,
        });
        await upstreamResponse.body?.cancel();

        if (!upstreamResponse.ok) {
          return {
            errorCode: "UPSTREAM_UNAVAILABLE" as const,
            statusCode: 503,
            value: unavailableResponse(requestContext.requestId),
          };
        }

        return {
          statusCode: 200,
          value: successResponse(requestContext.requestId),
        };
      } catch {
        return {
          errorCode: "UPSTREAM_UNAVAILABLE" as const,
          statusCode: 503,
          value: unavailableResponse(requestContext.requestId),
        };
      }
    },
  );
}
