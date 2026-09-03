import {
  sourceHashSchema,
  translationImportPackageSchema,
  translationImportValidationReportSchema,
} from "@fan-support/contracts";
import type {
  SourceHash,
  TranslationImportPackage,
  TranslationImportTrustedTarget,
  TranslationImportValidationIssue,
  TranslationImportValidationIssueCode,
  TranslationImportValidationReport,
} from "@fan-support/contracts";

import {
  computeGiftTranslationContentHash,
  computeHomepageTranslationContentHash,
  computeIdolTranslationContentHash,
  computeMediaTranslationContentHash,
  computePolicyTranslationContentHash,
} from "./hashing.js";

const ICU_COMPLEX_ARGUMENT_TYPES = new Set([
  "plural",
  "select",
  "selectordinal",
]);
const ICU_PLURAL_ARGUMENT_TYPES = new Set(["plural", "selectordinal"]);
const ICU_PLURAL_SELECTORS = new Set([
  "zero",
  "one",
  "two",
  "few",
  "many",
  "other",
]);
const ICU_SIMPLE_ARGUMENT_TYPES = new Set([
  "number",
  "date",
  "time",
  "spellout",
  "ordinal",
  "duration",
]);

function isIcuIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_]/u.test(character);
}

function isIcuIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/u.test(character);
}

