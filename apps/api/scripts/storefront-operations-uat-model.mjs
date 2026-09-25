import { performance } from "node:perf_hooks";
import {
  SUPPORTED_LOCALES,
  translationTransferPackageSchema,
} from "@fan-support/contracts";
import { operationsText } from "./storefront-operations-uat-materials.mjs";
export { operationsText } from "./storefront-operations-uat-materials.mjs";
export const OPERATIONS_CASES = Object.freeze({
  homepage: 180_000,
  idol: 300_000,
  gift: 480_000,
});
const roles = ["editor", "reviewer", "manager"];
const operations = new Set([
  "authoring-create",
  "authoring-copy",
  "review-submit",
  "review-approve",
  "preview-issue",
  "preview-content-read",
  "preview-media-read",
  "publication-preflight",
  "publication-validate",
  "publication-publish",
  "translation-export",
  "translation-import",
  "gift-create",
  "gift-content-save",
  "gift-variant-save",
  "gift-status",
  "price-revision-create",
  "price-book-publish",
  "inventory-adjust",
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export function isOperationsEvidencePath(pathname) {
  return (
    pathname.startsWith("/api/admin/") &&
    operations.has(pathname.slice("/api/admin/".length))
  );
}
function strict(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error("INVALID_COMMAND");
}
export function safeOperationEvidence(role, pathname, status, body) {
  const operation = pathname.slice("/api/admin/".length);
  if (
    !roles.includes(role) ||
    !isOperationsEvidencePath(pathname) ||
    !Number.isInteger(status) ||
    status < 100 ||
    status > 599
  )
    return undefined;
  if (!body || !["SUCCESS", "FAILURE"].includes(body.outcome)) return undefined;
  const ids = Object.fromEntries(
    [
      "resultId",
      "publicationId",
      "giftId",
      "giftRevisionId",
      "giftVariantId",
      "previewId",
    ].flatMap((key) =>
      typeof body[key] === "string" && uuid.test(body[key])
        ? [[key, body[key]]]
        : [],
    ),
  );
  return {
    schemaVersion: 1,
    role,
    operation,
    status,
    outcome: body.outcome,
    ...ids,
  };
}
export function createOperationsRecorder({
  now = () => performance.now(),
  utc = () => new Date().toISOString(),
} = {}) {
  const attempts = [];
  let active, started;
  return {
    command(input) {
      if (input?.action === "START") {
        strict(input, [
          "schemaVersion",
          "action",
          "caseId",
          "operatorCode",
          "trained",
          "nonDeveloper",
        ]);
        if (
          input.schemaVersion !== 1 ||
          !Object.hasOwn(OPERATIONS_CASES, input.caseId) ||
          active ||
          input.trained !== true ||
          input.nonDeveloper !== true ||
          !/^[A-Z0-9_-]{1,24}$/u.test(input.operatorCode)
        )
          throw new Error("INVALID_START");
        started = now();
        active = {
          schemaVersion: 1,
          attempt: attempts.length + 1,
          caseId: input.caseId,
          operatorCode: input.operatorCode,
          trained: true,
          nonDeveloper: true,
          startedAt: utc(),
          status: "IN_PROGRESS",
          humanVerified: false,
          evidence: [],
        };
        attempts.push(active);
      } else if (input?.action === "FINISH") {
        strict(input, [
          "schemaVersion",
          "action",
          "caseId",
          "result",
          "assistance",
        ]);
        if (
          input.schemaVersion !== 1 ||
          !active ||
          input.caseId !== active.caseId ||
          !["REPORTED_COMPLETE", "BLOCKED"].includes(input.result) ||
          !["NONE", "INDEPENDENT_REVIEW", "COACHING"].includes(input.assistance)
        )
          throw new Error("INVALID_FINISH");
        const durationMs = Math.max(0, Math.round(now() - started));
        Object.assign(active, {
          endedAt: utc(),
          durationMs,
          reportedWithinBudget: durationMs <= OPERATIONS_CASES[active.caseId],
          result: input.result,
          assistance: input.assistance,
          status: "AWAITING_HUMAN_REVIEW",
        });
        active = undefined;
      } else throw new Error("INVALID_COMMAND");
      return this.snapshot();
    },
    record(event) {
      if (!active) return;
      const parsed = safeOperationEvidence(
        event.role,
        `/api/admin/${event.operation}`,
        event.status,
        event,
      );
      if (parsed) active.evidence.push({ ...parsed, receivedAt: utc() });
    },
    snapshot() {
      return globalThis.structuredClone({
        schemaVersion: 1,
        environment: "LOCAL_TEST_ONLY",
        humanOperationsAcceptance: false,
        attempts,
      });
    },
  };
}
/** Local file preparation only. Preserves the exported receipt metadata; actual API import revalidates it. */
export function bindOperationsTranslations(input, kind) {
  const packet = translationTransferPackageSchema.parse(input);
  if (
    !["gift", "idol"].includes(kind) ||
    packet.target.owner.kind !== kind.toUpperCase() ||
    JSON.stringify(packet.entries.map(({ locale }) => locale)) !==
      JSON.stringify(SUPPORTED_LOCALES)
  )
    throw new Error("PACKAGE_SCOPE_MISMATCH");
  const ids =
    kind === "gift"
      ? packet.english.text.fields.variantLabels.map((row) => row.giftVariantId)
      : [];
  if (kind === "gift" && ids.length !== 1)
    throw new Error("ONE_VARIANT_REQUIRED");
  const english = operationsText(kind, "en", ids);
  if (JSON.stringify(packet.english.text) !== JSON.stringify(english))
    throw new Error("ENGLISH_MISMATCH");
  const bound = translationTransferPackageSchema.parse({
    ...packet,
    entries: packet.entries.map(({ locale }) => ({
      locale,
      text: operationsText(kind, locale, ids),
    })),
  });
  if (JSON.stringify(bound.entries) === JSON.stringify(packet.entries))
    throw new Error("NO_TRANSLATION_CHANGE");
  return bound;
}
