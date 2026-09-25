import { performance } from "node:perf_hooks";

import {
  context,
  createContextKey,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
  type TextMapGetter,
  type TextMapSetter,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  ATTR_ERROR_TYPE,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
} from "@opentelemetry/semantic-conventions";

import type { StructuredLogger } from "./logging.js";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id.js";

const requestContextKey = createContextKey(
  "@fan-support/observability/request-context/v1",
);
const traceContextPropagator = new W3CTraceContextPropagator();
const PROPAGATION_HEADER_NAMES = Object.freeze([
  "traceparent",
  "tracestate",
] as const);
const HTTP_METHODS = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);
const SERVICES = new Set(["admin", "api", "storefront", "worker"]);
export type ServerRequestErrorCode =
  | "INTERNAL_ERROR"
  | "REQUEST_ABORTED"
  | "REQUEST_TIMEOUT"
  | "UPSTREAM_UNAVAILABLE";

const ERROR_CODES = new Set<ServerRequestErrorCode>([
  "INTERNAL_ERROR",
  "REQUEST_ABORTED",
  "REQUEST_TIMEOUT",
  "UPSTREAM_UNAVAILABLE",
]);

export type RequestContext = Readonly<{
  schemaVersion: 1;
  requestId: string;
  traceId: string;
  spanId: string;
}>;

export type ServerRequestInput = Readonly<{
  service: string;
  method: string;
  route: string;
  headers?: unknown;
  logger: StructuredLogger;
}>;

export type ActiveServerRequest = {
  context: Context;
  logger: StructuredLogger;
  method: string;
  requestContext: RequestContext;
  route: string;
  span: Span;
  startedAt: number;
};

export type ServerRequestOutcome<T> = Readonly<{
  errorCode?: ServerRequestErrorCode;
  statusCode: number;
  value: T;
}>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  try {
    const prototype = Object.getPrototypeOf(value) as object | null;
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function readOwnHeader(
  carrier: unknown,
  name: string,
): string | string[] | undefined {
  if (!isPlainRecord(carrier)) {
    return undefined;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(carrier, name);
    if (descriptor === undefined || !("value" in descriptor)) {
      return undefined;
    }

    const value: unknown = descriptor.value;
    if (typeof value === "string") {
      return value;
    }
    if (
      Array.isArray(value) &&
      value.every((entry): entry is string => typeof entry === "string")
    ) {
      return [...value];
    }
  } catch {
    return undefined;
  }

  return undefined;
}

const headerGetter: TextMapGetter<unknown> = Object.freeze({
  keys: () => [...PROPAGATION_HEADER_NAMES],
  get: (carrier: unknown, key: string) =>
    readOwnHeader(carrier, key.toLowerCase()),
});

const headerSetter: TextMapSetter<Record<string, string>> = Object.freeze({
  set: (carrier: Record<string, string>, key: string, value: string) => {
    if (
      PROPAGATION_HEADER_NAMES.includes(
        key.toLowerCase() as (typeof PROPAGATION_HEADER_NAMES)[number],
      )
    ) {
      carrier[key.toLowerCase()] = value;
    }
  },
});

function normalizeMethod(value: string): string {
  return HTTP_METHODS.has(value) ? value : "UNKNOWN";
}

function normalizeRoute(value: string): string {
  return /^\/[A-Za-z0-9_./:{}-]{0,127}$/u.test(value) ? value : "/unmatched";
}

function normalizeService(value: string): string {
  return SERVICES.has(value) ? value : "unknown";
}

function normalizeServerRequestResult(
  result: Readonly<{
    errorCode?: ServerRequestErrorCode;
    statusCode: number;
  }>,
): Readonly<{
  errorCode?: ServerRequestErrorCode;
  statusCode: number;
}> {
  const validStatusCode =
    Number.isInteger(result.statusCode) &&
    result.statusCode >= 100 &&
    result.statusCode <= 599;
  const validErrorCode =
    result.errorCode === undefined || ERROR_CODES.has(result.errorCode);
  const validFailurePair =
    result.errorCode === undefined ||
    (result.errorCode === "REQUEST_ABORTED" && result.statusCode === 499) ||
    (result.errorCode === "REQUEST_TIMEOUT" && result.statusCode === 408) ||
    ((result.errorCode === "INTERNAL_ERROR" ||
      result.errorCode === "UPSTREAM_UNAVAILABLE") &&
      result.statusCode >= 500);

  if (!validStatusCode || !validErrorCode || !validFailurePair) {
    return { errorCode: "INTERNAL_ERROR", statusCode: 500 };
  }
  if (result.errorCode !== undefined) {
    return result;
  }
  if (result.statusCode >= 500) {
    return { errorCode: "INTERNAL_ERROR", statusCode: result.statusCode };
  }
  return { statusCode: result.statusCode };
}

export function beginServerRequest(
  input: ServerRequestInput,
): ActiveServerRequest {
  const method = normalizeMethod(input.method);
  const route = normalizeRoute(input.route);
  const service = normalizeService(input.service);
  const requestId = resolveRequestId(
    readOwnHeader(input.headers, REQUEST_ID_HEADER),
  );
  const extractedContext = traceContextPropagator.extract(
    ROOT_CONTEXT,
    input.headers ?? {},
    headerGetter,
  );
  const span = trace.getTracer("@fan-support/observability").startSpan(
    `${method} ${route}`,
    {
      kind: SpanKind.SERVER,
      attributes: {
        [ATTR_HTTP_REQUEST_METHOD]: method,
        [ATTR_HTTP_ROUTE]: route,
        "fan_support.service": service,
      },
    },
    extractedContext,
  );
  const spanContext = span.spanContext();
  const requestContext = Object.freeze({
    schemaVersion: 1 as const,
    requestId,
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  });
  const activeContext = trace
    .setSpan(extractedContext, span)
    .setValue(requestContextKey, requestContext);

  return {
    context: activeContext,
    logger: input.logger,
    method,
    requestContext,
    route,
    span,
    startedAt: performance.now(),
  };
}

export function setServerRequestRoute(
  activeRequest: ActiveServerRequest,
  routeCandidate: string,
): void {
  const route = normalizeRoute(routeCandidate);
  activeRequest.route = route;
  activeRequest.span.updateName(`${activeRequest.method} ${route}`);
  activeRequest.span.setAttribute(ATTR_HTTP_ROUTE, route);
}

export function finishServerRequest(
  activeRequest: ActiveServerRequest,
  result: Readonly<{
    errorCode?: ServerRequestErrorCode;
    statusCode: number;
  }>,
): void {
  const normalizedResult = normalizeServerRequestResult(result);
  const { errorCode, statusCode } = normalizedResult;
  const failed = statusCode >= 500 || errorCode !== undefined;
  const durationMs = Math.max(0, performance.now() - activeRequest.startedAt);
  activeRequest.span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, statusCode);
  if (failed) {
    activeRequest.span.setStatus({ code: SpanStatusCode.ERROR });
    activeRequest.span.setAttribute(
      ATTR_ERROR_TYPE,
      errorCode ?? "INTERNAL_ERROR",
    );
  } else {
    activeRequest.span.setStatus({ code: SpanStatusCode.OK });
  }
  activeRequest.span.end();

  const fields = {
    ...activeRequest.requestContext,
    httpMethod: activeRequest.method,
    httpRoute: activeRequest.route,
    httpStatusCode: statusCode,
    durationMs,
    outcome: failed ? "failure" : "success",
    ...(errorCode === undefined ? {} : { errorCode }),
  } as const;
  if (failed) {
    activeRequest.logger.error("http.request.failed", fields);
  } else {
    activeRequest.logger.info("http.request.completed", fields);
  }
}

