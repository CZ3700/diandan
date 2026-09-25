import type { MigrationDatabaseSession } from "./runner.js";

export type DatabaseCatalogSnapshot = Readonly<{
  schemaVersion: 1;
  postgresMajorVersion: number;
  extensions: readonly Readonly<{ name: string; version: string }>[];
  types: readonly Readonly<{
    name: string;
    kind: string;
    baseType: string | null;
    notNull: boolean;
  }>[];
  enumValues: readonly Readonly<{
    type: string;
    order: number;
    value: string;
  }>[];
  domainConstraints: readonly Readonly<{
    domain: string;
    name: string;
    definition: string;
  }>[];
  tables: readonly Readonly<{ name: string; kind: string }>[];
  columns: readonly Readonly<{
    table: string;
    position: number;
    name: string;
    dataType: string;
    notNull: boolean;
    defaultExpression: string | null;
    identity: string;
    generation: string;
  }>[];
  constraints: readonly Readonly<{
    table: string;
    name: string;
    kind: string;
    definition: string;
    deferrable: boolean;
    initiallyDeferred: boolean;
  }>[];
  indexes: readonly Readonly<{
    table: string;
    name: string;
    definition: string;
    unique: boolean;
    primary: boolean;
    exclusion: boolean;
    valid: boolean;
  }>[];
  triggers: readonly Readonly<{
    table: string;
    name: string;
    definition: string;
    enabled: string;
  }>[];
  functions: readonly Readonly<{
    name: string;
    identityArguments: string;
    resultType: string;
    language: string;
    kind: string;
    volatility: string;
    securityDefiner: boolean;
    definition: string;
  }>[];
}>;

export class DatabaseCatalogError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DatabaseCatalogError";
  }
}

const catalogArrayKeys = [
  "extensions",
  "types",
  "enumValues",
  "domainConstraints",
  "tables",
  "columns",
  "constraints",
  "indexes",
  "triggers",
  "functions",
] as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findFirstDifference(
  actual: unknown,
  expected: unknown,
  currentPath: string,
): string | undefined {
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) {
      return currentPath;
    }
    if (actual.length !== expected.length) {
      return `${currentPath}.length`;
    }
    for (let index = 0; index < actual.length; index += 1) {
      const difference = findFirstDifference(
        actual[index],
        expected[index],
        `${currentPath}[${index}]`,
      );
      if (difference !== undefined) {
        return difference;
      }
    }
    return undefined;
  }

  if (isRecord(actual) || isRecord(expected)) {
    if (!isRecord(actual) || !isRecord(expected)) {
      return currentPath;
    }
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index])
    ) {
      return `${currentPath}.keys`;
    }
    for (const key of actualKeys) {
      const difference = findFirstDifference(
        actual[key],
        expected[key],
        `${currentPath}.${key}`,
      );
      if (difference !== undefined) {
        return difference;
      }
    }
    return undefined;
  }

  return Object.is(actual, expected) ? undefined : currentPath;
}

export function parseDatabaseCatalogSnapshot(
  value: unknown,
): DatabaseCatalogSnapshot {
  if (!isRecord(value)) {
    throw new DatabaseCatalogError("catalog contract has an invalid shape");
  }
  const expectedKeys = [
    "schemaVersion",
    "postgresMajorVersion",
    ...catalogArrayKeys,
  ].sort();
  const actualKeys = Object.keys(value).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    value["schemaVersion"] !== 1 ||
    typeof value["postgresMajorVersion"] !== "number" ||
    !Number.isInteger(value["postgresMajorVersion"]) ||
    catalogArrayKeys.some((key) => !Array.isArray(value[key]))
  ) {
    throw new DatabaseCatalogError("catalog contract has an invalid shape");
  }
  return value as DatabaseCatalogSnapshot;
}

export function assertCatalogMatches(
  actual: DatabaseCatalogSnapshot,
  expected: DatabaseCatalogSnapshot,
): void {
  const difference = findFirstDifference(actual, expected, "$");
  if (difference !== undefined) {
    throw new DatabaseCatalogError(`database catalog drift at ${difference}`);
  }
}

function recordRow(
  value: unknown,
  queryName: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new DatabaseCatalogError(
      `${queryName} returned an invalid catalog row`,
    );
  }
  return value;
}

function stringField(
  row: Readonly<Record<string, unknown>>,
  field: string,
  queryName: string,
): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new DatabaseCatalogError(`${queryName} returned an invalid ${field}`);
  }
  return value;
}

