import { expect, test } from "vitest";
import * as framing from "./media-framing.js";
test("browser crop uses the exact centered-focal geometry without fake media identities", () => {
  const api = framing as unknown as {
    planMediaCrop?: (input: unknown) => unknown;
  };
  expect(typeof api.planMediaCrop).toBe("function");
  expect(
    api.planMediaCrop!({
      sourceWidth: 3000,
      sourceHeight: 1000,
      role: "GIFT_PRIMARY",
      focalPoint: { x: 0.4, y: 0.5 },
    }),
  ).toEqual({
    sourceCrop: { x: 700, y: 0, width: 1000, height: 1000 },
    target: { width: 1200, height: 1200 },
  });
  expect(
    api.planMediaCrop!({
      sourceWidth: 3000,
      sourceHeight: 1000,
      role: "GIFT_PRIMARY",
      focalPoint: { x: 1, y: 0.5 },
    }),
  ).toEqual({
    sourceCrop: { x: 2000, y: 0, width: 1000, height: 1000 },
    target: { width: 1200, height: 1200 },
  });
  expect(
    api.planMediaCrop!({
      sourceWidth: 0,
      sourceHeight: 1000,
      role: "GIFT_PRIMARY",
      focalPoint: { x: 1, y: 0.5 },
    }),
  ).toBeNull();
});
