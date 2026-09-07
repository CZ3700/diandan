import { describe, expect, it } from "vitest";
import { idolIdSchema } from "@fan-support/contracts";
import { directoryFixturePage as page } from "./directory-fixture";

async function model() {
  const loaded = await import("./directory-model").catch(() => undefined);
  expect(
    loaded,
    "directory model must implement bounded browse transitions",
  ).toBeDefined();
  return loaded!;
}

describe("artist directory transitions", () => {
  it("appends real pages and preserves prior items while a retry is pending", async () => {
    const m = await model();
    const initial = m.createDirectoryState(page([1, 2], "a", true));
    const loading = m.directoryReducer(initial, {
      type: "begin",
      request: 1,
      mode: "append",
    });
    const failed = m.directoryReducer(loading, {
      type: "receive",
      request: 1,
      response: {
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CATALOG_UNAVAILABLE",
      },
    });
    expect(failed.items.map((item) => item.handle)).toEqual([
      "fictional-1",
      "fictional-2",
    ]);
    expect(failed.error).toBe("CATALOG_UNAVAILABLE");
    const retry = m.directoryReducer(failed, {
      type: "begin",
      request: 2,
      mode: "append",
    });
    const result = m.directoryReducer(retry, {
      type: "receive",
      request: 2,
      response: page([3]),
    });
    expect(result.items.map((item) => item.handle)).toEqual([
      "fictional-1",
      "fictional-2",
      "fictional-3",
    ]);
    expect(result.hasNextPage).toBe(false);
  });

  it("ignores a late append after an anchor selection and rejects mixed snapshots", async () => {
    const m = await model();
    let state = m.createDirectoryState(page([1], "a", true));
    state = m.directoryReducer(state, {
      type: "begin",
      request: 1,
      mode: "append",
    });
    state = m.directoryReducer(state, {
      type: "begin",
      request: 2,
      mode: "replace",
      anchor: idolIdSchema.parse("a0000000-0000-4000-8000-000000000100"),
    });
    expect(
      m.directoryReducer(state, {
        type: "receive",
        request: 1,
        response: page([2]),
      }),
    ).toBe(state);
    state = m.directoryReducer(state, {
      type: "receive",
      request: 2,
      response: page([100], "b", true),
    });
    expect(state.items[0]?.handle).toBe("fictional-100");
    expect(state.anchor).toBe("a0000000-0000-4000-8000-000000000100");
    state = m.directoryReducer(state, {
      type: "begin",
      request: 3,
      mode: "append",
    });
    state = m.directoryReducer(state, {
      type: "receive",
      request: 3,
      response: page([101], "c"),
    });
    expect(state.error).toBe("CATALOG_CHANGED");
    expect(state.items).toHaveLength(1);
  });

  it("rejects duplicate cards and a successful anchor response missing the target", async () => {
    const m = await model();
    let state = m.directoryReducer(
      m.createDirectoryState(page([1], "a", true)),
      { type: "begin", request: 1, mode: "append" },
    );
    state = m.directoryReducer(state, {
      type: "receive",
      request: 1,
      response: page([1, 2]),
    });
    expect(state.error).toBe("CATALOG_UNAVAILABLE");
    expect(state.items).toHaveLength(1);
    state = m.directoryReducer(state, {
      type: "begin",
      request: 2,
      mode: "replace",
      anchor: idolIdSchema.parse("a0000000-0000-4000-8000-000000000100"),
    });
    state = m.directoryReducer(state, {
      type: "receive",
      request: 2,
      response: page([2]),
    });
    expect(state.error).toBe("ANCHOR_NOT_FOUND");
    expect(state.items[0]?.handle).toBe("fictional-1");
  });

  it("validates Unicode search without altering valid names and defers IME composition", async () => {
    const m = await import("./directory-validation");
    expect(m.prepareArtistSearch("  日本の芸人  ", false)).toEqual({
      kind: "query",
      q: "日本の芸人",
    });
    expect(m.prepareArtistSearch("日本", true)).toEqual({ kind: "idle" });
    expect(m.prepareArtistSearch(" ", false)).toEqual({ kind: "idle" });
    expect(m.prepareArtistSearch("a".repeat(81), false)).toEqual({
      kind: "invalid",
    });
    expect(m.prepareArtistSearch("a\u200fb", false)).toEqual({
      kind: "invalid",
    });
    expect(m.prepareArtistSearch("Điện", false)).toEqual({
      kind: "query",
      q: "Điện",
    });
  });

  it("preserves unrelated presentation and commercial URL context when locating", async () => {
    const m = await model();
    expect(
      m.directoryAnchorHref(
        "https://store.invalid/ja/idols?market=TEST&currency=JPY&gift=keepsake&q=old&after=stale#artists",
        idolIdSchema.parse("a0000000-0000-4000-8000-000000000100"),
      ),
    ).toBe(
      "/ja/idols?market=TEST&currency=JPY&gift=keepsake&anchorId=a0000000-0000-4000-8000-000000000100#artists",
    );
    expect(
      m.directoryAnchorHref(
        "https://store.invalid/en?market=TEST&anchorId=a0000000-0000-4000-8000-000000000100",
        undefined,
      ),
    ).toBe("/en?market=TEST");
  });
});

it("recipient search only permits artists who currently receive gifts", async () => {
  const imported = await import("./directory-model");
  const select = (imported as unknown as Record<string, unknown>)[
    "canSelectSearchArtist"
  ];
  expect(typeof select).toBe("function");
  if (typeof select !== "function") return;
  expect(select({ status: "active", acceptingGifts: true }, true)).toBe(true);
  expect(select({ status: "active", acceptingGifts: false }, true)).toBe(false);
  expect(select({ status: "paused", acceptingGifts: false }, true)).toBe(false);
  expect(select({ status: "paused", acceptingGifts: false }, false)).toBe(true);
});
