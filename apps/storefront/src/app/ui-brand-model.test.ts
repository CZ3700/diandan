import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { brandCopyForLocale } from "./ui-brand-copy";
import {
  addBrandGift,
  BRAND_ARTISTS,
  BRAND_GIFTS,
  createBrandState,
  parseBrandState,
  selectBrandArtist,
  visibleBrandGifts,
} from "./ui-brand-model";

describe("P2-06 brand specimen state", () => {
  it("preserves the recipient attached to a gift when another artist is selected", () => {
    const initial = createBrandState();
    const added = addBrandGift(initial, "rose-palace");
    const switched = selectBrandArtist(added, "mira-vale");
    expect(switched.artistId).toBe("mira-vale");
    expect(switched.lines).toEqual([
      { artistId: initial.artistId, giftId: "rose-palace", quantity: 1 },
    ]);
    expect(initial.lines).toEqual([]);
  });

  it("merges only the same gift for the same artist, with a bounded preview quantity", () => {
    let state = createBrandState();
    for (let i = 0; i < 8; i++) state = addBrandGift(state, "rose-palace");
    expect(state.lines[0]?.quantity).toBe(5);
    state = addBrandGift(selectBrandArtist(state, "mira-vale"), "rose-palace");
    expect(state.lines).toHaveLength(2);
    expect(state.lines[1]?.quantity).toBe(1);
  });

  it("does not accept unknown artist or gift identifiers", () => {
    expect(() => selectBrandArtist(createBrandState(), "unknown")).toThrow();
    expect(() => addBrandGift(createBrandState(), "unknown")).toThrow();
  });

  it("round-trips locale-navigation state without accepting prices or private content", () => {
    const state = addBrandGift(createBrandState(), "ruby-bouquet");
    expect(parseBrandState(JSON.stringify(state))).toEqual(state);
    expect(
      parseBrandState(
        JSON.stringify({ ...state, price: 1, message: "private" }),
      ),
    ).toEqual(createBrandState());
    expect(
      parseBrandState(
        JSON.stringify({
          ...state,
          lines: [{ ...state.lines[0], quantity: -1 }],
        }),
      ),
    ).toEqual(createBrandState());
    expect(parseBrandState('{"schemaVersion":2}')).toEqual(createBrandState());
    expect(parseBrandState("{")).toEqual(createBrandState());
  });

  it("filters original-color artwork without changing recipient or cart state", () => {
    const state = addBrandGift(createBrandState(), "blue-orbit");
    expect(visibleBrandGifts("dream")).toHaveLength(3);
    expect(visibleBrandGifts("all")).toHaveLength(6);
    expect(state.lines).toHaveLength(1);
    expect(new Set(BRAND_ARTISTS.map((a) => a.id)).size).toBe(
      BRAND_ARTISTS.length,
    );
    expect(new Set(BRAND_GIFTS.map((g) => g.id)).size).toBe(BRAND_GIFTS.length);
  });
});

describe("brand review copy", () => {
  it("covers all seven locales and expanded pseudo copy with identical keys", () => {
    const english = brandCopyForLocale("en");
    for (const locale of [...SUPPORTED_LOCALES, "en-XA"] as const) {
      const copy = brandCopyForLocale(locale);
      expect(Object.keys(copy).sort()).toEqual(Object.keys(english).sort());
      expect(copy.giftNames).toHaveLength(BRAND_GIFTS.length);
      expect(copy.categories).toHaveLength(4);
      expect(copy.heroTitle.trim()).not.toBe("");
    }
    expect(brandCopyForLocale("en-XA").heroTitle.length).toBeGreaterThan(
      english.heroTitle.length,
    );
  });
});