export function currentRequestContext(): RequestContext | undefined {
  const value = context.active().getValue(requestContextKey);
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1
  ) {
    return undefined;
  }
  return value as RequestContext;
}

export function createPropagationHeaders(): Readonly<Record<string, string>> {
  const carrier: Record<string, string> = {};
  traceContextPropagator.inject(context.active(), carrier, headerSetter);
  const requestContext = currentRequestContext();
  if (requestContext !== undefined) {
    carrier[REQUEST_ID_HEADER] = requestContext.requestId;
  }
  return Object.freeze({ ...carrier });
}

export async function runWithServerRequest<T>(
  input: ServerRequestInput,
  handler: (requestContext: RequestContext) => Promise<T> | T,
): Promise<T> {
  return runWithServerRequestOutcome(input, async (requestContext) => ({
    statusCode: 200,
    value: await handler(requestContext),
  }));
}

export async function runWithServerRequestOutcome<T>(
  input: ServerRequestInput,
  handler: (
    requestContext: RequestContext,
  ) => Promise<ServerRequestOutcome<T>> | ServerRequestOutcome<T>,
): Promise<T> {
  const activeRequest = beginServerRequest(input);

  return context.with(activeRequest.context, async () => {
    try {
      const outcome = await handler(activeRequest.requestContext);
      finishServerRequest(activeRequest, {
        statusCode: outcome.statusCode,
        ...(outcome.errorCode === undefined
          ? {}
          : { errorCode: outcome.errorCode }),
      });
      return outcome.value;
    } catch (error) {
      finishServerRequest(activeRequest, {
        statusCode: 500,
        errorCode: "INTERNAL_ERROR",
      });
      throw error;
    }
  });
}
