import {
  baseContentTextSchema,
  contentAuthoringCommandSchema,
  translationExportReceiptSchema,
  translationTransferPackageSchema,
  type ContentAuthoringSnapshot,
  type ContentAuthoringCommand,
  type TranslationExportReceipt,
  type TranslationTransferPackage,
  type TranslationFieldConstraint,
  type BaseContentText,
} from "@fan-support/contracts";
import { computeBaseContentTextHash } from "./base-content.js";
import {
  assertTranslationSnapshot,
  canonicalTranslationValue,
} from "./translation-authoring.js";
import { validateTranslationFieldPair } from "./translation-validation.js";

function fieldConstraints(
  kind: BaseContentText["kind"],
): TranslationFieldConstraint[] {
  const schema = baseContentTextSchema.options
    .find((option) => option.shape.kind.value === kind)!
    .shape.fields.toJSONSchema();
  const collect = (
    input: unknown,
    path: string,
    required: boolean,
  ): TranslationFieldConstraint[] => {
    if (input === null || typeof input !== "object") return [];
    const node = input as Record<string, unknown>;
    if (typeof node["maxLength"] === "number") {
      const tags = node["x-allowed-html-tags"];
      return [
        {
          path,
          required,
          maxLength: node["maxLength"],
          format: Array.isArray(tags) ? "CONTROLLED_RICH_TEXT" : "PLAIN_TEXT",
          ...(Array.isArray(tags) ? { allowedTags: tags as string[] } : {}),
        },
      ];
    }
    if (node["items"]) return collect(node["items"], `${path}.*`, required);
    if (node["properties"] && typeof node["properties"] === "object")
      return Object.entries(node["properties"]).flatMap(([key, value]) =>
        collect(
          value,
          path ? `${path}.${key}` : key,
          Array.isArray(node["required"]) && node["required"].includes(key),
        ),
      );
    return [];
  };
  return collect(schema, "", false);
}
export function buildTranslationTransferPackage(
  input: ContentAuthoringSnapshot,
  receiptInput: TranslationExportReceipt,
): TranslationTransferPackage {
  const receipt = translationExportReceiptSchema.parse(receiptInput);
  const snapshot = assertTranslationSnapshot(input, receipt.target);
  const english = baseContentTextSchema.parse({
    kind: snapshot.content.kind,
    fields: snapshot.content.translations.find((row) => row.locale === "en")!
      .fields,
  });
  if (computeBaseContentTextHash(english) !== receipt.englishSourceHash)
    throw new Error("CONTENT_UNAVAILABLE");
  return translationTransferPackageSchema.parse({
    schemaVersion: 1,
    packageId: receipt.id,
    target: receipt.target,
    authoringHeadVersion: receipt.authoringHeadVersion,
    sourceSnapshotHash: receipt.sourceSnapshotHash,
    english: { sourceHash: receipt.englishSourceHash, text: english },
    entries: receipt.locales.map((locale) => {
      const row = snapshot.content.translations.find(
        (item) => item.locale === locale,
      );
      return {
        locale,
        text: row ? { kind: snapshot.content.kind, fields: row.fields } : null,
      };
    }),
    constraints: fieldConstraints(snapshot.content.kind),
    exportedAt: receipt.createdAt,
  });
}
export function prepareTranslationImport(
  packetInput: TranslationTransferPackage,
  input: ContentAuthoringSnapshot,
  receipt: TranslationExportReceipt,
  batchId: string,
  command: { reasonCode: string; idempotencyKey: string },
): Extract<ContentAuthoringCommand, { action: "COPY" }> {
  const packet = translationTransferPackageSchema.parse(packetInput);
  const snapshot = assertTranslationSnapshot(input, receipt.target);
  const original = buildTranslationTransferPackage(snapshot, receipt);
  const metadata = (value: TranslationTransferPackage) => ({
    ...value,
    entries: value.entries.map((entry) => ({ locale: entry.locale })),
  });
  if (
    canonicalTranslationValue(metadata(packet)) !==
    canonicalTranslationValue(metadata(original))
  )
    throw new Error("INVALID_CONTENT");
  if (snapshot.headVersion !== receipt.authoringHeadVersion)
    throw new Error("STALE_VERSION");
  if (snapshot.contentHash !== receipt.sourceSnapshotHash)
    throw new Error("STALE_CONTENT");
  const importedEnglish =
    packet.entries.find((entry) => entry.locale === "en")?.text ??
    original.english.text;
  const translations = packet.entries.map((entry) => {
    if (
      entry.text === null ||
      validateTranslationFieldPair(importedEnglish.fields, entry.text.fields)
        .length > 0
    )
      throw new Error("INVALID_CONTENT");
    return {
      locale: entry.locale,
      fields: entry.text.fields,
      origin: "IMPORT",
      importBatchId: batchId,
    };
  });
  const parsed = contentAuthoringCommandSchema.parse({
    schemaVersion: 1,
    action: "COPY",
    target: receipt.target.owner,
    sourceRevisionId: receipt.target.revisionId,
    expectedVersion: receipt.authoringHeadVersion,
    expectedSourceHash: receipt.sourceSnapshotHash,
    changes: { kind: snapshot.content.kind, translations },
    reasonCode: command.reasonCode,
    idempotencyKey: command.idempotencyKey,
  });
  if (parsed.action !== "COPY") throw new Error("INVALID_CONTENT");
  return parsed;
}
