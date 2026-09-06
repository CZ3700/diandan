import { expect, it } from "vitest";
import {
  contentAuthoringSnapshotSchema,
  contentAuthoringPlanSchema,
} from "@fan-support/contracts";
import { contentAuthoringChangedPaths } from "./content-authoring-diff.js";

it("records an explicit Unicode spelling change without storing authored text", () => {
  const time = "2026-01-01T00:00:00.000Z",
    id = "71000000-0000-4000-8000-000000000001";
  const source = contentAuthoringSnapshotSchema.parse({
    schemaVersion: 1,
    target: { kind: "POLICY", policyKey: "fixture" },
    revisionId: id,
    revisionNumber: 1,
    headVersion: 1,
    lifecycle: { status: "DRAFT" },
    createdBy: id,
    createdAt: time,
    contentHash: "0".repeat(64),
    content: {
      kind: "POLICY",
      structure: { kind: "DELIVERY", effectiveAt: time },
      translations: [
        {
          locale: "en",
          origin: "HUMAN",
          fields: {
            title: "Cafe\u0301",
            summary: "A test policy.",
            body: "<p>Test only.</p>",
          },
        },
      ],
    },
    translationAudits: [
      {
        id,
        reviewId: id,
        reviewSequence: 1,
        locale: "en",
        origin: "HUMAN",
        editorId: id,
        editedAt: time,
        sourceHash: "0".repeat(64),
        translatedFromSourceHash: "0".repeat(64),
        review: { status: "DRAFT" },
      },
    ],
    extensions: {},
  });
  const {
    id: translationId,
    reviewId,
    reviewSequence,
    ...audit
  } = source.translationAudits[0]!;
  void translationId;
  void reviewId;
  void reviewSequence;
  const plan = contentAuthoringPlanSchema.parse({
    schemaVersion: 1,
    content: {
      ...source.content,
      translations: [
        {
          ...source.content.translations[0],
          fields: { ...source.content.translations[0]!.fields, title: "Café" },
        },
      ],
    },
    translationAudits: [audit],
  });
  expect(contentAuthoringChangedPaths(plan, source)).toEqual([
    "translations.en.title",
  ]);
});
