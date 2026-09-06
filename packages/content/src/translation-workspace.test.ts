import { expect, test } from "vitest";
import { publicationPreflightFixture } from "./publication-preflight-fixtures.js";
import { computeContentAuthoringSnapshotHash } from "./content-authoring.js";
import { sourceHashSchema } from "@fan-support/contracts";
const path = "./translation-workspace.js";
test("workspace never leaks six unassigned translations and shows a missing selected locale", async () => {
  const module = await import(path).catch(() => ({}));
  expect(module.projectTranslationWorkspace).toBeDefined();
  const { snapshot } = publicationPreflightFixture("IDOL");
  if (snapshot.content.kind !== "IDOL") throw new Error("fixture");
  const result = module.projectTranslationWorkspace(
    { schemaVersion: 1, snapshot, previousEnglish: null, ownerArchived: false },
    { owner: snapshot.target, revisionId: snapshot.revisionId, locale: "ja" },
    { readableLocales: ["ja"], editableLocales: ["ja"] },
  );
  expect(result.outcome).toBe("SUCCESS");
  expect(
    result.cells.filter(
      (cell: { access: string }) => cell.access === "RESTRICTED",
    ),
  ).toHaveLength(6);
  expect(result.selected.content.fields).toEqual(
    snapshot.content.translations.find((row) => row.locale === "ja")?.fields,
  );
  snapshot.content.translations = snapshot.content.translations.filter(
    (row) => row.locale !== "ja",
  );
  snapshot.translationAudits = snapshot.translationAudits.filter(
    (row) => row.locale !== "ja",
  );
  snapshot.contentHash = sourceHashSchema.parse(
    computeContentAuthoringSnapshotHash(snapshot),
  );
  const missing = module.projectTranslationWorkspace(
    { schemaVersion: 1, snapshot, previousEnglish: null, ownerArchived: false },
    { owner: snapshot.target, revisionId: snapshot.revisionId, locale: "ja" },
    { readableLocales: ["ja"], editableLocales: ["ja"] },
  );
  expect(missing.selected).toBeNull();
  expect(missing.cells[4].status).toBe("MISSING");
});
