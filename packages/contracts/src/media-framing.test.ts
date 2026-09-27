import { expect, test } from "vitest";

const framing = await import("./media-framing.js").catch(() => undefined);

const request = {
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

const plan = {
  schemaVersion: 1,
  request,
  target: { width: 1_600, height: 2_000 },
  sourceCrop: { x: 800, y: 0, width: 2_400, height: 3_000 },
  destination: { x: 0, y: 0, width: 1_600, height: 2_000 },
  background: "NONE",
} as const;

test("freezes the original asset, metadata revision, checksum and corrected pixel dimensions", () => {
  expect(framing?.mediaFramingRequestSchema.parse(request)).toEqual(request);
  expect(
    framing?.mediaFramingPlanSchema.parse(JSON.parse(JSON.stringify(plan))),
  ).toEqual(plan);
});

test("rejects unsafe dimensions, unknown versions, invalid focal points and extra fields", () => {
  for (const invalid of [
    { ...request, schemaVersion: 2 },
    { ...request, sourceWidth: Number.MAX_SAFE_INTEGER + 1 },
    { ...request, sourceHeight: Number.POSITIVE_INFINITY },
    { ...request, sourceWidth: 3.5 },
    { ...request, sourceHeight: 0 },
    { ...request, focalPoint: { x: -0.1, y: 0.5 } },
    { ...request, focalPoint: { x: 0.5, y: Number.NaN } },
    { ...request, role: "BANNER" },
    { ...request, sourceChecksum: "unverified" },
    { ...request, sourceUrl: "https://example.com/untrusted.jpg" },
    { ...request, rotation: 90 },
  ]) {
    expect(framing?.mediaFramingRequestSchema.safeParse(invalid).success).toBe(
      false,
    );
  }
});

test("rejects plans that alter master size, enlarge pixels or exceed source bounds", () => {
  for (const invalid of [
    { ...plan, schemaVersion: 2 },
    { ...plan, target: { width: 800, height: 1_000 } },
    { ...plan, sourceCrop: { x: 2_000, y: 0, width: 2_400, height: 3_000 } },
    { ...plan, sourceCrop: { x: 0, y: 0, width: 800, height: 1_000 } },
    { ...plan, sourceCrop: { x: 0, y: 0, width: 2_000, height: 3_000 } },
    { ...plan, destination: { x: 1, y: 0, width: 1_600, height: 2_000 } },
    { ...plan, background: "NEUTRAL" },
  ]) {
    expect(framing?.mediaFramingPlanSchema.safeParse(invalid).success).toBe(
      false,
    );
  }
});

test("contain plans preserve the full source and allow only semantic neutral letterboxing", () => {
  const contained = {
    ...plan,
    request: { ...request, fit: "CONTAIN" },
    sourceCrop: { x: 0, y: 0, width: 4_000, height: 3_000 },
    destination: { x: 0, y: 400, width: 1_600, height: 1_200 },
    background: "NEUTRAL",
  };
  expect(framing?.mediaFramingPlanSchema.safeParse(contained).success).toBe(
    true,
  );
  for (const invalid of [
    { ...contained, background: "#d8b26e" },
    { ...contained, sourceCrop: { x: 0, y: 0, width: 3_000, height: 3_000 } },
    { ...contained, destination: { x: 0, y: 0, width: 1_600, height: 2_000 } },
    { ...contained, destination: { x: 0, y: 0, width: 1_600, height: 1_200 } },
  ]) {
    expect(framing?.mediaFramingPlanSchema.safeParse(invalid).success).toBe(
      false,
    );
  }
});

test("daily fill plans may enlarge a covering crop but must still fill the role canvas", () => {
  // 2026-09-27: daily management images fill every display ratio, enlarging small sources.
  const small = {
    ...request,
    sourceWidth: 540,
    sourceHeight: 540,
    fit: "COVER_ALLOW_ENLARGE",
  } as const;
  const filled = {
    ...plan,
    request: small,
    sourceCrop: { x: 54, y: 0, width: 432, height: 540 },
    destination: { x: 0, y: 0, width: 1_600, height: 2_000 },
    background: "NONE",
  } as const;
  expect(framing?.mediaFramingRequestSchema.parse(small)).toEqual(small);
  expect(
    framing?.mediaFramingPlanSchema.parse(JSON.parse(JSON.stringify(filled))),
  ).toEqual(filled);
  for (const invalid of [
    { ...filled, background: "NEUTRAL" },
    { ...filled, destination: { x: 0, y: 200, width: 1_600, height: 1_600 } },
    { ...filled, sourceCrop: { x: 0, y: 0, width: 540, height: 540 } },
    { ...filled, sourceCrop: { x: 200, y: 0, width: 432, height: 540 } },
    // Only the daily fill policy may enlarge; strict cover keeps refusing it.
    { ...filled, request: { ...small, fit: "COVER" } },
  ]) {
    expect(framing?.mediaFramingPlanSchema.safeParse(invalid).success).toBe(
      false,
    );
  }
});

test("returns versioned, JSON-safe success and structured input or resolution failures", () => {
  for (const result of [
    { schemaVersion: 1, outcome: "SUCCESS", plan },
    {
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code: "INVALID_REQUEST" },
    },
    {
      schemaVersion: 1,
      outcome: "FAILURE",
      error: {
        code: "SOURCE_TOO_SMALL",
        role: "PORTRAIT",
        minimumTarget: { width: 1_600, height: 2_000 },
      },
    },
  ]) {
    expect(
      framing?.mediaFramingResultSchema.parse(
        JSON.parse(JSON.stringify(result)),
      ),
    ).toEqual(result);
  }
});

test("rejects malformed plan geometry without throwing from arithmetic refinements", () => {
  const contained = {
    ...plan,
    request: { ...request, fit: "CONTAIN" },
    sourceCrop: { x: 0, y: 0, width: 4_000, height: 3_000 },
    destination: { x: 0, y: 400, width: 1_600, height: 1_200 },
    background: "NEUTRAL",
  };
  const invalidDimensions = [
    0,
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  const invalidPlans = [
    {
      ...contained,
      request: { ...contained.request, sourceWidth: 0, sourceHeight: 0 },
    },
    { ...contained, request: { ...contained.request, role: "UNKNOWN" } },
    { ...contained, request: { ...contained.request, role: "__proto__" } },
    { ...contained, request: { ...contained.request, role: undefined } },
    ...invalidDimensions.flatMap((value) => [
      { ...contained, request: { ...contained.request, sourceWidth: value } },
      { ...contained, request: { ...contained.request, sourceHeight: value } },
      ...(["target", "sourceCrop", "destination"] as const).flatMap((key) => [
        { ...contained, [key]: { ...contained[key], width: value } },
        { ...contained, [key]: { ...contained[key], height: value } },
      ]),
    ]),
    ...invalidDimensions
      .filter((value) => value !== 0)
      .flatMap((value) =>
        (["sourceCrop", "destination"] as const).flatMap((key) => [
          { ...contained, [key]: { ...contained[key], x: value } },
          { ...contained, [key]: { ...contained[key], y: value } },
        ]),
      ),
  ];
  for (const invalid of invalidPlans) {
    let success: boolean | undefined;
    expect(() => {
      success = framing?.mediaFramingPlanSchema.safeParse(invalid).success;
    }).not.toThrow();
    expect(success).toBe(false);
    expect(() => {
      success = framing?.mediaFramingResultSchema.safeParse({
        schemaVersion: 1,
        outcome: "SUCCESS",
        plan: invalid,
      }).success;
    }).not.toThrow();
    expect(success).toBe(false);
  }
});
