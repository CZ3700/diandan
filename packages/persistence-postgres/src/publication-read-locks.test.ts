import { expect, test, vi } from "vitest";
import { contentAuthoringTargetSchema } from "@fan-support/contracts";
import {
  lockAuthoringOwner,
  loadAuthoringSnapshot,
} from "./content-authoring-data.js";
import { createPublicationPreflightRepository } from "./publication-preflight-repository.js";
import { loadPreflightCopies } from "./publication-preflight-evidence.js";
import type { TransactionScopeControl } from "./transaction-runner.js";

const id = "91000000-0000-4000-8000-000000000001";
const idol = contentAuthoringTargetSchema.parse({ kind: "IDOL", idolId: id });
const media = contentAuthoringTargetSchema.parse({
  kind: "MEDIA_METADATA",
  mediaAssetId: id,
});
const scope = {
  trackOperation: <T>(work: () => Promise<T>) => work(),
} as TransactionScopeControl;
function concurrentReader() {
  return {
    release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      // Model an already acquired shared proof: a lock upgrade is incompatible.
      if (/FOR UPDATE|pg_advisory_xact_lock\(/u.test(sql))
        throw { code: "40P01" };
      return { rows: sql.includes("max(revision)") ? [{ version: "0" }] : [] };
    }),
  };
}
test("a public preflight does not upgrade the shared homepage proof to exclusive authoring locks", async () => {
  await expect(
    createPublicationPreflightRepository(
      concurrentReader(),
      scope,
      "SHARE",
    ).load({
      schemaVersion: 1,
      action: "PUBLISH",
      target: { owner: { kind: "HOMEPAGE" }, revisionId: id },
    }),
  ).resolves.toMatchObject({ outcome: "FAILURE", code: "NOT_FOUND" });
});
test("public owner and metadata snapshot reads coexist with another shared proof", async () => {
  const client = concurrentReader();
  await expect(
    lockAuthoringOwner(client, idol, "SHARE"),
  ).resolves.toBeUndefined();
  await expect(
    loadAuthoringSnapshot(client, media, id, 1, "SHARE"),
  ).resolves.toBeUndefined();
});
test("the authoring default retains the exclusive owner and snapshot locks", async () => {
  await expect(
    lockAuthoringOwner(concurrentReader(), idol),
  ).rejects.toMatchObject({ code: "40P01" });
  await expect(
    loadAuthoringSnapshot(concurrentReader(), media, id, 1),
  ).rejects.toMatchObject({ code: "40P01" });
});
test("inherited publication proofs also use shared locks when reading the original revision", async () => {
  const client = concurrentReader();
  client.query.mockResolvedValueOnce({
    rows: [{ evidence: {}, source_revision_id: id }],
  } as never);
  await expect(
    loadPreflightCopies(
      client,
      [{ target: media, revisionId: id }] as never,
      "SHARE",
    ),
  ).rejects.toThrow("Missing canonical copy source");
});
