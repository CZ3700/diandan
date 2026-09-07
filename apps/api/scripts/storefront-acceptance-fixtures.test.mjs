import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  buildAcceptanceArtistContent,
  buildAcceptanceHomepageContent,
} from "./storefront-acceptance-fixtures.mjs";

function source() {
  return {
    kind: "IDOL",
    structure: {
      themeAccent: "#CCAE7F",
      heroTextTone: "light",
      displayOrder: 0,
    },
    media: ["PORTRAIT", "HERO_DESKTOP", "HERO_MOBILE"].map(
      (role, sortOrder) => ({
        role,
        sortOrder,
        mediaAssetId: randomUUID(),
        mediaMetadataRevisionId: randomUUID(),
      }),
    ),
    translations: SUPPORTED_LOCALES.map((locale) => ({
      locale,
      origin: "HUMAN",
      fields: {
        displayName: "Source artist",
        shortBio: `TEST ${locale}`,
        fullBio: "<p>Fictional adult.</p>",
        seoTitle: "Source artist",
        seoDescription: `TEST ${locale}`,
      },
    })),
    aliases: [{ id: "source-alias", locale: "en", text: "Source name" }],
  };
}

test("new artist keeps both actual media references and all locales without inheriting another identity's aliases", () => {
  const original = source();
  const before = globalThis.structuredClone(original);
  const value = buildAcceptanceArtistContent(original, 3);
  assert.deepEqual(original, before);
  assert.deepEqual(value.media, original.media);
  assert.deepEqual(
    value.translations.map((row) => row.locale),
    SUPPORTED_LOCALES,
  );
  assert.ok(
    value.translations.every(
      (row) =>
        row.fields.displayName === "Acceptance Artist 004" &&
        row.fields.seoTitle === "Acceptance Artist 004",
    ),
  );
  assert.equal(value.aliases, undefined);
  assert.equal(value.structure.displayOrder, 3);
});

test("homepage requires an actual independent mobile reference before it can be authored", () => {
  const original = source();
  const artists = Array.from({ length: 3 }, (_, index) => ({
    id: randomUUID(),
    name: `Artist ${index}`,
    acceptingGifts: true,
  }));
  const gifts = Array.from({ length: 3 }, (_, index) => ({
    id: randomUUID(),
    name: `Gift ${index}`,
    status: "active",
  }));
  const policies = [{ policyKey: "delivery", kind: "DELIVERY" }];
  assert.throws(
    () =>
      buildAcceptanceHomepageContent({
        artists,
        gifts,
        policies,
        hero: {
          ...original,
          media: original.media.filter((image) => image.role !== "HERO_MOBILE"),
        },
      }),
    /HERO_MOBILE/,
  );
  const value = buildAcceptanceHomepageContent({
    artists,
    gifts,
    policies,
    hero: original,
  });
  const slot = value.structure.slots[0];
  assert.equal(slot.mobileMediaAssetId, original.media[2].mediaAssetId);
  assert.equal(
    slot.desktopMediaMetadataRevisionId,
    original.media[1].mediaMetadataRevisionId,
  );
  assert.deepEqual(
    value.translations.map((row) => row.locale),
    SUPPORTED_LOCALES,
  );
  assert.equal(value.structure.slots.length, 8);
});

test("homepage chooses active publication references while retaining the paused directory sample", () => {
  const artists = Array.from({ length: 4 }, (_, index) => ({
    id: randomUUID(),
    name: `Artist ${index}`,
    acceptingGifts: index !== 2,
  }));
  const gifts = Array.from({ length: 3 }, (_, index) => ({
    id: randomUUID(),
    name: `Gift ${index}`,
    status: "active",
  }));
  const value = buildAcceptanceHomepageContent({
    artists,
    gifts,
    policies: [{ policyKey: "delivery", kind: "DELIVERY" }],
    hero: source(),
  });
  assert.deepEqual(
    value.structure.slots
      .filter((slot) => slot.kind === "FEATURED_IDOL")
      .map((slot) => slot.idolId),
    [artists[0].id, artists[1].id, artists[3].id],
  );
  assert.equal(artists.length, 4);
  assert.equal(artists[2].acceptingGifts, false);
});
