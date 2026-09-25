import { expect, test, vi } from "vitest";
import { hasPublishedMediaProof } from "./published-content-media-proof.js";
const revisionId = "84000000-0000-4000-8000-000000000001",
  mediaAssetId = "84000000-0000-4000-8000-000000000002";
test("public media requires a real typed publication and current proof for v2", async () => {
  const query = vi
    .fn<(...args: [string, unknown[]?]) => Promise<unknown>>()
    .mockResolvedValue({
      rows: [{ revision_id: revisionId, media_asset_id: mediaAssetId }],
    });
  expect(
    await hasPublishedMediaProof({ query }, [{ revisionId, mediaAssetId }]),
  ).toBe(true);
  const sql = query.mock.calls[0]![0];
  expect(sql).toContain("public.content_publications");
  expect(sql).toContain("p.proof_version=1");
  expect(sql).toContain("p.proof_version=2");
  expect(sql).toContain("public.content_publication_manifests");
  expect(sql).toContain("public.content_publication_receipts");
  expect(sql).toContain("proof.media_metadata_revision_id=metadata.id");
  expect(sql).toContain("fan-support.publication-manifest.v1");
});
test.each([
  { rows: [] },
  { rows: [{ revision_id: revisionId, media_asset_id: revisionId }] },
  {
    rows: [
      { revision_id: revisionId, media_asset_id: mediaAssetId },
      { revision_id: revisionId, media_asset_id: mediaAssetId },
    ],
  },
])(
  "missing, cross-bound or duplicate dependency proof is rejected",
  async ({ rows }) => {
    expect(
      await hasPublishedMediaProof(
        { query: vi.fn().mockResolvedValue({ rows }) },
        [{ revisionId, mediaAssetId }],
      ),
    ).toBe(false);
  },
);