function nullableStringField(
  row: Readonly<Record<string, unknown>>,
  field: string,
  queryName: string,
): string | null {
  const value = row[field];
  if (value === null) {
    return null;
  }
  return stringField(row, field, queryName);
}

function booleanField(
  row: Readonly<Record<string, unknown>>,
  field: string,
  queryName: string,
): boolean {
  const value = row[field];
  if (typeof value !== "boolean") {
    throw new DatabaseCatalogError(`${queryName} returned an invalid ${field}`);
  }
  return value;
}

function numberField(
  row: Readonly<Record<string, unknown>>,
  field: string,
  queryName: string,
): number {
  const value = row[field];
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new DatabaseCatalogError(`${queryName} returned an invalid ${field}`);
  }
  return parsed;
}

function definitionField(
  row: Readonly<Record<string, unknown>>,
  field: string,
  queryName: string,
): string {
  return stringField(row, field, queryName).replaceAll("\r\n", "\n").trim();
}

async function queryCatalogRows(
  session: MigrationDatabaseSession,
  queryName: string,
  sql: string,
): Promise<readonly Readonly<Record<string, unknown>>[]> {
  try {
    const result = await session.query(sql);
    return result.rows.map((row) => recordRow(row, queryName));
  } catch (error: unknown) {
    if (error instanceof DatabaseCatalogError) {
      throw error;
    }
    throw new DatabaseCatalogError(`${queryName} catalog query failed`);
  }
}

