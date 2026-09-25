import { expect, test, vi } from "vitest";
import {
  publishedContentContextSchema,
  contentPublicationIdSchema,
  type PublishedContentContext,
} from "@fan-support/contracts";
import {
  buildPublicationManifest,
  computePublicationManifestHash,
  computeContentAuthoringSnapshotHash,
} from "@fan-support/content";
import type {
  PublishedContentRepository,
  PublishedContentTransactionManager,
} from "@fan-support/persistence-port";
import { policyPreflightFixture } from "./publication-preflight-fixtures.js";
import { createPublishedContentUseCases } from "./published-content.js";
function fixture(): PublishedContentContext {
  const canonical = policyPreflightFixture();
  canonical.headVersion = 1;
  const publicationId = "84000000-0000-4000-8000-000000000001";
  const lifecycle = {
    status: "PUBLISHED" as const,
    validatedAt: "2026-09-06T08:30:00Z",
    publishedAt: "2026-09-06T08:45:00Z",
  };
  canonical.snapshot.lifecycle = lifecycle;
  if (canonical.candidate.objectKind === "POLICY") {
    canonical.candidate.revision.lifecycle = lifecycle;
    canonical.candidate.currentPublishedRevisionId =
      canonical.candidate.revision.id;
    canonical.candidate.currentPublication = {
      schemaVersion: 1,
      objectKind: "POLICY",
      id: contentPublicationIdSchema.parse(publicationId),
      action: "PUBLISH",
      policyKey: canonical.candidate.revision.policyKey,
      targetRevisionId: canonical.candidate.revision.id,
    };
  }
  const manifest = buildPublicationManifest(canonical);
  return publishedContentContextSchema.parse({
    schemaVersion: 1,
    locale: "ja",
    publication: {
      schemaVersion: 1,
      publicationId,
      target: canonical.target,
      action: "PUBLISH",
      publishedAt: lifecycle.publishedAt,
      headVersion: 1,
      manifestHash: computePublicationManifestHash(manifest),
      manifest,
    },
    canonical: {
      ...canonical,
      snapshot: {
        ...canonical.snapshot,
        contentHash: computeContentAuthoringSnapshotHash(canonical.snapshot),
      },
    },
    media: [],
  });
}
function harness() {
  const context = fixture();
  const load = vi.fn<PublishedContentRepository["load"]>(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    context,
  }));
  const transactions: PublishedContentTransactionManager = {
    runInPublishedContentTransaction: async (work) =>
      work({ publishedContent: { load } }),
  };
  return {
    context,
    load,
    useCases: createPublishedContentUseCases({ transactions }),
  };
}
const query = {
  schemaVersion: 1,
  locator: { kind: "POLICY", policyKey: "privacy" },
  locale: "ja",
};
test("current public read returns only the requested locale DTO and immutable publication reference", async () => {
  const h = harness();
  const result = await h.useCases.execute(query);
  expect(result).toMatchObject({
    outcome: "SUCCESS",
    content: {
      kind: "POLICY",
      view: { localeContext: { requestedLocale: "ja" } },
    },
  });
  expect(JSON.stringify(result)).not.toMatch(
    /reviewerId|manifest"|approvalId|createdBy|sourceHash/u,
  );
});
test("invalid query does not read the database", async () => {
  const h = harness();
  expect(await h.useCases.execute({ ...query, currency: "USD" })).toMatchObject(
    { code: "INVALID_QUERY" },
  );
  expect(h.load).not.toHaveBeenCalled();
});
test("a repository cannot substitute another locator or locale", async () => {
  const h = harness();
  expect(await h.useCases.execute({ ...query, locale: "th" })).toMatchObject({
    code: "CONTENT_UNAVAILABLE",
  });
  expect(
    await h.useCases.execute({
      ...query,
      locator: { kind: "POLICY", policyKey: "terms" },
    }),
  ).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
});
test("missing immutable proof or unavailable database fails safely", async () => {
  const h = harness();
  h.context.publication.manifestHash = "b".repeat(
    64,
  ) as typeof h.context.publication.manifestHash;
  expect(await h.useCases.execute(query)).toMatchObject({
    code: "CONTENT_UNAVAILABLE",
  });
  h.load.mockRejectedValue(new Error("private database text"));
  expect(await h.useCases.execute(query)).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  });
});
