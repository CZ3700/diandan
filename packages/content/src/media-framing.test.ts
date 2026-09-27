import { expect, test } from "vitest";

const framing = await import("./media-framing.js").catch(() => undefined);

const source = {
  schemaVersion: 1,
  assetId: "ba70d55e-1fa3-4566-a47e-949700630761",
  metadataRevisionId: "58a67ed1-0877-4ef9-a8bb-fdfeec6e4ef1",
  sourceChecksum: "a".repeat(64),
  sourceWidth: 4_000,
  sourceHeight: 3_000,
  role: "PORTRAIT",
  fit: "COVER",
  focalPoint: { x: 0.5, y: 0.5 },
} as const;

test("crops a landscape source into the portrait master without changing the original", () => {
  const input = structuredClone(source);
  expect(framing?.planMediaFraming(input)).toEqual({
    schemaVersion: 1,
    outcome: "SUCCESS",
    plan: {
      schemaVersion: 1,
      request: source,
      target: { width: 1_600, height: 2_000 },
      sourceCrop: { x: 800, y: 0, width: 2_400, height: 3_000 },
      destination: { x: 0, y: 0, width: 1_600, height: 2_000 },
      background: "NONE",
    },
  });
  expect(input).toEqual(source);
});

test.each([
  [0, 0],
  [1, 1_600],
])("clamps a horizontal focal point %s at the crop edge", (x, expectedX) => {
  expect(
    framing?.planMediaFraming({ ...source, focalPoint: { x, y: 1 } }),
  ).toMatchObject({
    outcome: "SUCCESS",
    plan: { sourceCrop: { x: expectedX, y: 0, width: 2_400, height: 3_000 } },
  });
});

test("crops a tall source into a desktop hero with the focal point at the lower edge", () => {
  expect(
    framing?.planMediaFraming({
      ...source,
      sourceWidth: 3_200,
      sourceHeight: 6_000,
      role: "HERO_DESKTOP",
      focalPoint: { x: 0, y: 1 },
    }),
  ).toMatchObject({
    outcome: "SUCCESS",
    plan: {
      target: { width: 2_400, height: 1_350 },
      sourceCrop: { x: 0, y: 4_200, width: 3_200, height: 1_800 },
      destination: { x: 0, y: 0, width: 2_400, height: 1_350 },
    },
  });
});

test("keeps a panoramic scene complete with centered neutral letterboxing", () => {
  expect(
    framing?.planMediaFraming({
      ...source,
      sourceWidth: 4_000,
      sourceHeight: 1_000,
      fit: "CONTAIN",
      focalPoint: { x: 1, y: 0 },
    }),
  ).toMatchObject({
    outcome: "SUCCESS",
    plan: {
      target: { width: 1_600, height: 2_000 },
      sourceCrop: { x: 0, y: 0, width: 4_000, height: 1_000 },
      destination: { x: 0, y: 800, width: 1_600, height: 400 },
      background: "NEUTRAL",
    },
  });
});

test.each([
  ["PORTRAIT", 1_600, 2_000],
  ["HERO_DESKTOP", 2_400, 1_350],
  ["HERO_MOBILE", 1_080, 1_350],
  ["GIFT_PRIMARY", 1_200, 1_200],
])(
  "keeps the fixed %s master size and accepts exact-size square or rectangular sources",
  (role, width, height) => {
    expect(
      framing?.planMediaFraming({
        ...source,
        sourceWidth: width,
        sourceHeight: height,
        role,
      }),
    ).toMatchObject({
      outcome: "SUCCESS",
      plan: {
        target: { width, height },
        sourceCrop: { x: 0, y: 0, width, height },
        destination: { x: 0, y: 0, width, height },
      },
    });
  },
);

test.each(["COVER"])(
  "rejects a low-resolution source instead of enlarging it for %s",
  (fit) => {
    expect(
      framing?.planMediaFraming({
        ...source,
        sourceWidth: 800,
        sourceHeight: 1_000,
        fit,
      }),
    ).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      error: {
        code: "SOURCE_TOO_SMALL",
        role: "PORTRAIT",
        minimumTarget: { width: 1_600, height: 2_000 },
      },
    });
  },
);

test("contains a non-divisible source using one aspect-preserving resize rounded to raster pixels", () => {
  expect(
    framing?.planMediaFraming({
      ...source,
      sourceWidth: 4_001,
      sourceHeight: 3_001,
      fit: "CONTAIN",
    }),
  ).toMatchObject({
    outcome: "SUCCESS",
    plan: {
      sourceCrop: { x: 0, y: 0, width: 4_001, height: 3_001 },
      destination: { x: 0, y: 400, width: 1_600, height: 1_200 },
    },
  });
});

