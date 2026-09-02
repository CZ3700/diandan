import { expect, test } from "vitest";

type LogFields = Readonly<Record<string, unknown>>;

type StructuredLogger = Readonly<{
  info: (event: string, fields?: LogFields) => void;
  error: (event: string, fields?: LogFields) => void;
}>;

type LoggingModule = Readonly<{
  createStructuredLogger: (
    options: Readonly<{
      now: () => Date;
      service: string;
      write: (line: string) => void;
    }>,
  ) => StructuredLogger;
  installSafeConsoleErrorBoundary: (
    logger: StructuredLogger,
    target: Readonly<{ error: (...values: readonly unknown[]) => void }>,
  ) => Readonly<{ restore: () => void }>;
  structuredLogRecordSchema: Readonly<{
    parse: (input: unknown) => unknown;
  }>;
}>;

async function loadLoggingModule(): Promise<LoggingModule> {
  let loaded: unknown;

  try {
    loaded = await import("./logging.js");
  } catch {
    loaded = undefined;
  }

  expect(loaded, "structured logging module must exist").toBeDefined();
  return loaded as LoggingModule;
}

test("writes a versioned JSON line containing only validated fields", async () => {
  const { createStructuredLogger, structuredLogRecordSchema } =
    await loadLoggingModule();
  const lines: string[] = [];
  const logger = createStructuredLogger({
    service: "api",
    now: () => new Date("2026-09-02T20:00:00.000Z"),
    write: (line) => lines.push(line),
  });

  logger.info("http.request.completed", {
    requestId: "018f47a4-7b7c-4f27-8b35-25c984619a11",
    traceId: "0af7651916cd43dd8448eb211c80319c",
    spanId: "b7ad6b7169203331",
    httpMethod: "GET",
    httpRoute: "/healthz",
    httpStatusCode: 200,
    durationMs: 12.75,
    outcome: "success",
    authorization: "must-not-be-logged",
    fanMessage: "must-not-be-logged",
  });

  expect(lines).toHaveLength(1);
  expect(lines[0]?.endsWith("\n")).toBe(true);
  const record = JSON.parse(lines[0] ?? "null") as unknown;
  expect(() => structuredLogRecordSchema.parse(record)).not.toThrow();
  expect(record).toEqual({
    schemaVersion: 1,
    timestamp: "2026-09-02T20:00:00.000Z",
    level: "info",
    service: "api",
    event: "http.request.completed",
    requestId: "018f47a4-7b7c-4f27-8b35-25c984619a11",
    traceId: "0af7651916cd43dd8448eb211c80319c",
    spanId: "b7ad6b7169203331",
    httpMethod: "GET",
    httpRoute: "/healthz",
    httpStatusCode: 200,
    durationMs: 13,
    outcome: "success",
  });
  expect(lines[0]).not.toContain("must-not-be-logged");
});

test("does not inspect or serialize hostile and nested values", async () => {
  const { createStructuredLogger } = await loadLoggingModule();
  const canary = "PRIVATE_MESSAGE_CANARY_94271";
  const lines: string[] = [];
  let getterCalls = 0;
  const hostileFields = Object.defineProperties(
    {
      nested: { error: new Error(canary), value: 1n },
    },
    {
      httpRoute: {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error(canary);
        },
      },
      cause: {
        enumerable: true,
        value: { self: undefined as unknown },
      },
    },
  ) as Record<string, unknown>;
  (hostileFields["cause"] as { self: unknown }).self = hostileFields;
  const logger = createStructuredLogger({
    service: "worker",
    now: () => new Date("2026-09-02T20:00:00.000Z"),
    write: (line) => lines.push(line),
  });

  logger.error("http.request.failed", hostileFields);

  expect(getterCalls).toBe(0);
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain(canary);
  expect(JSON.parse(lines[0] ?? "null")).toEqual({
    schemaVersion: 1,
    timestamp: "2026-09-02T20:00:00.000Z",
    level: "error",
    service: "worker",
    event: "http.request.failed",
  });
});

test("replaces framework console errors with a fixed safe record", async () => {
  const { createStructuredLogger, installSafeConsoleErrorBoundary } =
    await loadLoggingModule();
  const canary = "PRIVATE_NEXT_CONSOLE_ERROR_58136";
  let trapCalls = 0;
  const hostileError = new Proxy(new Error(canary), {
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
  const lines: string[] = [];
  const logger = createStructuredLogger({
    service: "storefront",
    now: () => new Date("2026-09-02T20:00:00.000Z"),
    write: (line) => lines.push(line),
  });
  const originalError = () => {
    throw new Error("unsafe console error was restored");
  };
  const target: { error: (...values: readonly unknown[]) => void } = {
    error: originalError,
  };
  const boundary = installSafeConsoleErrorBoundary(logger, target);

  target.error("unhandledRejection:", hostileError);

  expect(trapCalls).toBe(0);
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain(canary);
  expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
    event: "next.runtime.failed",
    level: "error",
    errorCode: "INTERNAL_ERROR",
    outcome: "failure",
  });

  boundary.restore();
  expect(target.error).toBe(originalError);
  boundary.restore();
});

test("normalizes unsafe identifiers and field values without reflecting them", async () => {
  const { createStructuredLogger } = await loadLoggingModule();
  const canary = "person@example.invalid?token=PRIVATE_41029";
  const lines: string[] = [];
  const logger = createStructuredLogger({
    service: `api-${canary}`,
    now: () => new Date("2026-09-02T20:00:00.000Z"),
    write: (line) => lines.push(line),
  });

  logger.error(`failure-${canary}`, {
    requestId: canary,
    traceId: canary,
    spanId: canary,
    httpMethod: `GET-${canary}`,
    httpRoute: `/orders/${canary}`,
    httpStatusCode: 999,
    durationMs: -1,
    errorCode: canary,
    outcome: canary,
  });

  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain(canary);
  expect(JSON.parse(lines[0] ?? "null")).toEqual({
    schemaVersion: 1,
    timestamp: "2026-09-02T20:00:00.000Z",
    level: "error",
    service: "unknown",
    event: "observability.invalid_event",
  });
});

test("rejects private values even when they look like valid identifiers", async () => {
  const { createStructuredLogger } = await loadLoggingModule();
  const lines: string[] = [];
  const logger = createStructuredLogger({
    service: "private-service-59281",
    now: () => new Date("2026-09-02T20:00:00.000Z"),
    write: (line) => lines.push(line),
  });

  logger.error("private.message.59281", {
    errorCode: "PRIVATE_MESSAGE_59281",
    httpMethod: "PRIVATE",
  });

  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain("59281");
  expect(JSON.parse(lines[0] ?? "null")).toEqual({
    schemaVersion: 1,
    timestamp: "2026-09-02T20:00:00.000Z",
    level: "error",
    service: "unknown",
    event: "observability.invalid_event",
  });
});
