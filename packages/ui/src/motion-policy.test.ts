import { describe, expect, test } from "vitest";

import {
  mediaPresentationSettleReady,
  mediaPresentationReady,
  motionModeForActivation,
  nextIdolSwitchState,
  validateIdolSwitchItems,
} from "./motion-policy.js";

const item = (id: string, name = `Idol ${id}`) => ({
  description: `${name} description`,
  id,
  media: {
    alt: `${name} portrait`,
    fallbackLabel: "Portrait unavailable",
    focalPoint: { x: 0.5, y: 0.3 },
    height: 1_000,
    src: `/${id}.png`,
    state: "ready" as const,
    width: 800,
  },
  name,
});

describe("motion policy", () => {
  test("settles only a successfully decoded current image or a visible fallback", () => {
    const readyImage = {
      fallbackVisible: false,
      imageComplete: true,
      imageNaturalWidth: 1_122,
      imageUnchanged: true,
    } as const;

    expect(
      mediaPresentationSettleReady({
        ...readyImage,
        decodeOutcome: "succeeded",
      }),
    ).toBe(true);
    expect(
      mediaPresentationSettleReady({
        ...readyImage,
        decodeOutcome: "failed",
      }),
    ).toBe(false);
    expect(
      mediaPresentationSettleReady({
        ...readyImage,
        decodeOutcome: "succeeded",
        imageUnchanged: false,
      }),
    ).toBe(false);
    expect(
      mediaPresentationSettleReady({
        decodeOutcome: "failed",
        fallbackVisible: true,
        imageComplete: false,
        imageNaturalWidth: 0,
        imageUnchanged: false,
      }),
    ).toBe(true);
  });

  test("keeps the last presented idol when a pending image is replaced or cancelled", () => {
    const pending = {
      activeId: "noa",
      mode: "spatial" as const,
      outgoingId: "mira",
      phase: "prepare" as const,
      revision: 1,
    };

    expect(nextIdolSwitchState(pending, "lumi", "spatial")).toEqual({
      activeId: "lumi",
      mode: "spatial",
      outgoingId: "mira",
      phase: "prepare",
      revision: 2,
    });
    expect(nextIdolSwitchState(pending, "mira", "spatial")).toEqual({
      activeId: "mira",
      mode: "instant",
      outgoingId: null,
      phase: "settled",
      revision: 2,
    });
  });

  test("keeps the prior visual until the selected media or fallback is renderable", () => {
    expect(
      mediaPresentationReady({
        fallbackVisible: false,
        imageComplete: false,
        imageNaturalWidth: 0,
      }),
    ).toBe(false);
    expect(
      mediaPresentationReady({
        fallbackVisible: false,
        imageComplete: true,
        imageNaturalWidth: 0,
      }),
    ).toBe(false);
    expect(
      mediaPresentationReady({
        fallbackVisible: false,
        imageComplete: true,
        imageNaturalWidth: 1_122,
      }),
    ).toBe(true);
    expect(
      mediaPresentationReady({
        fallbackVisible: true,
        imageComplete: false,
        imageNaturalWidth: 0,
      }),
    ).toBe(true);
  });

  test("animates only a pointer activation when motion is allowed", () => {
    expect(
      motionModeForActivation({
        clickDetail: 1,
        pointerType: "mouse",
        reduced: false,
      }),
    ).toBe("spatial");
    expect(
      motionModeForActivation({
        clickDetail: 1,
        pointerType: "touch",
        reduced: false,
      }),
    ).toBe("opacity");
    expect(
      motionModeForActivation({
        clickDetail: 0,
        pointerType: "mouse",
        reduced: false,
      }),
    ).toBe("instant");
    expect(
      motionModeForActivation({
        clickDetail: 1,
        pointerType: "mouse",
        reduced: true,
      }),
    ).toBe("instant");
    expect(
      motionModeForActivation({
        clickDetail: -1,
        pointerType: undefined,
        reduced: false,
      }),
    ).toBe("instant");
  });

  test("accepts a unique, complete switch set and selected id", () => {
    expect(() =>
      validateIdolSwitchItems([item("mira"), item("noa")], "mira"),
    ).not.toThrow();
  });

  test("rejects invalid switch sets before rendering", () => {
    expect(() => validateIdolSwitchItems([], "mira")).toThrow(/two/u);
    expect(() =>
      validateIdolSwitchItems([item("mira"), item("mira")], "mira"),
    ).toThrow(/unique/u);
    expect(() =>
      validateIdolSwitchItems([item("mira"), item("noa")], "missing"),
    ).toThrow(/initial/u);
    expect(() =>
      validateIdolSwitchItems([item("mira", " "), item("noa")], "mira"),
    ).toThrow(/name/u);
  });
});
