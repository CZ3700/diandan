export const BRAND_CATEGORIES = [
  "all",
  "dream",
  "flowers",
  "everyday",
] as const;
export type BrandCategory = (typeof BRAND_CATEGORIES)[number];

export const BRAND_ARTISTS = [
  {
    id: "kai-ren",
    name: "Kai Ren",
    image: "/ui-brand/performer-daylight-mobile.webp",
    width: 1122,
    height: 1402,
  },
  {
    id: "mira-vale",
    name: "Mira Vale",
    image: "/ui-composites/fictional-performer-hero-mobile.png",
    width: 1122,
    height: 1402,
  },
  {
    id: "noa-aster",
    name: "Noa Aster",
    image: "/ui-motion/fictional-performer-noa-aster.webp",
    width: 1122,
    height: 1402,
  },
] as const;

export const BRAND_GIFTS = [
  {
    id: "rose-palace",
    category: "dream",
    image: "/ui-brand/gift-rose-palace.webp",
    size: 1254,
    amountMinor: 18000,
  },
  {
    id: "blue-orbit",
    category: "dream",
    image: "/ui-brand/gift-blue-orbit.webp",
    size: 1254,
    amountMinor: 12800,
  },
  {
    id: "golden-hour",
    category: "dream",
    image: "/ui-brand/gift-golden-hour.webp",
    size: 1254,
    amountMinor: 26800,
  },
  {
    id: "ruby-bouquet",
    category: "flowers",
    image: "/ui-brand/gift-ruby-bouquet.webp",
    size: 1024,
    amountMinor: 8800,
  },
  {
    id: "seasonal-table",
    category: "everyday",
    image: "/ui-brand/gift-seasonal-table.webp",
    size: 1024,
    amountMinor: 6800,
  },
  {
    id: "keepsake",
    category: "everyday",
    image: "/ui-composites/fictional-keepsake-gift.png",
    size: 1254,
    amountMinor: 12900,
  },
] as const;

export type BrandGift = (typeof BRAND_GIFTS)[number];
export type BrandLine = Readonly<{
  artistId: string;
  giftId: string;
  quantity: number;
}>;
export type BrandState = Readonly<{
  schemaVersion: 1;
  artistId: string;
  category: BrandCategory;
  lines: readonly BrandLine[];
}>;

export function createBrandState(): BrandState {
  return {
    schemaVersion: 1,
    artistId: BRAND_ARTISTS[0].id,
    category: "all",
    lines: [],
  };
}

export function selectBrandArtist(
  state: BrandState,
  artistId: string,
): BrandState {
  if (!BRAND_ARTISTS.some((artist) => artist.id === artistId))
    throw new RangeError("Unknown preview artist");
  return { ...state, artistId };
}

export function addBrandGift(state: BrandState, giftId: string): BrandState {
  if (!BRAND_GIFTS.some((gift) => gift.id === giftId))
    throw new RangeError("Unknown preview gift");
  const existing = state.lines.find(
    (line) => line.giftId === giftId && line.artistId === state.artistId,
  );
  const lines = existing
    ? state.lines.map((line) =>
        line === existing
          ? { ...line, quantity: Math.min(5, line.quantity + 1) }
          : line,
      )
    : [...state.lines, { artistId: state.artistId, giftId, quantity: 1 }];
  return { ...state, lines };
}

export function visibleBrandGifts(
  category: BrandCategory,
): readonly BrandGift[] {
  return BRAND_GIFTS.filter(
    (gift) => category === "all" || gift.category === category,
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

/** Only fictional fixture IDs and bounded quantities may cross a locale navigation.
 * This is not a cart API, a price source, or storage for support-intent content. */
export function parseBrandState(serialized: string | undefined): BrandState {
  if (serialized === undefined || serialized.length > 4096)
    return createBrandState();
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      !record(value) ||
      !keys(value, ["schemaVersion", "artistId", "category", "lines"]) ||
      value["schemaVersion"] !== 1
    )
      return createBrandState();
    const artistId = value["artistId"];
    const category = value["category"];
    const lines = value["lines"];
    if (
      typeof artistId !== "string" ||
      !BRAND_ARTISTS.some((artist) => artist.id === artistId)
    )
      return createBrandState();
    if (
      !BRAND_CATEGORIES.some((candidate) => candidate === category) ||
      !Array.isArray(lines) ||
      lines.length > BRAND_ARTISTS.length * BRAND_GIFTS.length
    )
      return createBrandState();
    const parsed: BrandLine[] = [];
    for (const line of lines) {
      if (!record(line) || !keys(line, ["artistId", "giftId", "quantity"]))
        return createBrandState();
      const artist = line["artistId"],
        gift = line["giftId"],
        quantity = line["quantity"];
      if (
        typeof artist !== "string" ||
        !BRAND_ARTISTS.some((a) => a.id === artist) ||
        typeof gift !== "string" ||
        !BRAND_GIFTS.some((g) => g.id === gift) ||
        typeof quantity !== "number" ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > 5
      )
        return createBrandState();
      if (parsed.some((p) => p.artistId === artist && p.giftId === gift))
        return createBrandState();
      parsed.push({ artistId: artist, giftId: gift, quantity });
    }
    return {
      schemaVersion: 1,
      artistId,
      category: category as BrandCategory,
      lines: parsed,
    };
  } catch {
    return createBrandState();
  }
}