export async function captureDatabaseCatalog(
  session: MigrationDatabaseSession,
): Promise<DatabaseCatalogSnapshot> {
  const versionRows = await queryCatalogRows(
    session,
    "server-version",
    `/* catalog:server-version */
SELECT current_setting('server_version_num') AS server_version_num`,
  );
  const versionRow = versionRows[0];
  if (versionRows.length !== 1 || versionRow === undefined) {
    throw new DatabaseCatalogError(
      "server-version returned an invalid row count",
    );
  }
  const serverVersionNumber = numberField(
    versionRow,
    "server_version_num",
    "server-version",
  );
  const postgresMajorVersion = Math.floor(serverVersionNumber / 10_000);

  const extensionRows = await queryCatalogRows(
    session,
    "extensions",
    `/* catalog:extensions */
SELECT extension.extname AS name, extension.extversion AS version
FROM pg_catalog.pg_extension AS extension
ORDER BY extension.extname`,
  );
  const typeRows = await queryCatalogRows(
    session,
    "types",
    `/* catalog:types */
SELECT
  type.typname AS name,
  CASE type.typtype
    WHEN 'd' THEN 'DOMAIN'
    WHEN 'e' THEN 'ENUM'
    ELSE type.typtype::text
  END AS kind,
  CASE
    WHEN type.typtype = 'd'
      THEN pg_catalog.format_type(type.typbasetype, type.typtypmod)
    ELSE NULL
  END AS base_type,
  type.typnotnull AS not_null
FROM pg_catalog.pg_type AS type
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type.typnamespace
LEFT JOIN pg_catalog.pg_depend AS extension_dependency
  ON extension_dependency.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
  AND extension_dependency.objid = type.oid
  AND extension_dependency.deptype = 'e'
WHERE namespace.nspname = 'public'
  AND type.typtype IN ('d', 'e')
  AND extension_dependency.objid IS NULL
ORDER BY type.typname`,
  );
  const enumValueRows = await queryCatalogRows(
    session,
    "enum-values",
    `/* catalog:enum-values */
SELECT
  type.typname AS type,
  enum.enumsortorder::double precision AS "order",
  enum.enumlabel AS value
FROM pg_catalog.pg_enum AS enum
JOIN pg_catalog.pg_type AS type ON type.oid = enum.enumtypid
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type.typnamespace
LEFT JOIN pg_catalog.pg_depend AS extension_dependency
  ON extension_dependency.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
  AND extension_dependency.objid = type.oid
  AND extension_dependency.deptype = 'e'
WHERE namespace.nspname = 'public'
  AND extension_dependency.objid IS NULL
ORDER BY type.typname, enum.enumsortorder`,
  );
  const domainConstraintRows = await queryCatalogRows(
    session,
    "domain-constraints",
    `/* catalog:domain-constraints */
SELECT
  type.typname AS domain,
  catalog_constraint.conname AS name,
  pg_catalog.pg_get_constraintdef(catalog_constraint.oid, true) AS definition
FROM pg_catalog.pg_constraint AS catalog_constraint
JOIN pg_catalog.pg_type AS type ON type.oid = catalog_constraint.contypid
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type.typnamespace
WHERE namespace.nspname = 'public'
ORDER BY type.typname, catalog_constraint.conname`,
  );
  const tableRows = await queryCatalogRows(
    session,
    "tables",
    `/* catalog:tables */
SELECT
  relation.relname AS name,
  CASE relation.relkind
    WHEN 'r' THEN 'TABLE'
    WHEN 'p' THEN 'PARTITIONED_TABLE'
    WHEN 'v' THEN 'VIEW'
    WHEN 'm' THEN 'MATERIALIZED_VIEW'
    WHEN 'f' THEN 'FOREIGN_TABLE'
    ELSE relation.relkind::text
  END AS kind
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
ORDER BY relation.relname`,
  );
  const columnRows = await queryCatalogRows(
    session,
    "columns",
    `/* catalog:columns */
SELECT
  relation.relname AS table,
  row_number() OVER (
    PARTITION BY relation.oid
    ORDER BY attribute.attnum
  )::integer AS position,
  attribute.attname AS name,
  pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
  attribute.attnotnull AS not_null,
  pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) AS default_expression,
  attribute.attidentity::text AS identity,
  attribute.attgenerated::text AS generation
FROM pg_catalog.pg_attribute AS attribute
JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
LEFT JOIN pg_catalog.pg_attrdef AS default_value
  ON default_value.adrelid = attribute.attrelid
  AND default_value.adnum = attribute.attnum
WHERE namespace.nspname = 'public'
  AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND attribute.attnum > 0
  AND NOT attribute.attisdropped
ORDER BY relation.relname, attribute.attnum`,
  );
  const constraintRows = await queryCatalogRows(
    session,
    "constraints",
    `/* catalog:constraints */
SELECT
  relation.relname AS table,
  catalog_constraint.conname AS name,
  CASE catalog_constraint.contype
    WHEN 'c' THEN 'CHECK'
    WHEN 'f' THEN 'FOREIGN_KEY'
    WHEN 'n' THEN 'NOT_NULL'
    WHEN 'p' THEN 'PRIMARY_KEY'
    WHEN 't' THEN 'CONSTRAINT_TRIGGER'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'x' THEN 'EXCLUSION'
    ELSE catalog_constraint.contype::text
  END AS kind,
  pg_catalog.pg_get_constraintdef(catalog_constraint.oid, true) AS definition,
  catalog_constraint.condeferrable AS deferrable,
  catalog_constraint.condeferred AS initially_deferred
FROM pg_catalog.pg_constraint AS catalog_constraint
JOIN pg_catalog.pg_class AS relation ON relation.oid = catalog_constraint.conrelid
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
ORDER BY relation.relname, catalog_constraint.conname`,
  );
  const indexRows = await queryCatalogRows(
    session,
    "indexes",
    `/* catalog:indexes */
SELECT
  table_relation.relname AS table,
  index_relation.relname AS name,
  pg_catalog.pg_get_indexdef(index.indexrelid) AS definition,
  index.indisunique AS unique,
  index.indisprimary AS primary,
  index.indisexclusion AS exclusion,
  index.indisvalid AS valid
FROM pg_catalog.pg_index AS index
JOIN pg_catalog.pg_class AS table_relation ON table_relation.oid = index.indrelid
JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index.indexrelid
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = table_relation.relnamespace
WHERE namespace.nspname = 'public'
ORDER BY table_relation.relname, index_relation.relname`,
  );
  const triggerRows = await queryCatalogRows(
    session,
    "triggers",
    `/* catalog:triggers */
SELECT
  relation.relname AS table,
  trigger.tgname AS name,
  pg_catalog.pg_get_triggerdef(trigger.oid, true) AS definition,
  trigger.tgenabled::text AS enabled
FROM pg_catalog.pg_trigger AS trigger
JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND NOT trigger.tgisinternal
ORDER BY relation.relname, trigger.tgname`,
  );
  const functionRows = await queryCatalogRows(
    session,
    "functions",
    `/* catalog:functions */
SELECT
  procedure.proname AS name,
  pg_catalog.pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
  pg_catalog.pg_get_function_result(procedure.oid) AS result_type,
  language.lanname AS language,
  CASE procedure.prokind
    WHEN 'f' THEN 'FUNCTION'
    WHEN 'p' THEN 'PROCEDURE'
    WHEN 'a' THEN 'AGGREGATE'
    WHEN 'w' THEN 'WINDOW'
    ELSE procedure.prokind::text
  END AS kind,
  CASE procedure.provolatile
    WHEN 'i' THEN 'IMMUTABLE'
    WHEN 's' THEN 'STABLE'
    WHEN 'v' THEN 'VOLATILE'
    ELSE procedure.provolatile::text
  END AS volatility,
  procedure.prosecdef AS security_definer,
  pg_catalog.pg_get_functiondef(procedure.oid) AS definition
FROM pg_catalog.pg_proc AS procedure
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
LEFT JOIN pg_catalog.pg_depend AS extension_dependency
  ON extension_dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
  AND extension_dependency.objid = procedure.oid
  AND extension_dependency.deptype = 'e'
WHERE namespace.nspname = 'public'
  AND extension_dependency.objid IS NULL
ORDER BY procedure.proname, pg_catalog.pg_get_function_identity_arguments(procedure.oid)`,
  );

  return {
    schemaVersion: 1,
    postgresMajorVersion,
    extensions: extensionRows.map((row) => ({
      name: stringField(row, "name", "extensions"),
      version: stringField(row, "version", "extensions"),
    })),
    types: typeRows.map((row) => ({
      name: stringField(row, "name", "types"),
      kind: stringField(row, "kind", "types"),
      baseType: nullableStringField(row, "base_type", "types"),
      notNull: booleanField(row, "not_null", "types"),
    })),
    enumValues: enumValueRows.map((row) => ({
      type: stringField(row, "type", "enum-values"),
      order: numberField(row, "order", "enum-values"),
      value: stringField(row, "value", "enum-values"),
    })),
    domainConstraints: domainConstraintRows.map((row) => ({
      domain: stringField(row, "domain", "domain-constraints"),
      name: stringField(row, "name", "domain-constraints"),
      definition: definitionField(row, "definition", "domain-constraints"),
    })),
    tables: tableRows.map((row) => ({
      name: stringField(row, "name", "tables"),
      kind: stringField(row, "kind", "tables"),
    })),
    columns: columnRows.map((row) => ({
      table: stringField(row, "table", "columns"),
      position: numberField(row, "position", "columns"),
      name: stringField(row, "name", "columns"),
      dataType: stringField(row, "data_type", "columns"),
      notNull: booleanField(row, "not_null", "columns"),
      defaultExpression: nullableStringField(
        row,
        "default_expression",
        "columns",
      ),
      identity: stringField(row, "identity", "columns"),
      generation: stringField(row, "generation", "columns"),
    })),
    constraints: constraintRows.map((row) => ({
      table: stringField(row, "table", "constraints"),
      name: stringField(row, "name", "constraints"),
      kind: stringField(row, "kind", "constraints"),
      definition: definitionField(row, "definition", "constraints"),
      deferrable: booleanField(row, "deferrable", "constraints"),
      initiallyDeferred: booleanField(row, "initially_deferred", "constraints"),
    })),
    indexes: indexRows.map((row) => ({
      table: stringField(row, "table", "indexes"),
      name: stringField(row, "name", "indexes"),
      definition: definitionField(row, "definition", "indexes"),
      unique: booleanField(row, "unique", "indexes"),
      primary: booleanField(row, "primary", "indexes"),
      exclusion: booleanField(row, "exclusion", "indexes"),
      valid: booleanField(row, "valid", "indexes"),
    })),
    triggers: triggerRows.map((row) => ({
      table: stringField(row, "table", "triggers"),
      name: stringField(row, "name", "triggers"),
      definition: definitionField(row, "definition", "triggers"),
      enabled: stringField(row, "enabled", "triggers"),
    })),
    functions: functionRows.map((row) => ({
      name: stringField(row, "name", "functions"),
      identityArguments: stringField(row, "identity_arguments", "functions"),
      resultType: stringField(row, "result_type", "functions"),
      language: stringField(row, "language", "functions"),
      kind: stringField(row, "kind", "functions"),
      volatility: stringField(row, "volatility", "functions"),
      securityDefiner: booleanField(row, "security_definer", "functions"),
      definition: definitionField(row, "definition", "functions"),
    })),
  };
}
