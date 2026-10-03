import { expect, it } from "vitest";
import type { CatalogDisplayOrderItem } from "@fan-support/contracts";
import {
  displayOrderIds,
  moveDisplayItem,
  sameDisplayOrder,
} from "./display-order-model";

const item = (id: string) => ({
  id,
  name: id,
  image: null,
  status: "active" as const,
  manual: false,
});
const list = ["a", "b", "c"].map((id) =>
  item(`00000000-0000-4000-8000-00000000000${id}`),
);
it("moves one place, to the top, and never past either end", () => {
  const ids = (items: readonly CatalogDisplayOrderItem[]) =>
    displayOrderIds(items).map((id) => id.at(-1));
  expect(ids(moveDisplayItem(list, list[2]!.id, -1))).toEqual(["a", "c", "b"]);
  expect(ids(moveDisplayItem(list, list[2]!.id, "top"))).toEqual([
    "c",
    "a",
    "b",
  ]);
  expect(ids(moveDisplayItem(list, list[0]!.id, -1))).toEqual(["a", "b", "c"]);
  expect(ids(moveDisplayItem(list, list[2]!.id, 1))).toEqual(["a", "b", "c"]);
  expect(sameDisplayOrder(list, moveDisplayItem(list, list[0]!.id, -1))).toBe(
    true,
  );
  expect(sameDisplayOrder(list, moveDisplayItem(list, list[1]!.id, 1))).toBe(
    false,
  );
});
