import { createHash } from "node:crypto";
import { sourceHashSchema } from "@fan-support/contracts";

const uuidFields = new Set([
  "id",
  "revisionId",
  "translationId",
  "reviewId",
  "authoringReceiptId",
  "approvalId",
  "targetTranslationId",
  "targetReviewId",
  "sourceRevisionId",
  "idolId",
  "giftId",
  "mediaAssetId",
  "metadataRevisionId",
  "mediaMetadataRevisionId",
  "idolRevisionId",
  "giftRevisionId",
  "homepageRevisionId",
  "policyRevisionId",
  "translationRevisionId",
  "editorId",
  "reviewerId",
  "createdBy",
  "structureEditorId",
  "auditLogId",
  "jobId",
  "assetId",
  "outputAssetId",
  "giftVariantId",
  "importBatchId",
]);
const timeFields = new Set([
  "createdAt",
  "editedAt",
  "reviewedAt",
  "submittedAt",
  "effectiveAt",
]);
const setFields = new Set([
  "translations",
  "translationAudits",
  "mediaRevisions",
  "approvals",
  "copies",
  "extensionApprovals",
  "assets",
  "variants",
  "lineage",
  "processing",
  "media",
  "aliases",
  "contents",
  "slots",
  "variantLabels",
  "slotLabels",
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function timestamp(value: string): string {
  const match = /^(.+?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) throw new Error("Invalid manifest timestamp");
  const second = new Date(`${match[1]}${match[3]}`).toISOString().slice(0, -5);
  return `${second}.${(match[2] ?? "").padEnd(6, "0")}Z`;
}
function order(value: unknown, key: string): unknown {
  if (typeof value === "string") {
    if (uuidFields.has(key) && uuidPattern.test(value))
      return value.toLowerCase();
    if (timeFields.has(key)) return timestamp(value);
    return value;
  }
  if (Array.isArray(value)) {
    const rows = value.map((entry) => order(entry, ""));
    // Structure owns block/item order; translated rows are identity keyed maps.
    const translatedRows =
      (key === "blocks" &&
        value.every(
          (row) => typeof row === "object" && row !== null && "blockId" in row,
        )) ||
      (key === "items" &&
        value.every(
          (row) => typeof row === "object" && row !== null && "itemId" in row,
        ));
    return setFields.has(key) || translatedRows
      ? rows.toSorted((a, b) => {
          const left = JSON.stringify(a),
            right = JSON.stringify(b);
          return left < right ? -1 : left > right ? 1 : 0;
        })
      : rows;
  }
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, child]) => [name, order(child, name)]),
    );
  return value;
}
function decimal(value: number): string {
  const encoded = JSON.stringify(value);
  if (!/[eE]/u.test(encoded)) return encoded;
  const [mantissa, exponent] = encoded.split(/[eE]/u);
  const sign = mantissa!.startsWith("-") ? "-" : "";
  const unsigned = mantissa!.replace(/^-/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const digits = whole! + fraction;
  const position = whole!.length + Number(exponent);
  if (position <= 0) return `${sign}0.${"0".repeat(-position)}${digits}`;
  if (position >= digits.length)
    return sign + digits + "0".repeat(position - digits.length);
  return `${sign}${digits.slice(0, position)}.${digits.slice(position)}`;
}
function encode(value: unknown): string {
  if (typeof value === "number") return decimal(value);
  if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .map(([key, child]) => `${JSON.stringify(key)}:${encode(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function canonicalPublicationValue(value: unknown): string {
  return encode(order(value, ""));
}
export function hashPublicationValue(domain: string, value: unknown) {
  return sourceHashSchema.parse(
    createHash("sha256")
      .update(`${domain}\n${canonicalPublicationValue(value)}`, "utf8")
      .digest("hex"),
  );
}
