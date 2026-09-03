import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

const manifestRelativePath = "database/migrations/manifest.json";
const migrationDirectoryRelativePath = "database/migrations";
const sha256Pattern = /^[a-f0-9]{64}$/u;
const versionPattern = /^\d{4}$/u;
const namePattern = /^[a-z][a-z0-9-]*$/u;
const dollarQuoteDelimiterPattern = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u;
const asciiSqlWordStartPattern = /[A-Za-z_]/u;
const asciiSqlWordPartPattern = /[A-Za-z0-9_$]/u;

function isSqlWordStart(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return (
    asciiSqlWordStartPattern.test(character) ||
    (codePoint !== undefined && codePoint >= 0x80)
  );
}

function isSqlWordPart(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return (
    asciiSqlWordPartPattern.test(character) ||
    (codePoint !== undefined && codePoint >= 0x80)
  );
}

type JsonRecord = Readonly<Record<string, unknown>>;

type ManifestMigration = Readonly<{
  version: string;
  name: string;
  up: string;
  down: string;
  sha256: Readonly<{ up: string; down: string }>;
}>;

export type MigrationSource = Readonly<{
  relativePath: string;
  sha256: string;
  sql: string;
}>;

export type LoadedMigration = Readonly<{
  version: string;
  name: string;
  up: MigrationSource;
  down: MigrationSource;
}>;

export class MigrationManifestError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MigrationManifestError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: JsonRecord,
  expectedKeys: readonly string[],
  subject: string,
): void {
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actualKeys.length !== expected.length ||
    actualKeys.some((key, index) => key !== expected[index])
  ) {
    throw new MigrationManifestError(`${subject} has an invalid shape`);
  }
}

function parseString(
  value: unknown,
  subject: string,
  pattern?: RegExp,
): string {
  if (
    typeof value !== "string" ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw new MigrationManifestError(`${subject} is invalid`);
  }
  return value;
}

function parseMigration(value: unknown, index: number): ManifestMigration {
  const subject = `migration at index ${index}`;
  if (!isRecord(value)) {
    throw new MigrationManifestError(`${subject} has an invalid shape`);
  }
  assertExactKeys(value, ["version", "name", "up", "down", "sha256"], subject);

  const version = parseString(
    value["version"],
    `${subject} version`,
    versionPattern,
  );
  const name = parseString(value["name"], `${subject} name`, namePattern);
  const expectedBaseName = `${version}_${name}`;
  const expectedUpPath = `${migrationDirectoryRelativePath}/${expectedBaseName}.up.sql`;
  const expectedDownPath = `${migrationDirectoryRelativePath}/${expectedBaseName}.down.sql`;
  const up = parseString(value["up"], `${subject} up path`);
  const down = parseString(value["down"], `${subject} down path`);
  if (up !== expectedUpPath || down !== expectedDownPath) {
    throw new MigrationManifestError(`${subject} does not use canonical paths`);
  }

  const hashes = value["sha256"];
  if (!isRecord(hashes)) {
    throw new MigrationManifestError(
      `${subject} checksums have an invalid shape`,
    );
  }
  assertExactKeys(hashes, ["up", "down"], `${subject} checksums`);

  return {
    version,
    name,
    up,
    down,
    sha256: {
      up: parseString(hashes["up"], `${subject} up checksum`, sha256Pattern),
      down: parseString(
        hashes["down"],
        `${subject} down checksum`,
        sha256Pattern,
      ),
    },
  };
}

function parseManifest(value: unknown): readonly ManifestMigration[] {
  if (!isRecord(value)) {
    throw new MigrationManifestError("migration manifest has an invalid shape");
  }
  assertExactKeys(value, ["schemaVersion", "migrations"], "migration manifest");
  if (value["schemaVersion"] !== 1 || !Array.isArray(value["migrations"])) {
    throw new MigrationManifestError(
      "migration manifest is not schemaVersion 1",
    );
  }

  const migrations = value["migrations"].map(parseMigration);
  let previousVersion: string | undefined;
  for (const migration of migrations) {
    if (previousVersion !== undefined && migration.version <= previousVersion) {
      throw new MigrationManifestError(
        "migration versions must be unique and strictly increasing",
      );
    }
    previousVersion = migration.version;
  }
  return migrations;
}

async function assertNoSymlinkComponents(
  canonicalWorkspaceRoot: string,
  relativePath: string,
): Promise<string> {
  if (
    path.isAbsolute(relativePath) ||
    relativePath
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new MigrationManifestError(
      `${relativePath} is not a safe relative path`,
    );
  }

  let candidate = canonicalWorkspaceRoot;
  for (const segment of relativePath.split("/")) {
    candidate = path.join(candidate, segment);
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink()) {
      throw new MigrationManifestError(
        `${relativePath} contains a symbolic link`,
      );
    }
  }

  const canonicalCandidate = await realpath(candidate);
  if (
    canonicalCandidate !== canonicalWorkspaceRoot &&
    !canonicalCandidate.startsWith(`${canonicalWorkspaceRoot}${path.sep}`)
  ) {
    throw new MigrationManifestError(`${relativePath} escapes the workspace`);
  }
  return canonicalCandidate;
}

function calculateSha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function startsTransactionControl(words: readonly string[]): boolean {
  const first = words[0]?.toUpperCase();
  const second = words[1]?.toUpperCase();
  return (
    first === "BEGIN" ||
    first === "COMMIT" ||
    first === "END" ||
    first === "ABORT" ||
    first === "ROLLBACK" ||
    first === "SAVEPOINT" ||
    first === "RELEASE" ||
    (first === "START" && second === "TRANSACTION") ||
    (first === "PREPARE" && second === "TRANSACTION")
  );
}

