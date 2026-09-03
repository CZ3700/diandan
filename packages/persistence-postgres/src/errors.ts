export type PersistenceFailureClassification = Readonly<{
  code:
    | "ALREADY_EXISTS"
    | "INTEGRITY_VIOLATION"
    | "CONFIGURATION_ERROR"
    | "TRANSACTION_ABORTED"
    | "TEMPORARY_UNAVAILABLE"
    | "UNEXPECTED_ADAPTER_FAILURE";
  recovery: "NONE" | "RETRY_SAME_COMMAND";
  retryAfterMs?: number;
}>;

const retryAfterMs = 250;

function readOwnDataProperty(
  value: object,
  property: "cause" | "code",
): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, property);
    return descriptor !== undefined && "value" in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function readSqlState(
  error: unknown,
  seen: Set<object> = new Set(),
): string | undefined {
  if (typeof error !== "object" || error === null || seen.has(error)) {
    return undefined;
  }
  seen.add(error);
  const code = readOwnDataProperty(error, "code");
  if (typeof code === "string" && /^[0-9A-Z]{5}$/u.test(code)) {
    return code;
  }
  return readSqlState(readOwnDataProperty(error, "cause"), seen);
}

export function classifyPostgresFailure(
  error: unknown,
): PersistenceFailureClassification {
  const sqlState = readSqlState(error);
  if (sqlState === "40001" || sqlState === "40P01") {
    return {
      code: "TRANSACTION_ABORTED",
      recovery: "RETRY_SAME_COMMAND",
      retryAfterMs,
    };
  }
  if (
    sqlState?.startsWith("08") === true ||
    sqlState === "55P03" ||
    sqlState === "57P01" ||
    sqlState === "57P02" ||
    sqlState === "57P03"
  ) {
    return {
      code: "TEMPORARY_UNAVAILABLE",
      recovery: "RETRY_SAME_COMMAND",
      retryAfterMs,
    };
  }
  if (sqlState === "23505") {
    return { code: "ALREADY_EXISTS", recovery: "NONE" };
  }
  if (
    sqlState?.startsWith("28") === true ||
    sqlState?.startsWith("3D") === true ||
    sqlState?.startsWith("42") === true ||
    sqlState?.startsWith("0A") === true
  ) {
    return { code: "CONFIGURATION_ERROR", recovery: "NONE" };
  }
  if (
    sqlState?.startsWith("22") === true ||
    sqlState?.startsWith("23") === true ||
    sqlState === "55000"
  ) {
    return { code: "INTEGRITY_VIOLATION", recovery: "NONE" };
  }
  return {
    code: "UNEXPECTED_ADAPTER_FAILURE",
    recovery: "RETRY_SAME_COMMAND",
    retryAfterMs,
  };
}
