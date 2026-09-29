import type { CatalogDisplayOrderItem } from "@fan-support/contracts";

// L2-10: pure list moves; the saved order is simply the ids in the edited sequence.
export function moveDisplayItem(
  items: readonly CatalogDisplayOrderItem[],
  id: string,
  direction: -1 | 1 | "top",
): CatalogDisplayOrderItem[] {
  const index = items.findIndex((item) => item.id === id);
  const destination = direction === "top" ? 0 : index + direction;
  if (index < 0 || destination < 0 || destination >= items.length)
    return [...items];
  const next = [...items];
  const [moved] = next.splice(index, 1);
  if (moved) next.splice(destination, 0, moved);
  return next;
}
export function sameDisplayOrder(
  left: readonly CatalogDisplayOrderItem[],
  right: readonly CatalogDisplayOrderItem[],
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item.id === right[index]?.id)
  );
}
/** Every listed item is pinned in its edited place, so the storefront shows exactly this sequence. */
export function displayOrderIds(
  items: readonly CatalogDisplayOrderItem[],
): string[] {
  return items.map((item) => item.id);
}