function containsTransactionControl(sql: string): boolean {
  let index = 0;
  let leadingWords: string[] = [];

  const finishStatement = (): boolean => {
    const rejected = startsTransactionControl(leadingWords);
    leadingWords = [];
    return rejected;
  };

  while (index < sql.length) {
    const character = sql[index];
    const nextCharacter = sql[index + 1];

    if (character === "-" && nextCharacter === "-") {
      const newlineIndex = sql.indexOf("\n", index + 2);
      const carriageReturnIndex = sql.indexOf("\r", index + 2);
      const lineEnd =
        newlineIndex === -1
          ? carriageReturnIndex
          : carriageReturnIndex === -1
            ? newlineIndex
            : Math.min(newlineIndex, carriageReturnIndex);
      index = lineEnd === -1 ? sql.length : lineEnd + 1;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      let depth = 1;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql[index] === "/" && sql[index + 1] === "*") {
          depth += 1;
          index += 2;
        } else if (sql[index] === "*" && sql[index + 1] === "/") {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      continue;
    }

    if (character === "'") {
      const prefix = sql[index - 1];
      const beforePrefix = sql[index - 2];
      const backslashEscapes =
        (prefix === "E" || prefix === "e") &&
        (beforePrefix === undefined || !isSqlWordPart(beforePrefix));
      index += 1;
      while (index < sql.length) {
        if (backslashEscapes && sql[index] === "\\") {
          index += 2;
        } else if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
        } else if (sql[index] === "'") {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      continue;
    }

    if (character === '"') {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === '"' && sql[index + 1] === '"') {
          index += 2;
        } else if (sql[index] === '"') {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      continue;
    }

    if (character === "$") {
      const delimiter = dollarQuoteDelimiterPattern.exec(sql.slice(index))?.[0];
      if (delimiter !== undefined) {
        const closingIndex = sql.indexOf(delimiter, index + delimiter.length);
        index =
          closingIndex === -1 ? sql.length : closingIndex + delimiter.length;
        continue;
      }
    }

    if (character === ";") {
      if (finishStatement()) {
        return true;
      }
      index += 1;
      continue;
    }

    if (character !== undefined && isSqlWordStart(character)) {
      const wordStart = index;
      index += 1;
      while (index < sql.length && isSqlWordPart(sql[index] ?? "")) {
        index += 1;
      }
      if (leadingWords.length < 2) {
        leadingWords.push(sql.slice(wordStart, index));
      }
      continue;
    }

    index += 1;
  }

  return finishStatement();
}

async function loadSource(
  canonicalWorkspaceRoot: string,
  relativePath: string,
  expectedSha256: string,
): Promise<MigrationSource> {
  const absolutePath = await assertNoSymlinkComponents(
    canonicalWorkspaceRoot,
    relativePath,
  );
  const bytes = await readFile(absolutePath);
  const actualSha256 = calculateSha256(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new MigrationManifestError(`${relativePath} checksum does not match`);
  }

  let sql: string;
  try {
    sql = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new MigrationManifestError(`${relativePath} is not valid UTF-8`);
  }
  if (sql.trim().length === 0) {
    throw new MigrationManifestError(`${relativePath} is empty`);
  }
  if (containsTransactionControl(sql)) {
    throw new MigrationManifestError(
      `${relativePath} must not contain transaction control`,
    );
  }

  return { relativePath, sha256: actualSha256, sql };
}

async function assertManifestOwnsEverySqlFile(
  canonicalWorkspaceRoot: string,
  migrations: readonly ManifestMigration[],
): Promise<void> {
  const directoryPath = await assertNoSymlinkComponents(
    canonicalWorkspaceRoot,
    migrationDirectoryRelativePath,
  );
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const actualSqlFiles = entries
    .filter((entry) => entry.name.endsWith(".sql"))
    .map((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new MigrationManifestError(
          `${migrationDirectoryRelativePath}/${entry.name} is not a regular file`,
        );
      }
      return `${migrationDirectoryRelativePath}/${entry.name}`;
    })
    .sort();
  const expectedSqlFiles = migrations
    .flatMap((migration) => [migration.up, migration.down])
    .sort();
  if (
    actualSqlFiles.length !== expectedSqlFiles.length ||
    actualSqlFiles.some((file, index) => file !== expectedSqlFiles[index])
  ) {
    throw new MigrationManifestError(
      "migration manifest does not own every SQL migration file",
    );
  }
}

export async function loadMigrationManifest(options: {
  workspaceRoot: string;
}): Promise<readonly LoadedMigration[]> {
  const canonicalWorkspaceRoot = await realpath(
    path.resolve(options.workspaceRoot),
  );
  const manifestPath = await assertNoSymlinkComponents(
    canonicalWorkspaceRoot,
    manifestRelativePath,
  );
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  } catch (error: unknown) {
    if (error instanceof MigrationManifestError) {
      throw error;
    }
    throw new MigrationManifestError("migration manifest is not valid JSON");
  }
  const migrations = parseManifest(manifestValue);
  await assertManifestOwnsEverySqlFile(canonicalWorkspaceRoot, migrations);

  return Promise.all(
    migrations.map(async (migration) => {
      const [up, down] = await Promise.all([
        loadSource(canonicalWorkspaceRoot, migration.up, migration.sha256.up),
        loadSource(
          canonicalWorkspaceRoot,
          migration.down,
          migration.sha256.down,
        ),
      ]);
      return {
        version: migration.version,
        name: migration.name,
        up,
        down,
      };
    }),
  );
}
