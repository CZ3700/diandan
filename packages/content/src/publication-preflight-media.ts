import {
  MEDIA_FRAMING_MASTER_SIZES,
  type MediaAsset,
  type PublicationPreflightContext,
  type PublicationPreflightIssue,
} from "@fan-support/contracts";
import {
  hashMediaProcessingCommand,
  mediaProcessingObjectKey,
} from "./media-processing.js";

type Input = Pick<PublicationPreflightContext, "candidate" | "mediaLineage">;
type Lineage = PublicationPreflightContext["mediaLineage"][number];
type Processing = Lineage["processing"][number];
const sameId = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();
const issue = (
  code: PublicationPreflightIssue["code"],
  path: PublicationPreflightIssue["path"],
): PublicationPreflightIssue => ({ code, severity: "BLOCKER", path });

function candidateAssets(candidate: Input["candidate"]): readonly MediaAsset[] {
  if (candidate.objectKind === "POLICY") return [];
  return candidate.objectKind === "MEDIA_METADATA"
    ? [candidate.asset]
    : candidate.mediaAssets;
}

function processingMatches(asset: MediaAsset, proof: Processing): boolean {
  const { sourceAsset: source, command, output } = proof;
  const original = command.source;
  const dimensions = MEDIA_FRAMING_MASTER_SIZES[command.role];
  return (
    proof.status === "SUCCEEDED" &&
    proof.sourceIdentityKind === "SOURCE" &&
    !sameId(source.id, asset.id) &&
    sameId(original.assetId, source.id) &&
    original.checksumSha256 === source.checksumSha256 &&
    original.objectKey === source.objectKey &&
    original.mimeType === source.mimeType &&
    original.byteSize === source.byteSize &&
    original.width === source.width &&
    original.height === source.height &&
    proof.commandHash === hashMediaProcessingCommand(command) &&
    sameId(proof.outputAssetId, asset.id) &&
    sameId(output.mediaAssetId, asset.id) &&
    output.checksumSha256 === asset.checksumSha256 &&
    output.objectKey === asset.objectKey &&
    output.width === asset.width &&
    output.height === asset.height &&
    output.byteSize === asset.byteSize &&
    asset.width === dimensions.width &&
    asset.height === dimensions.height &&
    asset.mimeType === "image/png" &&
    asset.objectKey === mediaProcessingObjectKey(asset.checksumSha256, "PNG")
  );
}

function validateAssetLineage(
  asset: MediaAsset,
  lineage: Lineage,
  index: number,
): PublicationPreflightIssue[] {
  const path = ["mediaLineage", index];
  if (lineage.identityKind === "SOURCE")
    return lineage.processing.length === 0
      ? []
      : [issue("MEDIA_PROVENANCE_MISMATCH", path)];
  if (lineage.processing.length === 0)
    return [issue("MEDIA_PROVENANCE_MISSING", path)];
  const issues: PublicationPreflightIssue[] = [];
  const jobs = new Set<string>();
  for (const [position, proof] of lineage.processing.entries()) {
    const proofPath = [...path, "processing", position];
    if (jobs.has(proof.jobId.toLowerCase()) || !processingMatches(asset, proof))
      issues.push(issue("MEDIA_PROVENANCE_MISMATCH", proofPath));
    jobs.add(proof.jobId.toLowerCase());
    if (
      proof.sourceAsset.rightsStatus !== "APPROVED" ||
      proof.sourceAsset.processingStatus === "ARCHIVED"
    )
      issues.push(
        issue("MEDIA_ORIGINAL_RIGHTS_NOT_APPROVED", [
          ...proofPath,
          "sourceAsset",
        ]),
      );
  }
  return issues;
}

function heroPairs(candidate: Input["candidate"]): readonly {
  desktop: string;
  mobile: string;
  path: PublicationPreflightIssue["path"];
}[] {
  if (candidate.objectKind === "HOMEPAGE")
    return candidate.slots.flatMap((slot, index) =>
      slot.kind === "HERO_IDOL"
        ? [
            {
              desktop: slot.desktopMediaAssetId,
              mobile: slot.mobileMediaAssetId,
              path: ["candidate", "slots", index],
            },
          ]
        : [],
    );
  if (candidate.objectKind !== "IDOL") return [];
  const desktop = candidate.mediaReferences.filter(
    (row) => row.role === "HERO_DESKTOP",
  );
  const mobile = candidate.mediaReferences.filter(
    (row) => row.role === "HERO_MOBILE",
  );
  return desktop.flatMap((left) =>
    mobile.map((right) => ({
      desktop: left.mediaAssetId,
      mobile: right.mediaAssetId,
      path: ["candidate", "mediaReferences"],
    })),
  );
}

function originalIdentities(
  asset: MediaAsset,
  lineage: Lineage,
): ReadonlySet<string> {
  const originals =
    lineage.identityKind === "SOURCE"
      ? [asset]
      : lineage.processing.map((proof) => proof.sourceAsset);
  return new Set(
    originals.flatMap((original) => [
      `id:${original.id.toLowerCase()}`,
      `sha256:${original.checksumSha256}`,
    ]),
  );
}

/** All recorded originals matter, including the less favorable provenance of a shared master. */
export function validatePreflightMediaLineage(
  context: Input,
): PublicationPreflightIssue[] {
  const assets = candidateAssets(context.candidate);
  const issues: PublicationPreflightIssue[] = [];
  const originals = new Map<string, ReadonlySet<string>>();
  const jobOwners = new Map<string, string>();
  for (const [index, lineage] of context.mediaLineage.entries()) {
    if (!assets.some((asset) => sameId(asset.id, lineage.assetId)))
      issues.push(issue("MEDIA_PROVENANCE_MISMATCH", ["mediaLineage", index]));
    for (const [position, proof] of lineage.processing.entries()) {
      const owner = jobOwners.get(proof.jobId.toLowerCase());
      if (owner !== undefined && !sameId(owner, lineage.assetId))
        issues.push(
          issue("MEDIA_PROVENANCE_MISMATCH", [
            "mediaLineage",
            index,
            "processing",
            position,
          ]),
        );
      jobOwners.set(proof.jobId.toLowerCase(), lineage.assetId);
    }
  }
  for (const [index, asset] of assets.entries()) {
    const matches = context.mediaLineage.filter((lineage) =>
      sameId(lineage.assetId, asset.id),
    );
    if (matches.length !== 1) {
      issues.push(
        issue(
          matches.length === 0
            ? "MEDIA_PROVENANCE_MISSING"
            : "MEDIA_PROVENANCE_MISMATCH",
          context.candidate.objectKind === "MEDIA_METADATA"
            ? ["candidate", "asset"]
            : ["candidate", "mediaAssets", index],
        ),
      );
      continue;
    }
    const lineage = matches[0]!;
    issues.push(
      ...validateAssetLineage(
        asset,
        lineage,
        context.mediaLineage.indexOf(lineage),
      ),
    );
    originals.set(asset.id.toLowerCase(), originalIdentities(asset, lineage));
  }
  for (const pair of heroPairs(context.candidate)) {
    const desktop = originals.get(pair.desktop.toLowerCase());
    const mobile = originals.get(pair.mobile.toLowerCase());
    if (
      desktop &&
      mobile &&
      [...desktop].some((identity) => mobile.has(identity))
    )
      issues.push(issue("HERO_ORIGINAL_SOURCE_REUSED", pair.path));
  }
  return issues;
}
