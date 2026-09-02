import {
  isSpanContextValid,
  ROOT_CONTEXT,
  trace,
  type TextMapGetter,
  type TextMapSetter,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";

import { createPropagationHeaders } from "./request-context.js";
import { isCanonicalRequestId, REQUEST_ID_HEADER } from "./request-id.js";

const CARRIER_KEYS = Object.freeze([
  "schemaVersion",
  "requestId",
  "traceparent",
] as const);
const CARRIER_KEY_SET = new Set<PropertyKey>(CARRIER_KEYS);
const TRACE_HEADER_KEYS = Object.freeze(["traceparent"] as const);
const CANONICAL_TRACEPARENT_PATTERN =
  /^00-(?!0{32}-)[0-9a-f]{32}-(?!0{16}-)[0-9a-f]{16}-[0-9a-f]{2}$/u;
const traceContextPropagator = new W3CTraceContextPropagator();

export type QueuePropagationCarrier = Readonly<{
  schemaVersion: 1;
  requestId: string;
  traceparent: string;
}>;

function readPlainCarrier(
  value: unknown,
): Readonly<Record<(typeof CARRIER_KEYS)[number], unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  try {
    const prototype = Object.getPrototypeOf(value) as object | null;
    const keys = Reflect.ownKeys(value);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      keys.some((key) => !CARRIER_KEY_SET.has(key))
    ) {
      return undefined;
    }

    const result: Partial<Record<(typeof CARRIER_KEYS)[number], unknown>> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== "string" ||
        descriptor === undefined ||
        !("value" in descriptor)
      ) {
        return undefined;
      }
      result[key as (typeof CARRIER_KEYS)[number]] = descriptor.value;
    }
    return result as Readonly<Record<(typeof CARRIER_KEYS)[number], unknown>>;
  } catch {
    return undefined;
  }
}

const traceHeaderGetter: TextMapGetter<Readonly<Record<string, unknown>>> =
  Object.freeze({
    keys: () => [...TRACE_HEADER_KEYS],
    get: (carrier: Readonly<Record<string, unknown>>, key: string) => {
      const value = carrier[key.toLowerCase()];
      return typeof value === "string" ? value : undefined;
    },
  });

const traceHeaderSetter: TextMapSetter<Record<string, string>> = Object.freeze({
  set: (carrier: Record<string, string>, key: string, value: string) => {
    if (
      TRACE_HEADER_KEYS.includes(
        key.toLowerCase() as (typeof TRACE_HEADER_KEYS)[number],
      )
    ) {
      carrier[key.toLowerCase()] = value;
    }
  },
});

export function createQueuePropagationCarrier():
  QueuePropagationCarrier | undefined {
  const headers = createPropagationHeaders();
  const requestId = headers[REQUEST_ID_HEADER];
  const traceparent = headers["traceparent"];
  if (
    requestId === undefined ||
    !isCanonicalRequestId(requestId) ||
    traceparent === undefined
  ) {
    return undefined;
  }

  return Object.freeze({
    schemaVersion: 1 as const,
    requestId,
    traceparent,
  });
}

export function parseQueuePropagationCarrier(
  value: unknown,
): Readonly<Record<string, string>> | undefined {
  const carrier = readPlainCarrier(value);
  if (
    carrier === undefined ||
    carrier.schemaVersion !== 1 ||
    typeof carrier.requestId !== "string" ||
    !isCanonicalRequestId(carrier.requestId) ||
    typeof carrier.traceparent !== "string" ||
    !CANONICAL_TRACEPARENT_PATTERN.test(carrier.traceparent)
  ) {
    return undefined;
  }

  const extracted = traceContextPropagator.extract(
    ROOT_CONTEXT,
    carrier,
    traceHeaderGetter,
  );
  const spanContext = trace.getSpanContext(extracted);
  if (spanContext === undefined || !isSpanContextValid(spanContext)) {
    return undefined;
  }

  const headers: Record<string, string> = {
    [REQUEST_ID_HEADER]: carrier.requestId,
  };
  traceContextPropagator.inject(extracted, headers, traceHeaderSetter);
  if (headers["traceparent"] === undefined) {
    return undefined;
  }

  return Object.freeze({ ...headers });
}