function skipWhitespace(value: string, index: number, limit: number): number {
  let cursor = index;
  while (cursor < limit && /\s/u.test(value[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function skipIcuQuotedSyntax(
  value: string,
  index: number,
  limit: number,
): number | undefined {
  if (value[index] !== "'") {
    return undefined;
  }
  if (value[index + 1] === "'") {
    return index + 2;
  }
  if (!["{", "}", "#"].includes(value[index + 1] ?? "")) {
    return undefined;
  }

  let cursor = index + 2;
  while (cursor < limit) {
    if (value[cursor] !== "'") {
      cursor += 1;
      continue;
    }
    if (value[cursor + 1] === "'") {
      cursor += 2;
      continue;
    }
    return cursor + 1;
  }
  return limit;
}

function findMatchingBrace(
  value: string,
  openingBraceIndex: number,
  limit: number,
): number | undefined {
  let depth = 1;
  let cursor = openingBraceIndex + 1;
  while (cursor < limit) {
    const quotedEnd = skipIcuQuotedSyntax(value, cursor, limit);
    if (quotedEnd !== undefined) {
      cursor = quotedEnd;
      continue;
    }
    if (value[cursor] === "{") {
      depth += 1;
    } else if (value[cursor] === "}") {
      depth -= 1;
      if (depth === 0) {
        return cursor;
      }
    }
    cursor += 1;
  }
  return undefined;
}

function readIcuIdentifierEnd(
  value: string,
  index: number,
  limit: number,
): number | undefined {
  if (!isIcuIdentifierStart(value[index])) {
    return undefined;
  }

  let cursor = index + 1;
  while (cursor < limit && isIcuIdentifierCharacter(value[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function readIcuNumberEnd(
  value: string,
  index: number,
  limit: number,
): number | undefined {
  let cursor = index;
  if (["+", "-"].includes(value[cursor] ?? "")) {
    cursor += 1;
  }

  const integerStart = cursor;
  while (cursor < limit && /[0-9]/u.test(value[cursor] ?? "")) {
    cursor += 1;
  }
  if (cursor === integerStart) {
    return undefined;
  }

  if (value[cursor] === ".") {
    cursor += 1;
    const fractionStart = cursor;
    while (cursor < limit && /[0-9]/u.test(value[cursor] ?? "")) {
      cursor += 1;
    }
    if (cursor === fractionStart) {
      return undefined;
    }
  }

  return cursor;
}

function hasValidIcuSimpleStyle(
  value: string,
  start: number,
  limit: number,
): boolean {
  let cursor = skipWhitespace(value, start, limit);
  if (cursor === limit) {
    return false;
  }

  while (cursor < limit) {
    const quotedEnd = skipIcuQuotedSyntax(value, cursor, limit);
    if (quotedEnd !== undefined) {
      cursor = quotedEnd;
      continue;
    }
    if (["{", "}"].includes(value[cursor] ?? "")) {
      return false;
    }
    cursor += 1;
  }
  return true;
}

function hasValidIcuMessageSyntax(
  value: string,
  start: number,
  limit: number,
): boolean {
  let cursor = start;
  while (cursor < limit) {
    const quotedEnd = skipIcuQuotedSyntax(value, cursor, limit);
    if (quotedEnd !== undefined) {
      cursor = quotedEnd;
      continue;
    }
    if (value[cursor] === "}") {
      return false;
    }
    if (value[cursor] !== "{") {
      cursor += 1;
      continue;
    }

    const argumentEnd = parseIcuArgumentSyntax(value, cursor, limit);
    if (argumentEnd === undefined) {
      return false;
    }
    cursor = argumentEnd;
  }
  return true;
}

function hasValidComplexIcuArgumentSyntax(
  value: string,
  start: number,
  limit: number,
  argumentType: string,
): boolean {
  let cursor = skipWhitespace(value, start, limit);
  const isPluralArgument = ICU_PLURAL_ARGUMENT_TYPES.has(argumentType);

  if (isPluralArgument) {
    const possibleOffsetEnd = readIcuIdentifierEnd(value, cursor, limit);
    if (
      possibleOffsetEnd !== undefined &&
      value.slice(cursor, possibleOffsetEnd) === "offset"
    ) {
      cursor = skipWhitespace(value, possibleOffsetEnd, limit);
      if (value[cursor] !== ":") {
        return false;
      }
      cursor = skipWhitespace(value, cursor + 1, limit);
      const offsetEnd = readIcuNumberEnd(value, cursor, limit);
      if (offsetEnd === undefined) {
        return false;
      }
      cursor = offsetEnd;
    }
  }

  let hasOtherBranch = false;
  const selectors = new Set<string>();
  while (cursor < limit) {
    cursor = skipWhitespace(value, cursor, limit);
    if (cursor === limit) {
      break;
    }

    const selectorStart = cursor;
    if (value[cursor] === "=") {
      if (!isPluralArgument) {
        return false;
      }
      const numberEnd = readIcuNumberEnd(value, cursor + 1, limit);
      if (numberEnd === undefined) {
        return false;
      }
      cursor = numberEnd;
    } else {
      const selectorEnd = readIcuIdentifierEnd(value, cursor, limit);
      if (selectorEnd === undefined) {
        return false;
      }
      cursor = selectorEnd;
    }

    const selector = value.slice(selectorStart, cursor);
    if (
      isPluralArgument &&
      !selector.startsWith("=") &&
      !ICU_PLURAL_SELECTORS.has(selector)
    ) {
      return false;
    }
    if (selectors.has(selector)) {
      return false;
    }
    selectors.add(selector);
    hasOtherBranch ||= selector === "other";

    cursor = skipWhitespace(value, cursor, limit);
    if (value[cursor] !== "{") {
      return false;
    }
    const branchEnd = findMatchingBrace(value, cursor, limit);
    if (
      branchEnd === undefined ||
      !hasValidIcuMessageSyntax(value, cursor + 1, branchEnd)
    ) {
      return false;
    }
    cursor = branchEnd + 1;
  }

  return selectors.size > 0 && hasOtherBranch;
}

function parseIcuArgumentSyntax(
  value: string,
  openingBraceIndex: number,
  limit: number,
): number | undefined {
  const closingBraceIndex = findMatchingBrace(value, openingBraceIndex, limit);
  if (closingBraceIndex === undefined) {
    return undefined;
  }

  let cursor = skipWhitespace(value, openingBraceIndex + 1, closingBraceIndex);
  const identifierEnd = readIcuIdentifierEnd(value, cursor, closingBraceIndex);
  if (identifierEnd === undefined) {
    return undefined;
  }
  cursor = skipWhitespace(value, identifierEnd, closingBraceIndex);
  if (cursor === closingBraceIndex) {
    return closingBraceIndex + 1;
  }
  if (value[cursor] !== ",") {
    return undefined;
  }

  cursor = skipWhitespace(value, cursor + 1, closingBraceIndex);
  const argumentTypeEnd = readIcuIdentifierEnd(
    value,
    cursor,
    closingBraceIndex,
  );
  if (argumentTypeEnd === undefined) {
    return undefined;
  }
  const argumentType = value.slice(cursor, argumentTypeEnd).toLowerCase();
  cursor = skipWhitespace(value, argumentTypeEnd, closingBraceIndex);

  if (ICU_COMPLEX_ARGUMENT_TYPES.has(argumentType)) {
    if (
      value[cursor] !== "," ||
      !hasValidComplexIcuArgumentSyntax(
        value,
        cursor + 1,
        closingBraceIndex,
        argumentType,
      )
    ) {
      return undefined;
    }
    return closingBraceIndex + 1;
  }

  if (!ICU_SIMPLE_ARGUMENT_TYPES.has(argumentType)) {
    return undefined;
  }
  if (cursor === closingBraceIndex) {
    return closingBraceIndex + 1;
  }
  if (
    value[cursor] !== "," ||
    !hasValidIcuSimpleStyle(value, cursor + 1, closingBraceIndex)
  ) {
    return undefined;
  }
  return closingBraceIndex + 1;
}

function collectIcuVariablesFromMessage(
  value: string,
  start: number,
  limit: number,
  variables: Set<string>,
): void {
  let cursor = start;
  while (cursor < limit) {
    const quotedEnd = skipIcuQuotedSyntax(value, cursor, limit);
    if (quotedEnd !== undefined) {
      cursor = quotedEnd;
      continue;
    }
    if (value[cursor] !== "{") {
      cursor += 1;
      continue;
    }

    const argumentEnd = collectIcuArgument(value, cursor, limit, variables);
    cursor = argumentEnd ?? cursor + 1;
  }
}

function collectComplexIcuArgumentVariables(
  value: string,
  start: number,
  limit: number,
  variables: Set<string>,
): number {
  let cursor = start;
  while (cursor < limit) {
    const quotedEnd = skipIcuQuotedSyntax(value, cursor, limit);
    if (quotedEnd !== undefined) {
      cursor = quotedEnd;
      continue;
    }
    if (value[cursor] === "}") {
      return cursor + 1;
    }
    if (value[cursor] !== "{") {
      cursor += 1;
      continue;
    }

    const bodyEnd = findMatchingBrace(value, cursor, limit);
    if (bodyEnd === undefined) {
      return limit;
    }
    collectIcuVariablesFromMessage(value, cursor + 1, bodyEnd, variables);
    cursor = bodyEnd + 1;
  }
  return limit;
}

function collectIcuArgument(
  value: string,
  openingBraceIndex: number,
  limit: number,
  variables: Set<string>,
): number | undefined {
  let cursor = skipWhitespace(value, openingBraceIndex + 1, limit);
  if (!isIcuIdentifierStart(value[cursor])) {
    return undefined;
  }

  const identifierStart = cursor;
  cursor += 1;
  while (cursor < limit && isIcuIdentifierCharacter(value[cursor])) {
    cursor += 1;
  }
  const identifier = value.slice(identifierStart, cursor);
  cursor = skipWhitespace(value, cursor, limit);
  if (value[cursor] === "}") {
    variables.add(identifier);
    return cursor + 1;
  }
  if (value[cursor] !== ",") {
    return undefined;
  }

  variables.add(identifier);
  cursor = skipWhitespace(value, cursor + 1, limit);
  const argumentTypeStart = cursor;
  while (cursor < limit && isIcuIdentifierCharacter(value[cursor])) {
    cursor += 1;
  }
  const argumentType = value.slice(argumentTypeStart, cursor).toLowerCase();
  cursor = skipWhitespace(value, cursor, limit);

  if (ICU_COMPLEX_ARGUMENT_TYPES.has(argumentType) && value[cursor] === ",") {
    return collectComplexIcuArgumentVariables(
      value,
      cursor + 1,
      limit,
      variables,
    );
  }

  const closingBraceIndex = findMatchingBrace(value, openingBraceIndex, limit);
  return closingBraceIndex === undefined ? limit : closingBraceIndex + 1;
}

function extractIcuVariables(value: string): ReadonlySet<string> {
  const variables = new Set<string>();
  collectIcuVariablesFromMessage(value, 0, value.length, variables);
  return variables;
}

function findIcuSyntaxInvalidPath(
  value: unknown,
  path: readonly (string | number)[] = [],
): (string | number)[] | undefined {
  if (typeof value === "string") {
    return hasValidIcuMessageSyntax(value, 0, value.length)
      ? undefined
      : [...path];
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const invalidPath = findIcuSyntaxInvalidPath(item, [...path, index]);
      if (invalidPath !== undefined) {
        return invalidPath;
      }
    }
    return undefined;
  }

  if (value === null || typeof value !== "object") {
    return undefined;
  }

  const record = value as Readonly<Record<string, unknown>>;
  for (const key of Object.keys(record).sort()) {
    const invalidPath = findIcuSyntaxInvalidPath(record[key], [...path, key]);
    if (invalidPath !== undefined) {
      return invalidPath;
    }
  }
  return undefined;
}

function sameStringSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

type KeyedArrayEntry = Readonly<{ index: number; value: unknown }>;
type KeyedArrayIndex = Readonly<{
  keyField: "giftVariantId" | "slotKey";
  entries: ReadonlyMap<string, KeyedArrayEntry>;
}>;

function indexStableKeyedArray(
  values: readonly unknown[],
): KeyedArrayIndex | undefined {
  if (values.length === 0) {
    return undefined;
  }

  let keyField: KeyedArrayIndex["keyField"] | undefined;
  const entries = new Map<string, KeyedArrayEntry>();
  for (const [index, value] of values.entries()) {
    if (value === null || typeof value !== "object") {
      return undefined;
    }
    const record = value as Readonly<Record<string, unknown>>;
    const candidateKeyField =
      typeof record["giftVariantId"] === "string"
        ? "giftVariantId"
        : typeof record["slotKey"] === "string"
          ? "slotKey"
          : undefined;
    if (
      candidateKeyField === undefined ||
      (keyField !== undefined && candidateKeyField !== keyField)
    ) {
      return undefined;
    }
    keyField = candidateKeyField;
    const rawKey = record[candidateKeyField] as string;
    const key =
      candidateKeyField === "giftVariantId" ? rawKey.toLowerCase() : rawKey;
    if (entries.has(key)) {
      return undefined;
    }
    entries.set(key, { index, value });
  }
  return keyField === undefined ? undefined : { keyField, entries };
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function findIcuVariableMismatchPath(
  englishSource: unknown,
  translation: unknown,
  path: readonly (string | number)[] = [],
): (string | number)[] | undefined {
  if (typeof englishSource === "string" || typeof translation === "string") {
    const englishVariables =
      typeof englishSource === "string"
        ? extractIcuVariables(englishSource)
        : new Set<string>();
    const translationVariables =
      typeof translation === "string"
        ? extractIcuVariables(translation)
        : new Set<string>();
    return sameStringSet(englishVariables, translationVariables)
      ? undefined
      : [...path];
  }

  if (Array.isArray(englishSource) || Array.isArray(translation)) {
    const englishItems = Array.isArray(englishSource) ? englishSource : [];
    const translatedItems = Array.isArray(translation) ? translation : [];
    const englishByKey = indexStableKeyedArray(englishItems);
    const translatedByKey = indexStableKeyedArray(translatedItems);
    if (
      englishByKey !== undefined &&
      translatedByKey !== undefined &&
      englishByKey.keyField === translatedByKey.keyField
    ) {
      const keys = [
        ...new Set([
          ...englishByKey.entries.keys(),
          ...translatedByKey.entries.keys(),
        ]),
      ].sort(compareAscii);
      for (const key of keys) {
        const englishEntry = englishByKey.entries.get(key);
        const translatedEntry = translatedByKey.entries.get(key);
        const mismatchPath = findIcuVariableMismatchPath(
          englishEntry?.value,
          translatedEntry?.value,
          [...path, translatedEntry?.index ?? englishEntry?.index ?? 0],
        );
        if (mismatchPath !== undefined) {
          return mismatchPath;
        }
      }
      return undefined;
    }
    const length = Math.max(englishItems.length, translatedItems.length);
    for (let index = 0; index < length; index += 1) {
      const mismatchPath = findIcuVariableMismatchPath(
        englishItems[index],
        translatedItems[index],
        [...path, index],
      );
      if (mismatchPath !== undefined) {
        return mismatchPath;
      }
    }
    return undefined;
  }

  const englishRecord =
    englishSource !== null && typeof englishSource === "object"
      ? (englishSource as Readonly<Record<string, unknown>>)
      : {};
  const translatedRecord =
    translation !== null && typeof translation === "object"
      ? (translation as Readonly<Record<string, unknown>>)
      : {};
  const keys = [
    ...new Set([
      ...Object.keys(englishRecord),
      ...Object.keys(translatedRecord),
    ]),
  ].sort();
  for (const key of keys) {
    const mismatchPath = findIcuVariableMismatchPath(
      englishRecord[key],
      translatedRecord[key],
      [...path, key],
    );
    if (mismatchPath !== undefined) {
      return mismatchPath;
    }
  }
  return undefined;
}

function safePath(path: readonly PropertyKey[]): (string | number)[] {
  return path.map((segment) =>
    typeof segment === "number" ? segment : String(segment),
  );
}

function issue(
  code: TranslationImportValidationIssueCode,
  path: readonly (string | number)[],
): TranslationImportValidationIssue {
  return { code, path: [...path] };
}

function invalidReport(
  issues: readonly TranslationImportValidationIssue[],
): TranslationImportValidationReport {
  return translationImportValidationReportSchema.parse({
    schemaVersion: 1,
    valid: false,
    issues,
  });
}

function computePackageContentHash(
  packageData: TranslationImportPackage,
  source: "english" | "translation",
): SourceHash {
  switch (packageData.objectKind) {
    case "IDOL":
      return sourceHashSchema.parse(
        computeIdolTranslationContentHash(
          source === "english"
            ? packageData.context.englishSource
            : packageData.fields,
        ),
      );
    case "GIFT":
      return sourceHashSchema.parse(
        computeGiftTranslationContentHash(
          source === "english"
            ? packageData.context.englishSource
            : packageData.fields,
        ),
      );
    case "HOMEPAGE":
      return sourceHashSchema.parse(
        computeHomepageTranslationContentHash(
          source === "english"
            ? packageData.context.englishSource
            : packageData.fields,
        ),
      );
    case "POLICY":
      return sourceHashSchema.parse(
        computePolicyTranslationContentHash(
          source === "english"
            ? packageData.context.englishSource
            : packageData.fields,
        ),
      );
    case "MEDIA_METADATA":
      return sourceHashSchema.parse(
        computeMediaTranslationContentHash(
          source === "english"
            ? packageData.context.englishSource
            : packageData.fields,
        ),
      );
  }
}

export function validateTranslationImportPackage(
  input: unknown,
  trustedTarget: TranslationImportTrustedTarget,
): TranslationImportValidationReport {
  const parsed = translationImportPackageSchema.safeParse(input);
  if (!parsed.success) {
    return invalidReport(
      parsed.error.issues.map((schemaIssue) =>
        issue("SCHEMA_INVALID", safePath(schemaIssue.path)),
      ),
    );
  }

  if (parsed.data.objectKind !== trustedTarget.objectKind) {
    return invalidReport([issue("TARGET_MISMATCH", ["objectKind"])]);
  }

  if (
    parsed.data.parentRevisionId.toLowerCase() !==
    trustedTarget.parentRevisionId.toLowerCase()
  ) {
    return invalidReport([issue("TARGET_MISMATCH", ["parentRevisionId"])]);
  }

  if (
    parsed.data.expectedEnglishSourceHash !==
    trustedTarget.currentEnglishSourceHash
  ) {
    return invalidReport([
      issue("STALE_ENGLISH_SOURCE", ["expectedEnglishSourceHash"]),
    ]);
  }

  const englishContextHash = computePackageContentHash(parsed.data, "english");
  if (englishContextHash !== parsed.data.expectedEnglishSourceHash) {
    return invalidReport([
      issue("ENGLISH_CONTEXT_HASH_MISMATCH", ["context", "englishSource"]),
    ]);
  }

  const contentHash = computePackageContentHash(parsed.data, "translation");
  if (contentHash !== parsed.data.contentHash) {
    return invalidReport([issue("CONTENT_HASH_MISMATCH", ["contentHash"])]);
  }

  const englishIcuSyntaxPath = findIcuSyntaxInvalidPath(
    parsed.data.context.englishSource,
  );
  if (englishIcuSyntaxPath !== undefined) {
    return invalidReport([
      issue("ICU_SYNTAX_INVALID", [
        "context",
        "englishSource",
        ...englishIcuSyntaxPath,
      ]),
    ]);
  }

  const translatedIcuSyntaxPath = findIcuSyntaxInvalidPath(parsed.data.fields);
  if (translatedIcuSyntaxPath !== undefined) {
    return invalidReport([
      issue("ICU_SYNTAX_INVALID", ["fields", ...translatedIcuSyntaxPath]),
    ]);
  }

  const icuMismatchPath = findIcuVariableMismatchPath(
    parsed.data.context.englishSource,
    parsed.data.fields,
  );
  if (icuMismatchPath !== undefined) {
    return invalidReport([
      issue("ICU_VARIABLE_MISMATCH", ["fields", ...icuMismatchPath]),
    ]);
  }

  return translationImportValidationReportSchema.parse({
    schemaVersion: 1,
    valid: true,
    contentHash,
    issues: [],
  });
}
