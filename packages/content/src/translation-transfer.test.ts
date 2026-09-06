import { expect, test } from "vitest";
import {
  publicationPreflightFixture,
  preflightFixtureId,
} from "./publication-preflight-fixtures.js";
import {
  buildTranslationTransferPackage,
  prepareTranslationImport,
} from "./translation-transfer.js";
const path = "./translation-transfer.js";
test("an edited export imports only fresh DRAFT rows and rejects altered immutable metadata", async () => {
  const module = await import(path).catch(() => ({}));
  expect(module.buildTranslationTransferPackage).toBeDefined();
  const { snapshot } = publicationPreflightFixture("POLICY");
  const receipt = {
    schemaVersion: 1,
    id: preflightFixtureId(800),
    target: { owner: snapshot.target, revisionId: snapshot.revisionId },
    authoringHeadVersion: snapshot.headVersion,
    sourceSnapshotHash: snapshot.contentHash,
    englishSourceHash: snapshot.translationAudits.find(
      (row) => row.locale === "en",
    )!.sourceHash,
    locales: ["ja"],
    actorId: preflightFixtureId(801),
    sessionId: preflightFixtureId(802),
    createdAt: "2026-09-07T00:00:00.000000Z",
  };
  const packet = module.buildTranslationTransferPackage(snapshot, receipt);
  packet.entries[0].text.fields.title = "新しい利用条件";
  const command = module.prepareTranslationImport(
    packet,
    snapshot,
    receipt,
    preflightFixtureId(803),
    { reasonCode: "CONTENT_IMPORT", idempotencyKey: "import-fixture-001" },
  );
  expect(command.changes.translations[0].origin).toBe("IMPORT");
  expect(command.changes.translations[0].importBatchId).toBe(
    preflightFixtureId(803),
  );
  expect(command.changes.translations[0]).not.toHaveProperty("review");
  expect(() =>
    module.prepareTranslationImport(
      { ...packet, authoringHeadVersion: 99 },
      snapshot,
      receipt,
      preflightFixtureId(803),
      { reasonCode: "CONTENT_IMPORT", idempotencyKey: "import-fixture-001" },
    ),
  ).toThrow();
});
test("importing English and Japanese together validates variables against the newly supplied English", () => {
  const { snapshot } = publicationPreflightFixture("POLICY");
  const receipt = {
    schemaVersion: 1 as const,
    id: preflightFixtureId(800),
    target: { owner: snapshot.target, revisionId: snapshot.revisionId },
    authoringHeadVersion: snapshot.headVersion,
    sourceSnapshotHash: snapshot.contentHash,
    englishSourceHash: snapshot.translationAudits.find(
      (row) => row.locale === "en",
    )!.sourceHash,
    locales: ["en", "ja"] as const,
    actorId: preflightFixtureId(801),
    sessionId: preflightFixtureId(802),
    createdAt: "2026-09-07T00:00:00.000000Z",
  };
  const packet = buildTranslationTransferPackage(snapshot, {
    ...receipt,
    locales: [...receipt.locales],
  });
  for (const row of packet.entries) {
    if (row.text?.kind !== "POLICY") throw new Error("fixture");
    row.text.fields.body = "<p>Hello {name}</p>";
  }
  expect(() =>
    prepareTranslationImport(
      packet,
      snapshot,
      { ...receipt, locales: [...receipt.locales] },
      preflightFixtureId(803),
      { reasonCode: "CONTENT_IMPORT", idempotencyKey: "import-fixture-002" },
    ),
  ).not.toThrow();
});

test.each(["IDOL", "GIFT", "HOMEPAGE", "POLICY", "MEDIA_METADATA"] as const)(
  "%s packages preserve explicit text and create IMPORT DRAFTs",
  async (kind) => {
    const { translationExportReceiptSchema, idempotencyKeySchema } =
      await import("@fan-support/contracts");
    const { prepareContentAuthoring } = await import("./content-authoring.js");
    const { snapshot } = publicationPreflightFixture(kind);
    const receipt = translationExportReceiptSchema.parse({
      schemaVersion: 1,
      id: preflightFixtureId(800),
      target: { owner: snapshot.target, revisionId: snapshot.revisionId },
      authoringHeadVersion: snapshot.headVersion,
      sourceSnapshotHash: snapshot.contentHash,
      englishSourceHash: snapshot.translationAudits.find(
        (row) => row.locale === "en",
      )!.sourceHash,
      locales: ["ja"],
      actorId: preflightFixtureId(801),
      sessionId: preflightFixtureId(802),
      createdAt: "2026-09-07T00:00:00.000000Z",
    });
    const packet = buildTranslationTransferPackage(snapshot, receipt);
    expect(packet.constraints.length).toBeGreaterThan(0);
    expect(packet.entries[0]?.text?.fields).toEqual(
      snapshot.content.translations.find((row) => row.locale === "ja")?.fields,
    );
    const command = prepareTranslationImport(
      packet,
      snapshot,
      receipt,
      preflightFixtureId(803),
      {
        reasonCode: "CONTENT_IMPORT",
        idempotencyKey: idempotencyKeySchema.parse("import-kind-fixture"),
      },
    );
    const plan = prepareContentAuthoring(command, snapshot, {
      actorId: receipt.actorId,
      createdAt: receipt.createdAt,
    });
    const audit = plan.translationAudits.find((row) => row.locale === "ja");
    expect(audit?.origin).toBe("IMPORT");
    expect(audit?.review).toEqual({ status: "DRAFT" });
    expect(audit?.editorId).toBe(receipt.actorId);
    expect(audit?.inheritedFrom).toBeUndefined();
    const incomplete = structuredClone(packet);
    incomplete.entries[0]!.text = null;
    expect(() =>
      prepareTranslationImport(
        incomplete,
        snapshot,
        receipt,
        preflightFixtureId(803),
        {
          reasonCode: "CONTENT_IMPORT",
          idempotencyKey: idempotencyKeySchema.parse("import-missing-row"),
        },
      ),
    ).toThrow();
  },
);
