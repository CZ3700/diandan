import * as homepageModule from "./storefront-homepage.js";
import { expect, test } from "vitest";
import {
  SUPPORTED_LOCALES,
  type StorefrontHomepageContextResponse,
} from "@fan-support/contracts";
import { storefrontPublishedFixture } from "./storefront-homepage-fixtures.js";

async function projector() {
  return homepageModule.projectStorefrontHomepage;
}
function fixture() {
  const homepage = storefrontPublishedFixture("HOMEPAGE");
  const idol = storefrontPublishedFixture("IDOL");
  const candidate = homepage.canonical.candidate;
  if (candidate.objectKind !== "HOMEPAGE") throw new Error("fixture");
  const slot = candidate.slots[0]!;
  if (slot.kind !== "HERO_IDOL") throw new Error("fixture");
  return {
    schemaVersion: 1,
    outcome: "SUCCESS",
    homepage,
    slots: [
      {
        slotKey: slot.slotKey,
        kind: slot.kind,
        idolId: slot.idolId,
        status: "AVAILABLE",
        context: idol,
      },
    ],
  };
}
test("homepage composes the exact hero in every locale using real immutable proof", async () => {
  const project = await projector();
  for (const locale of SUPPORTED_LOCALES) {
    const input = fixture();
    input.homepage.locale = locale;
    input.slots[0]!.context.locale = locale;
    const result = project(input);
    expect(result).toMatchObject({
      outcome: "SUCCESS",
      kind: "STOREFRONT_HOMEPAGE",
      slots: [{ status: "AVAILABLE" }],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /"(?:objectKey|manifest|canonical|approvals|rightsReference|createdBy)"/u,
    );
  }
});
test("missing or substituted hero and duplicate slots fail closed", async () => {
  const project = await projector();
  const input = fixture();
  for (const slots of [
    [],
    [...input.slots, ...input.slots],
    [{ ...input.slots[0], status: "UNAVAILABLE", context: undefined }],
    [{ ...input.slots[0], idolId: "81000000-0000-4000-8000-000000000099" }],
  ])
    expect(project({ ...input, slots })).toMatchObject({
      code: "CONTENT_UNAVAILABLE",
    });
});
test("wrong locale, changed manifest and revoked image rights never become an English fallback", async () => {
  const project = await projector();
  let input = fixture();
  input.slots[0]!.context.locale = "ja";
  expect(project(input)).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
  input = fixture();
  input.slots[0]!.context.publication.manifestHash = "b".repeat(
    64,
  ) as typeof input.homepage.publication.manifestHash;
  expect(project(input)).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
  input = fixture();
  const candidate = input.slots[0]!.context.canonical.candidate;
  if (candidate.objectKind !== "IDOL") throw new Error("fixture");
  candidate.mediaAssets[0]!.rightsStatus = "REJECTED";
  expect(project(input)).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
});

function featuredFixture(): Extract<
  StorefrontHomepageContextResponse,
  { outcome: "SUCCESS" }
> {
  const homepage = storefrontPublishedFixture("HOMEPAGE", false, true);
  const candidate = homepage.canonical.candidate;
  if (candidate.objectKind !== "HOMEPAGE") throw new Error("fixture");
  return {
    schemaVersion: 1,
    outcome: "SUCCESS",
    homepage,
    slots: candidate.slots.flatMap<
      Extract<
        StorefrontHomepageContextResponse,
        { outcome: "SUCCESS" }
      >["slots"][number]
    >((slot) => {
      if (slot.kind === "POLICY_LINK") return [];
      const reference = { slotKey: slot.slotKey, status: "AVAILABLE" as const };
      if (slot.kind === "FEATURED_GIFT")
        return [
          {
            ...reference,
            kind: slot.kind,
            giftId: slot.giftId,
            context: storefrontPublishedFixture("GIFT"),
          },
        ];
      return [
        {
          ...reference,
          kind: slot.kind,
          idolId: slot.idolId,
          context: storefrontPublishedFixture("IDOL"),
        },
      ];
    }),
  };
}

test("featured artist references may repeat the hero identity while every published position stays bound", async () => {
  const project = await projector();
  const input = featuredFixture();
  const result = project(input);
  expect(result.outcome).toBe("SUCCESS");
  if (result.outcome !== "SUCCESS") throw new Error("fixture unavailable");
  expect(
    result.slots.map((slot) => [slot.slotKey, slot.kind, slot.status]),
  ).toEqual(input.slots.map((slot) => [slot.slotKey, slot.kind, "AVAILABLE"]));
  expect(
    project({ ...input, slots: [...input.slots].reverse() }),
  ).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
});

test("missing or rights-revoked optional gift remains an explicit unavailable slot", async () => {
  const project = await projector();
  for (const reason of ["missing", "revoked"] as const) {
    const input = featuredFixture();
    const index = input.slots.findIndex(
      (slot) => slot.kind === "FEATURED_GIFT",
    );
    const gift = input.slots[index]!;
    if (gift.kind !== "FEATURED_GIFT" || gift.status !== "AVAILABLE")
      throw new Error("fixture");
    if (reason === "missing")
      input.slots[index] = {
        slotKey: gift.slotKey,
        kind: gift.kind,
        giftId: gift.giftId,
        status: "UNAVAILABLE",
      };
    else {
      if (gift.context.schemaVersion !== 1) throw new Error("legacy fixture");
      const candidate = gift.context.canonical.candidate;
      if (candidate.objectKind !== "GIFT") throw new Error("fixture");
      candidate.mediaAssets[0]!.rightsStatus = "REJECTED";
    }
    const result = project(input);
    expect(result.outcome).toBe("SUCCESS");
    if (result.outcome !== "SUCCESS") throw new Error("fixture unavailable");
    expect(result.slots.map((slot) => slot.status)).toEqual([
      "AVAILABLE",
      "AVAILABLE",
      "UNAVAILABLE",
    ]);
    expect(result.slots[index]).toEqual({
      slotKey: gift.slotKey,
      kind: gift.kind,
      giftId: gift.giftId,
      status: "UNAVAILABLE",
    });
  }
});
