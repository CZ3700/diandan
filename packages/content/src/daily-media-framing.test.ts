import { expect, test } from "vitest";

const subject = await import("./daily-media-framing.js").catch(() => undefined);

test("fills every daily management role and biases artist photos toward the face", () => {
  expect(subject?.dailyManagementFraming("SAVE_ARTIST")).toEqual({
    fit: "COVER_ALLOW_ENLARGE",
    focalPoint: { x: 0.5, y: 0.3 },
  });
  for (const kind of ["SAVE_GIFT", "REPLACE_POSTER"] as const)
    expect(subject?.dailyManagementFraming(kind)).toEqual({
      fit: "COVER_ALLOW_ENLARGE",
      focalPoint: { x: 0.5, y: 0.5 },
    });
});

test("returns a fresh value that callers cannot mutate into a shared policy", () => {
  const first = subject?.dailyManagementFraming("SAVE_GIFT");
  expect(first).toBeDefined();
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first?.focalPoint)).toBe(true);
});
