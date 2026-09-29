/** L2-15: a card's place in the artist wave; cards at rest carry no value. */
export type ArtistWave = "peak" | "near";

/**
 * On touch screens the leftmost whole card leads the wave. `cardStarts` are the cards'
 * offsets inside the scrolling track; a card that is cut by less than a pixel still counts.
 */
export function leadingArtistIndex(
  scrollLeft: number,
  cardStarts: readonly number[],
): number | null {
  if (cardStarts.length === 0) return null;
  const index = cardStarts.findIndex((start) => start >= scrollLeft - 1);
  return index < 0 ? cardStarts.length - 1 : index;
}

/** The peak rises; its two neighbours lift slightly; everything else stays flat. */
export function artistWave(
  index: number,
  peak: number | null,
): ArtistWave | undefined {
  if (peak === null) return undefined;
  if (index === peak) return "peak";
  return Math.abs(index - peak) === 1 ? "near" : undefined;
}
