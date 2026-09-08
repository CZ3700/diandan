import { describe, expect, test } from "vitest";
import { rebuildIdolSearchProjections } from "./catalog-search-projection.js";
import { dailyPublicationManifestSchema } from "@fan-support/contracts";
import {
  computeDailySourceHash,
  computeDailyDocumentHash,
} from "@fan-support/content";

function dailyManifest() {
  const fields = {
    displayName: "原文艺人",
    shortBio: "原文简介",
    fullBio: "原文介绍",
    seoTitle: "原文艺人",
    seoDescription: "原文简介",
  };
  const actor = "10000000-0000-4000-8000-000000000010";
  return dailyPublicationManifestSchema.parse({
    schemaVersion: 3,
    publicationMode: "DIRECT_OPERATOR_V1",
    operationId: "10000000-0000-4000-8000-000000000011",
    actorId: actor,
    media: [],
    document: {
      schemaVersion: 3,
      kind: "IDOL",
      ownerId: "10000000-0000-4000-8000-000000000001",
      revisionId: "10000000-0000-4000-8000-000000000002",
      revisionNumber: 1,
      createdBy: actor,
      createdAt: "2026-09-07T00:00:00.000Z",
      source: {
        id: "10000000-0000-4000-8000-000000000003",
        locale: "zh-CN",
        sourceHash: computeDailySourceHash("IDOL", "zh-CN", fields),
        editorId: actor,
        editedAt: "2026-09-07T00:00:00.000Z",
        fields,
      },
      structure: {
        themeAccent: "#123456",
        heroTextTone: "light",
        displayOrder: 0,
      },
      media: [],
    },
  });
}

test("daily publication writes exactly one original search projection and rejects a mismatched source hash", async () => {
  const module = await import("./catalog-search-projection.js");
  const write = module.writePublishedDailyIdolSearchProjection;
  expect(write).toBeTypeOf("function");
  const statements: { text: string; values: unknown[] }[] = [];
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      statements.push({ text, values });
      return { rows: [] };
    },
  };
  const manifest = dailyManifest();
  await write(client, manifest);
  expect(statements).toHaveLength(1);
  expect(statements[0]!.text).toContain(
    "INSERT INTO public.idol_daily_search_projections",
  );
  expect(statements[0]!.text).not.toMatch(
    /APPROVED|idol_revision_translations/u,
  );
  expect(statements[0]!.values).toEqual([
    manifest.document.revisionId,
    manifest.document.source.id,
    manifest.document.source.sourceHash,
    computeDailyDocumentHash(manifest.document),
    "原文艺人",
  ]);
  manifest.document.source.sourceHash = "a".repeat(
    64,
  ) as typeof manifest.document.source.sourceHash;
  await expect(write(client, manifest)).rejects.toThrow(
    "Invalid daily search source",
  );
  expect(statements).toHaveLength(1);
});

test("rebuild keysets daily originals separately and rejects document hash drift without changing source", async () => {
  const document = dailyManifest().document;
  const reads: unknown[][] = [],
    writes: string[] = [];
  let served = false;
  const run = (hash: string) =>
    rebuildIdolSearchProjections({
      query: async (text, values = []) => {
        if (
          text.startsWith("SELECT") &&
          text.includes("FROM public.daily_publication_revisions")
        ) {
          reads.push(values);
          if (served) return { rows: [] };
          served = true;
          return {
            rows: [
              {
                revision_id: document.revisionId,
                document,
                document_hash: hash,
              },
            ],
          };
        }
        if (text.startsWith("SELECT")) return { rows: [] };
        writes.push(text);
        return { rows: [] };
      },
    });
  expect(await run(computeDailyDocumentHash(document))).toEqual({
    schemaVersion: 1,
    processed: 1,
  });
  expect(reads).toEqual([
    [null, 256],
    [document.revisionId, 256],
  ]);
  expect(writes).toHaveLength(1);
  served = false;
  await expect(run("a".repeat(64))).rejects.toThrow(
    "Invalid daily search source",
  );
  expect(writes).toHaveLength(1);
});

describe("catalog search projection rebuild", () => {
  test("rebuilds normalized names with typed source hashes without changing published translations", async () => {
    const writes: { text: string; values: unknown[] }[] = [];
    let reads = 0;
    const result = await rebuildIdolSearchProjections({
      query: async (text, values = []) => {
        if (text.startsWith("SELECT"))
          return {
            rows:
              reads++ === 0
                ? [
                    {
                      id: "10000000-0000-4000-8000-000000000001",
                      source_hash: "a".repeat(64),
                      display_name: " İpek\n Ｖａｌｅ ",
                    },
                  ]
                : [],
          };
        writes.push({ text, values });
        return { rows: [] };
      },
    });
    expect(result).toEqual({ schemaVersion: 1, processed: 1 });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.values).toEqual([
      ["10000000-0000-4000-8000-000000000001"],
      ["a".repeat(64)],
      ["i\u0307pek vale"],
    ]);
    expect(writes[0]!.text).not.toContain(
      "UPDATE public.idol_revision_translations",
    );
  });
  test("rejects malformed sources before updating the projection", async () => {
    let calls = 0;
    await expect(
      rebuildIdolSearchProjections({
        query: async () => {
          calls++;
          return { rows: [{ id: null }] };
        },
      }),
    ).rejects.toThrow("invalid search projection source");
    expect(calls).toBe(1);
  });
});
