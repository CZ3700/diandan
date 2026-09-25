import assert from "node:assert/strict";
import {
  contentAuthoringContentSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import { workspaceTranslations } from "./admin-workspace-fixtures.mjs";
import { seedGiftStorefront } from "./gift-storefront-fixtures.mjs";
import { giftStorefrontCopy } from "./gift-storefront-copy.mjs";

function homepageCopy(locale) {
  switch (locale) {
    case "en":
      return { title: "A little closer", cta: "Meet the artists" };
    case "zh-CN":
      return { title: "让心意，更近一点", cta: "认识艺人" };
    case "th":
      return { title: "ส่งความรู้สึกให้ใกล้กัน", cta: "พบกับศิลปิน" };
    case "vi":
      return { title: "Gửi yêu thương gần hơn", cta: "Khám phá nghệ sĩ" };
    case "ja":
      return { title: "想いを、もう少し近くへ", cta: "アーティストを探す" };
    case "es":
      return { title: "Un poco más cerca", cta: "Conoce a los artistas" };
    case "pt":
      return { title: "Um pouco mais perto", cta: "Conheça os artistas" };
    default:
      throw new Error("Unsupported acceptance fixture locale");
  }
}

function imageFor(content, role) {
  const matches = content.media.filter((image) => image.role === role);
  assert.equal(
    matches.length,
    1,
    `Fixture must retain one actual ${role} reference`,
  );
  return matches[0];
}

/** Reuses actual published TEST media references; every new owner gets fresh reviews and publication. */
export function buildAcceptanceArtistContent(source, index) {
  assert.equal(source.kind, "IDOL");
  assert.ok(Number.isInteger(index) && index >= 3 && index < 120);
  for (const role of ["PORTRAIT", "HERO_DESKTOP", "HERO_MOBILE"])
    imageFor(source, role);
  assert.deepEqual(
    new Set(source.translations.map((row) => row.locale)),
    new Set(SUPPORTED_LOCALES),
  );
  const name = `Acceptance Artist ${String(index + 1).padStart(3, "0")}`;
  return contentAuthoringContentSchema.parse({
    kind: "IDOL",
    structure: { ...source.structure, displayOrder: index },
    media: source.media,
    translations: source.translations.map((row) => ({
      ...row,
      fields: { ...row.fields, displayName: name, seoTitle: name },
    })),
    ...(index === 99
      ? {
          aliases: [
            { id: "acceptance-search", locale: "zh-CN", text: "星野一百" },
          ],
        }
      : {}),
  });
}

export function buildAcceptanceHomepageContent({
  artists,
  gifts,
  policies,
  hero,
}) {
  assert.ok(artists.length >= 3 && gifts.length >= 3);
  assert.equal(
    artists[0].acceptingGifts,
    true,
    "Homepage hero is an active published reference",
  );
  const featuredArtists = artists
    .filter((artist) => artist.acceptingGifts)
    .slice(0, 3);
  assert.equal(
    featuredArtists.length,
    3,
    "Homepage publication references three active artists",
  );
  const desktop = imageFor(hero, "HERO_DESKTOP");
  const mobile = imageFor(hero, "HERO_MOBILE");
  const delivery = policies.find((policy) => policy.kind === "DELIVERY");
  assert.ok(
    delivery,
    "Homepage policy link must reference an actually published delivery policy",
  );
  const featured = gifts.filter((gift) => gift.status === "active").slice(0, 3);
  assert.equal(featured.length, 3);
  const slots = [
    {
      slotKey: "hero",
      kind: "HERO_IDOL",
      idolId: artists[0].id,
      desktopMediaAssetId: desktop.mediaAssetId,
      desktopMediaMetadataRevisionId: desktop.mediaMetadataRevisionId,
      mobileMediaAssetId: mobile.mediaAssetId,
      mobileMediaMetadataRevisionId: mobile.mediaMetadataRevisionId,
      sortOrder: 0,
    },
    ...featuredArtists.map((artist, index) => ({
      slotKey: `artist-${index + 1}`,
      kind: "FEATURED_IDOL",
      idolId: artist.id,
      sortOrder: index + 1,
    })),
    ...featured.map((gift, index) => ({
      slotKey: `gift-${index + 1}`,
      kind: "FEATURED_GIFT",
      giftId: gift.id,
      sortOrder: index + 4,
    })),
    {
      slotKey: "delivery-policy",
      kind: "POLICY_LINK",
      policyKey: delivery.policyKey,
      sortOrder: 7,
    },
  ];
  return contentAuthoringContentSchema.parse({
    kind: "HOMEPAGE",
    structure: { slots },
    translations: workspaceTranslations((locale) => {
      const copy = homepageCopy(locale);
      return {
        heroTitle: copy.title,
        heroSubtitle: giftStorefrontCopy[locale].subtitle,
        ctaLabel: copy.cta,
        slotLabels: slots.map((slot) => ({
          slotKey: slot.slotKey,
          label:
            slot.kind === "POLICY_LINK"
              ? giftStorefrontCopy[locale].policyTitles[3]
              : slot.kind === "FEATURED_GIFT"
                ? featured.find((gift) => gift.id === slot.giftId).name
                : artists.find((artist) => artist.id === slot.idolId).name,
        })),
        seoTitle: copy.title,
        seoDescription: giftStorefrontCopy[locale].subtitle,
      };
    }),
  });
}

/** One P3-05 seed owns markets/policies; append 117 identities without reseeding conflicting owners. */
export async function seedAcceptanceStorefront(input) {
  const fixtures = await seedGiftStorefront(input);
  const { content, progress, check } = input;
  const sources = [];
  for (const artist of fixtures.artists.slice(0, 2)) {
    const read = await content.request("/api/v1/admin/content-authoring/read", {
      target: artist.owner,
      revisionId: artist.revisionId,
    });
    check(
      read.kind === "REVISION" &&
        read.snapshot.revisionId === artist.revisionId,
      "acceptance extension reads the exact normally published artist revision",
    );
    sources.push(read.snapshot.content);
  }
  for (let index = 3; index < 120; index++) {
    if (index % 20 === 0 || index === 3)
      progress(`publishing acceptance artist ${index + 1}/120`);
    const handle = `acceptance-artist-${String(index + 1).padStart(3, "0")}`;
    const created = await content.write("/api/v1/admin/catalog/idols/create", {
      handle,
      expectedBaseVersion: 0,
    });
    const owner = { kind: "IDOL", idolId: created.idolId };
    const draft = buildAcceptanceArtistContent(
      sources[index % sources.length],
      index,
    );
    const revisionId = await content.author(owner, draft);
    await content.approve(owner, revisionId);
    if (draft.aliases)
      await content.approveExtension({
        schemaVersion: 1,
        kind: "IDOL_ALIASES",
        idolRevisionId: revisionId,
      });
    const published = await content.publish(owner, revisionId);
    const current = await content.request("/api/v1/admin/catalog/owners/read", {
      target: owner,
      locale: "en",
    });
    await content.write("/api/v1/admin/catalog/idols/status", {
      idolId: created.idolId,
      status: "active",
      acceptingGifts: true,
      expectedBaseVersion: current.owner.baseVersion,
    });
    fixtures.artists.push({
      id: created.idolId,
      owner,
      revisionId,
      publicationId: published.publicationId,
      handle,
      name: draft.translations[0].fields.displayName,
      acceptingGifts: true,
    });
  }
  progress(
    "publishing acceptance homepage with actual artist, gift and policy references",
  );
  const owner = { kind: "HOMEPAGE" };
  const draft = buildAcceptanceHomepageContent({
    ...fixtures,
    hero: sources[0],
  });
  const revisionId = await content.author(owner, draft);
  await content.approve(owner, revisionId);
  const published = await content.publish(owner, revisionId);
  check(
    fixtures.artists.length === 120,
    "acceptance fixture has 120 normally published artist identities",
  );
  return {
    ...fixtures,
    homepage: { owner, revisionId, publicationId: published.publicationId },
    target: fixtures.artists[99],
    paused: fixtures.artists[2],
  };
}
