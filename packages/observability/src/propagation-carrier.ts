import {
  isSpanContextValid,
  ROOT_CONTEXT,
  trace,
  type TextMapGetter,
  type TextMapSetter,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  queuePropagationCarrierSchema,
  type QueuePropagationCarrier,
} from "@fan-support/contracts";

import { createPropagationHeaders } from "./request-context.js";
import { isCanonicalRequestId, REQUEST_ID_HEADER } from "./request-id.js";

const CARRIER_KEYS = Object.freeze([
  "schemaVersion",
  "requestId",
  "traceparent",
] as const);
const CARRIER_KEY_SET = new Set<PropertyKey>(CARRIER_KEYS);
const TRACE_HEADER_KEYS = Object.freeze(["traceparent"] as const);
const traceContextPropagator = new W3CTraceContextPropagator();

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

  return Object.freeze(
    queuePropagationCarrierSchema.parse({
      schemaVersion: 1,
      requestId,
      traceparent,
    }),
  );
}

export function parseQueuePropagationCarrier(
  value: unknown,
): Readonly<Record<string, string>> | undefined {
  const carrier = readPlainCarrier(value);
  const parsedCarrier = queuePropagationCarrierSchema.safeParse(carrier);
  if (!parsedCarrier.success) {
    return undefined;
  }

  const extracted = traceContextPropagator.extract(
    ROOT_CONTEXT,
    parsedCarrier.data,
    traceHeaderGetter,
  );
  const spanContext = trace.getSpanContext(extracted);
  if (spanContext === undefined || !isSpanContextValid(spanContext)) {
    return undefined;
  }

  const headers: Record<string, string> = {
    [REQUEST_ID_HEADER]: parsedCarrier.data.requestId,
  };
  traceContextPropagator.inject(extracted, headers, traceHeaderSetter);
  if (headers["traceparent"] === undefined) {
    return undefined;
  }

  return Object.freeze({ ...headers });
}
