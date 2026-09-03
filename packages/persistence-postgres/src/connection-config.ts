export type PostgresTlsConfig = Readonly<{
  rejectUnauthorized?: boolean;
  ca?: string;
  cert?: string;
  key?: string;
  servername?: string;
}>;

export type PostgresConnectionConfig = Readonly<{
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  application_name?: string;
  connectionTimeoutMillis?: number;
  statement_timeout?: number;
  query_timeout?: number;
  ssl?: boolean | PostgresTlsConfig;
}>;

export type NormalizedPostgresConnectionConfig = Readonly<{
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  application_name: string;
  connectionTimeoutMillis: number;
  statement_timeout?: number;
  query_timeout?: number;
  ssl: boolean | PostgresTlsConfig;
  sslnegotiation: "postgres";
  options: "-c search_path=pg_catalog,public";
  client_encoding: "UTF8";
  replication: "false";
}>;

const DEFAULT_APPLICATION_NAME = "fan-support-platform";
const SAFE_SESSION_OPTIONS = "-c search_path=pg_catalog,public";
const connectionConfigKeys = new Set([
  "connectionString",
  "host",
  "port",
  "database",
  "user",
  "password",
  "application_name",
  "connectionTimeoutMillis",
  "statement_timeout",
  "query_timeout",
  "ssl",
]);
const tlsConfigKeys = new Set([
  "rejectUnauthorized",
  "ca",
  "cert",
  "key",
  "servername",
]);

function copyOwnDataRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  try {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined;
    }

    const output: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || !allowedKeys.has(key)) {
        return undefined;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        return undefined;
      }
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    return undefined;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  );
}

function normalizeTlsConfig(
  value: unknown,
): boolean | PostgresTlsConfig | undefined {
  if (value === undefined) {
    return false;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const record = copyOwnDataRecord(value, tlsConfigKeys);
  if (
    record === undefined ||
    (record["rejectUnauthorized"] !== undefined &&
      typeof record["rejectUnauthorized"] !== "boolean") ||
    !["ca", "cert", "key", "servername"].every(
      (key) => record[key] === undefined || isNonEmptyString(record[key]),
    )
  ) {
    return undefined;
  }

  // node-postgres intentionally makes ssl.key non-enumerable in its own
  // connection object, so this defensive copy must remain configurable.
  return { ...record } as PostgresTlsConfig;
}

function decodeNonEmptyUrlPart(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    return isNonEmptyString(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function parseExplicitConnectionString(value: unknown):
  | Readonly<{
      host: string;
      port: number;
      database: string;
      user: string;
      password: string;
    }>
  | undefined {
  if (
    !isNonEmptyString(value) ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint === undefined ||
        codePoint <= 0x20 ||
        codePoint === 0x7f ||
        character === "\\"
      );
    })
  ) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    const user = decodeNonEmptyUrlPart(parsed.username);
    const password = decodeNonEmptyUrlPart(parsed.password);
    const database = decodeNonEmptyUrlPart(parsed.pathname.slice(1));
    const port = Number(parsed.port);
    if (
      (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
      parsed.hostname.length === 0 ||
      parsed.port === "" ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65_535 ||
      user === undefined ||
      password === undefined ||
      database === undefined ||
      parsed.pathname.slice(1).includes("/") ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      return undefined;
    }

    const host = parsed.hostname.startsWith("[")
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;
    return Object.freeze({ host, port, database, user, password });
  } catch {
    return undefined;
  }
}

export function normalizePostgresConnectionConfig(
  value: unknown,
): NormalizedPostgresConnectionConfig | undefined {
  const record = copyOwnDataRecord(value, connectionConfigKeys);
  if (
    record === undefined ||
    !isOptionalNonNegativeInteger(record["connectionTimeoutMillis"]) ||
    !isOptionalNonNegativeInteger(record["statement_timeout"]) ||
    !isOptionalNonNegativeInteger(record["query_timeout"]) ||
    (record["application_name"] !== undefined &&
      (!isNonEmptyString(record["application_name"]) ||
        record["application_name"].length > 64 ||
        !/^[A-Za-z0-9 ._:-]+$/u.test(record["application_name"])))
  ) {
    return undefined;
  }

  const ssl = normalizeTlsConfig(record["ssl"]);
  if (ssl === undefined) {
    return undefined;
  }

  let identity:
    | Readonly<{
        host: string;
        port: number;
        database: string;
        user: string;
        password: string;
      }>
    | undefined;
  if (record["connectionString"] !== undefined) {
    if (
      record["host"] !== undefined ||
      record["port"] !== undefined ||
      record["database"] !== undefined ||
      record["user"] !== undefined ||
      record["password"] !== undefined
    ) {
      return undefined;
    }
    identity = parseExplicitConnectionString(record["connectionString"]);
  } else if (
    isNonEmptyString(record["host"]) &&
    typeof record["port"] === "number" &&
    Number.isInteger(record["port"]) &&
    record["port"] >= 1 &&
    record["port"] <= 65_535 &&
    isNonEmptyString(record["database"]) &&
    isNonEmptyString(record["user"]) &&
    isNonEmptyString(record["password"])
  ) {
    identity = Object.freeze({
      host: record["host"],
      port: record["port"],
      database: record["database"],
      user: record["user"],
      password: record["password"],
    });
  }

  if (identity === undefined) {
    return undefined;
  }

  return Object.freeze({
    ...identity,
    application_name:
      (record["application_name"] as string | undefined) ??
      DEFAULT_APPLICATION_NAME,
    connectionTimeoutMillis:
      (record["connectionTimeoutMillis"] as number | undefined) ?? 0,
    ...(record["statement_timeout"] === undefined
      ? {}
      : { statement_timeout: record["statement_timeout"] as number }),
    ...(record["query_timeout"] === undefined
      ? {}
      : { query_timeout: record["query_timeout"] as number }),
    ssl,
    sslnegotiation: "postgres" as const,
    options: SAFE_SESSION_OPTIONS,
    client_encoding: "UTF8" as const,
    replication: "false" as const,
  });
}

export function isPostgresConnectionConfig(
  value: unknown,
): value is PostgresConnectionConfig {
  return normalizePostgresConnectionConfig(value) !== undefined;
}
