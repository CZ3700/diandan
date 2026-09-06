import { expect, test } from "vitest";

const modulePath = "./translation-transfer.js";
test("export packages keep source context while permitting a missing target and reject injected approval", async () => {
  const exports = await import(modulePath).catch(() => ({}));
  expect(exports.translationTransferPackageSchema).toBeDefined();
  const text = {
    kind: "POLICY",
    fields: { title: "Terms", summary: "Summary", body: "<p>Terms</p>" },
  };
  const packet = {
    schemaVersion: 1,
    packageId: "10000000-0000-4000-8000-000000000001",
    target: {
      owner: { kind: "POLICY", policyKey: "terms" },
      revisionId: "10000000-0000-4000-8000-000000000002",
    },
    authoringHeadVersion: 1,
    sourceSnapshotHash: "a".repeat(64),
    english: { sourceHash: "b".repeat(64), text },
    entries: [{ locale: "ja", text: null }],
    constraints: [],
    exportedAt: "2026-09-07T00:00:00.000000Z",
  };
  expect(
    exports.translationTransferPackageSchema.safeParse(packet).success,
  ).toBe(true);
  expect(
    exports.translationTransferPackageSchema.safeParse({
      ...packet,
      entries: [{ locale: "ja", text, review: { status: "APPROVED" } }],
    }).success,
  ).toBe(false);
  expect(
    exports.translationTransferCommandSchema.safeParse({
      schemaVersion: 1,
      action: "IMPORT",
      package: packet,
      reasonCode: "CONTENT_IMPORT",
      idempotencyKey: "translation-import-fixture",
    }).success,
  ).toBe(false);
});
