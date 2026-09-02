import { z } from "zod";

import { isCanonicalRequestId } from "./request-id.js";

const serviceSchema = z.enum([
  "admin",
  "api",
  "storefront",
  "unknown",
  "worker",
]);
const eventSchema = z.enum([
  "http.request.completed",
  "http.request.failed",
  "next.request.failed",
  "next.runtime.failed",
  "observability.invalid_event",
  "runtime.fatal_error",
  "runtime.start_failed",
  "runtime.started",
  "runtime.stop_failed",
  "runtime.stopped",
]);
const traceIdSchema = z.string().regex(/^(?!0{32}$)[0-9a-f]{32}$/u);
const spanIdSchema = z.string().regex(/^(?!0{16}$)[0-9a-f]{16}$/u);
const methodSchema = z.enum([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "UNKNOWN",
]);
const routeSchema = z
  .string()
  .regex(/^\/[A-Za-z0-9_./:{}-]{0,127}$/u)
  .max(128);
const errorCodeSchema = z.enum([
  "FATAL_RUNTIME_ERROR",
  "INTERNAL_ERROR",
  "REQUEST_ABORTED",
  "REQUEST_TIMEOUT",
  "SHUTDOWN_FAILED",
  "STARTUP_FAILED",
  "UPSTREAM_UNAVAILABLE",
]);

export const structuredLogRecordSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    timestamp: z.iso.datetime({ offset: false }),
    level: z.enum(["info", "warn", "error"]),
    service: serviceSchema,
    event: eventSchema,
    requestId: z.string().refine(isCanonicalRequestId).optional(),
    traceId: traceIdSchema.optional(),
    spanId: spanIdSchema.optional(),
    httpMethod: methodSchema.optional(),
    httpRoute: routeSchema.optional(),
    httpStatusCode: z.number().int().min(100).max(599).optional(),
    durationMs: z.number().int().min(0).max(86_400_000).optional(),
    errorCode: errorCodeSchema.optional(),
    outcome: z.enum(["success", "failure"]).optional(),
  })
  .readonly();

export type StructuredLogRecord = Readonly<
  z.infer<typeof structuredLogRecordSchema>
>;

export type StructuredLogFields = Readonly<
  Partial<
    Pick<
      StructuredLogRecord,
      | "requestId"
      | "traceId"
      | "spanId"
      | "httpMethod"
      | "httpRoute"
      | "httpStatusCode"
      | "durationMs"
      | "errorCode"
      | "outcome"
    >
  >
>;

export type StructuredLogger = Readonly<{
  info: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
  warn: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
  error: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
}>;

export type ConsoleErrorBoundary = Readonly<{
  restore: () => void;
}>;

type ConsoleErrorTarget = {
  error: (...values: readonly unknown[]) => void;
};

const LOG_FIELD_NAMES = Object.freeze([
  "requestId",
  "traceId",
  "spanId",
  "httpMethod",
  "httpRoute",
  "httpStatusCode",
  "durationMs",
  "errorCode",
  "outcome",
] as const satisfies readonly (keyof StructuredLogFields)[]);

function readOwnLogFields(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {};
  }

  const fields: Record<string, unknown> = {};
  try {
    const prototype = Object.getPrototypeOf(input) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      return fields;
    }

    for (const name of LOG_FIELD_NAMES) {
      const descriptor = Object.getOwnPropertyDescriptor(input, name);
      if (descriptor !== undefined && "value" in descriptor) {
        fields[name] = descriptor.value;
      }
    }
  } catch {
    return {};
  }

  if (
    typeof fields["durationMs"] === "number" &&
    Number.isFinite(fields["durationMs"])
  ) {
    fields["durationMs"] = Math.round(fields["durationMs"]);
  }
  return fields;
}

function validOrUndefined<T>(
  schema: z.ZodType<T>,
  value: unknown,
): T | undefined {
  try {
    const result = schema.safeParse(value);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function normalizeFields(input: unknown): StructuredLogFields {
  const fields = readOwnLogFields(input);
  const requestId = validOrUndefined(
    z.string().refine(isCanonicalRequestId),
    fields["requestId"],
  );
  const traceId = validOrUndefined(traceIdSchema, fields["traceId"]);
  const spanId = validOrUndefined(spanIdSchema, fields["spanId"]);
  const httpMethod = validOrUndefined(methodSchema, fields["httpMethod"]);
  const httpRoute = validOrUndefined(routeSchema, fields["httpRoute"]);
  const httpStatusCode = validOrUndefined(
    z.number().int().min(100).max(599),
    fields["httpStatusCode"],
  );
  const durationMs = validOrUndefined(
    z.number().int().min(0).max(86_400_000),
    fields["durationMs"],
  );
  const errorCode = validOrUndefined(errorCodeSchema, fields["errorCode"]);
  const outcome = validOrUndefined(
    z.enum(["success", "failure"]),
    fields["outcome"],
  );

  return Object.freeze({
    ...(requestId === undefined ? {} : { requestId }),
    ...(traceId === undefined ? {} : { traceId }),
    ...(spanId === undefined ? {} : { spanId }),
    ...(httpMethod === undefined ? {} : { httpMethod }),
    ...(httpRoute === undefined ? {} : { httpRoute }),
    ...(httpStatusCode === undefined ? {} : { httpStatusCode }),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(outcome === undefined ? {} : { outcome }),
  });
}

export function createStructuredLogger(
  options: Readonly<{
    service: string;
    write?: (line: string) => void;
    now?: () => Date;
  }>,
): StructuredLogger {
  const service = validOrUndefined(serviceSchema, options.service) ?? "unknown";
  const write = options.write ?? ((line: string) => process.stdout.write(line));
  const now = options.now ?? (() => new Date());

  function log(
    level: StructuredLogRecord["level"],
    eventCandidate: string,
    fields?: Readonly<Record<string, unknown>>,
  ): void {
    const event =
      validOrUndefined(eventSchema, eventCandidate) ??
      "observability.invalid_event";
    const record = structuredLogRecordSchema.parse({
      schemaVersion: 1,
      timestamp: now().toISOString(),
      level,
      service,
      event,
      ...normalizeFields(fields),
    });
    write(`${JSON.stringify(record)}\n`);
  }

  return Object.freeze({
    info: (event, fields) => log("info", event, fields),
    warn: (event, fields) => log("warn", event, fields),
    error: (event, fields) => log("error", event, fields),
  });
}

export function installSafeConsoleErrorBoundary(
  logger: StructuredLogger,
  target: ConsoleErrorTarget = console,
): ConsoleErrorBoundary {
  const originalError = target.error;
  let active = true;
  const safeError = () => {
    try {
      logger.error("next.runtime.failed", {
        errorCode: "INTERNAL_ERROR",
        outcome: "failure",
      });
    } catch {
      // The safe boundary must not fall back to the original unsafe sink.
    }
  };
  target.error = safeError;

  return Object.freeze({
    restore() {
      if (!active) {
        return;
      }
      active = false;
      if (target.error === safeError) {
        target.error = originalError;
      }
    },
  });
}