test("handles safe integer extremes without overflow or a zero-sized contained image", () => {
  expect(
    framing?.planMediaFraming({
      ...source,
      sourceWidth: Number.MAX_SAFE_INTEGER,
      sourceHeight: Number.MAX_SAFE_INTEGER,
      role: "GIFT_PRIMARY",
      focalPoint: { x: 1, y: 1 },
    }),
  ).toMatchObject({
    outcome: "SUCCESS",
    plan: {
      sourceCrop: {
        x: 0,
        y: 0,
        width: Number.MAX_SAFE_INTEGER,
        height: Number.MAX_SAFE_INTEGER,
      },
    },
  });
  expect(
    framing?.planMediaFraming({
      ...source,
      sourceWidth: Number.MAX_SAFE_INTEGER,
      sourceHeight: 1,
      fit: "CONTAIN",
    }),
  ).toMatchObject({ outcome: "FAILURE", error: { code: "SOURCE_TOO_SMALL" } });
});

test("fails closed on invalid inputs without retaining untrusted fields", () => {
  for (const input of [
    null,
    { ...source, schemaVersion: 2 },
    { ...source, sourceWidth: Number.MAX_SAFE_INTEGER + 1 },
    { ...source, focalPoint: { x: 2, y: 0.5 } },
    { ...source, fit: "STRETCH" },
    { ...source, secret: "must-not-escape" },
  ]) {
    expect(framing?.planMediaFraming(input)).toEqual({
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code: "INVALID_REQUEST" },
    });
  }
});

test("survives JSON roundtrip as an immutable identity-bound plan", () => {
  const result = framing?.planMediaFraming(JSON.parse(JSON.stringify(source)));
  expect(result).toBeDefined();
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
});

test("contains a smaller image at its actual pixel size instead of requiring an enlarged source", () => {
  expect(
    framing?.planMediaFraming({
      ...source,
      sourceWidth: 800,
      sourceHeight: 1000,
      fit: "CONTAIN",
    }),
  ).toMatchObject({
    outcome: "SUCCESS",
    plan: {
      target: { width: 1600, height: 2000 },
      sourceCrop: { x: 0, y: 0, width: 800, height: 1000 },
      destination: { x: 400, y: 500, width: 800, height: 1000 },
      background: "NEUTRAL",
    },
  });
});

test.each([
  // A small square fills the portrait: crop the centred 4:5 column, then enlarge it.
  [540, 540, { x: 0.5, y: 0.5 }, { x: 54, y: 0, width: 432, height: 540 }],
  // A small portrait fills the desktop hero around an upper focal point.
  [
    1_080,
    1_350,
    { x: 0.5, y: 0.3 },
    { x: 4, y: 104, width: 1_072, height: 603 },
  ],
])(
  "fills the role canvas from a %sx%s source by enlarging its covering crop",
  (sourceWidth, sourceHeight, focalPoint, sourceCrop) => {
    const role = sourceWidth === 540 ? "PORTRAIT" : "HERO_DESKTOP";
    const target =
      role === "PORTRAIT"
        ? { width: 1_600, height: 2_000 }
        : { width: 2_400, height: 1_350 };
    expect(
      framing?.planMediaFraming({
        ...source,
        sourceWidth,
        sourceHeight,
        role,
        fit: "COVER_ALLOW_ENLARGE",
        focalPoint,
      }),
    ).toMatchObject({
      outcome: "SUCCESS",
      plan: {
        target,
        sourceCrop,
        destination: { x: 0, y: 0, ...target },
        background: "NONE",
      },
    });
  },
);

test("fills from a large source exactly like cover, without enlarging", () => {
  const cover = framing?.planMediaFraming(source);
  const fill = framing?.planMediaFraming({
    ...source,
    fit: "COVER_ALLOW_ENLARGE",
  });
  expect(fill).toMatchObject({ outcome: "SUCCESS" });
  expect(cover).toMatchObject({ outcome: "SUCCESS" });
  if (fill?.outcome !== "SUCCESS" || cover?.outcome !== "SUCCESS") return;
  expect(fill.plan.sourceCrop).toEqual(cover.plan.sourceCrop);
  expect(fill.plan.destination).toEqual(cover.plan.destination);
});
