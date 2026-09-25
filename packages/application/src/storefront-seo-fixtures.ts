// Package-local fictional proof fixture; not exported by the runtime package.
import {
  publishedContentContextSchema,
  contentPublicationIdSchema,
} from "@fan-support/contracts";
import {
  buildPublicationManifest,
  computePublicationManifestHash,
  computeContentAuthoringSnapshotHash,
} from "@fan-support/content";
import { policyPreflightFixture } from "./publication-preflight-fixtures.js";

export function storefrontSeoPolicyFixture() {
  const context = policyPreflightFixture();
  const candidate = context.candidate;
  if (candidate.objectKind !== "POLICY") throw new Error("fixture");
  const id = contentPublicationIdSchema.parse(
    "87000000-0000-4000-8000-000000000900",
  );
  const lifecycle = {
    status: "PUBLISHED",
    validatedAt: context.evaluatedAt,
    publishedAt: context.evaluatedAt,
  } as const;
  context.snapshot.lifecycle = lifecycle;
  context.snapshot.contentHash = computeContentAuthoringSnapshotHash(
    context.snapshot,
  ) as typeof context.snapshot.contentHash;
  candidate.revision.lifecycle = lifecycle;
  candidate.currentPublication = {
    schemaVersion: 1,
    id,
    objectKind: "POLICY",
    policyKey: "privacy",
    action: "PUBLISH",
    targetRevisionId: candidate.revision.id,
  };
  candidate.currentPublishedRevisionId = candidate.revision.id;
  context.headVersion = 1;
  const manifest = buildPublicationManifest(context);
  return publishedContentContextSchema.parse({
    schemaVersion: 1,
    locale: "en",
    canonical: context,
    publication: {
      schemaVersion: 1,
      publicationId: id,
      target: context.target,
      action: "PUBLISH",
      publishedAt: context.evaluatedAt,
      headVersion: 1,
      manifest,
      manifestHash: computePublicationManifestHash(manifest),
    },
    media: [],
  });
}
