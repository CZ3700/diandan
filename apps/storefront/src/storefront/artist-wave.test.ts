import { expect, it } from "vitest";

const loaded = await import("./artist-wave").catch(() => undefined);

// L2-15: on touch screens the leftmost whole card leads the wave (user decision, 2026-09-30).
it("leads with the leftmost card whose start is inside the scrolled view", () => {
  expect(loaded).toBeDefined();
  const { leadingArtistIndex } = loaded!;
  const starts = [12, 200, 388, 576];
  expect(leadingArtistIndex(0, [])).toBeNull();
  expect(leadingArtistIndex(0, starts)).toBe(0);
  // The first card is cut on the left, so the next whole card leads.
  expect(leadingArtistIndex(100, starts)).toBe(1);
  // A snapped card sits one scroll margin inside the view.
  expect(leadingArtistIndex(188, starts)).toBe(1);
  // Sub-pixel scroll positions do not skip a card that is visually whole.
  expect(leadingArtistIndex(200.6, starts)).toBe(1);
  expect(leadingArtistIndex(201.5, starts)).toBe(2);
  // Past every start (the track's far end), the last card leads.
  expect(leadingArtistIndex(900, starts)).toBe(3);
});

it("places each card in the wave: the peak, its two neighbours, and the rest at rest", () => {
  expect(loaded).toBeDefined();
  const { artistWave } = loaded!;
  expect([0, 1, 2].map((index) => artistWave(index, null))).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
  expect([0, 1, 2, 3, 4].map((index) => artistWave(index, 2))).toEqual([
    undefined,
    "near",
    "peak",
    "near",
    undefined,
  ]);
  expect(artistWave(1, 0)).toBe("near");
});
