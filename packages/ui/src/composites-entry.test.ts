import { describe, expect, test } from "vitest";

import * as composites from "./composites.js";

describe("composites entry", () => {
  test("exposes exactly the six reviewed server-compatible components", () => {
    expect(Object.keys(composites).sort()).toEqual([
      "CartLine",
      "GiftTile",
      "Hero",
      "IdolContext",
      "IdolPortrait",
      "OrderTimeline",
    ]);
  });
});
