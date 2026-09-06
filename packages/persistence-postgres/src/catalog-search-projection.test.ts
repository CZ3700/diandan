import { describe, expect, test } from "vitest";
import { rebuildIdolSearchProjections } from "./catalog-search-projection.js";

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
