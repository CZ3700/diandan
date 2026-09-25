import { randomUUID } from "node:crypto";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  computeHomepageTranslationContentHash,
  computePolicyTranslationContentHash,
} from "@fan-support/content";
import { seedAdminContentFixtures } from "./postgres-admin-content-fixtures.mjs";
import {
  authoringHeadVersion,
  loadAuthoringSnapshot,
} from "../dist/content-authoring-data.js";

const time = {
  created: "2026-01-02T00:00:00.000Z",
  edited: "2026-01-02T00:01:00.123456Z",
  submitted: "2026-01-02T00:02:00.123456Z",
  reviewed: "2026-01-02T00:03:00.123456Z",
};
async function insert(client, table, value) {
  const entries = Object.entries(value);
  await client.query(
    `INSERT INTO public.${table}(${entries.map(([key]) => key).join(",")}) VALUES(${entries.map((_, index) => `$${index + 1}`).join(",")})`,
    entries.map(([, value]) => value),
  );
}
async function approvedTranslations(
  client,
  kind,
  revisionId,
  fieldsByLocale,
  editor,
  reviewer,
  timeline = time,
) {
  const parent = `${kind}_revision_id`,
    foreign = `${kind}_translation_id`,
    hash =
      kind === "homepage"
        ? computeHomepageTranslationContentHash
        : computePolicyTranslationContentHash;
  const englishHash = hash(fieldsByLocale.get("en"));
  for (const [locale, fields] of fieldsByLocale) {
    const id = randomUUID(),
      { slotLabels, ...rest } = fields;
    await insert(client, `${kind}_revision_translations`, {
      id,
      [parent]: revisionId,
      locale,
      source_hash: hash(fields),
      translated_from_source_hash: englishHash,
      origin: "HUMAN",
      editor_id: editor,
      edited_at: timeline.edited,
      ...Object.fromEntries(
        Object.entries(rest).map(([key, value]) => [
          key.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`),
          value,
        ]),
      ),
    });
    if (slotLabels)
      for (const label of slotLabels)
        await insert(client, "homepage_slot_translations", {
          homepage_translation_id: id,
          slot_key: label.slotKey,
          label: label.label,
        });
    for (const [index, status] of ["DRAFT", "IN_REVIEW", "APPROVED"].entries())
      await insert(client, `${kind}_translation_reviews`, {
        id: randomUUID(),
        [foreign]: id,
        sequence: index + 1,
        status,
        created_at: [timeline.edited, timeline.submitted, timeline.reviewed][
          index
        ],
        ...(status === "IN_REVIEW" ? { submitted_at: timeline.submitted } : {}),
        ...(status === "APPROVED"
          ? {
              reviewer_id: reviewer,
              reviewed_at: timeline.reviewed,
              reviewed_source_hash: englishHash,
              reviewed_content_hash: hash(fields),
            }
          : {}),
      });
  }
}
export async function seedContentAuthoringPolicySource(
  client,
  { editor, reviewer, timeline = time },
) {
  const revisionId = randomUUID(),
    policyKey = `fixture-policy-${randomUUID()}`;
  await insert(client, "policies", {
    policy_key: policyKey,
    kind: "DELIVERY",
    created_at: timeline.created,
  });
  await insert(client, "policy_revisions", {
    id: revisionId,
    policy_key: policyKey,
    kind: "DELIVERY",
    revision: 1,
    lifecycle: "DRAFT",
    effective_at: timeline.created,
    created_by: editor,
    created_at: timeline.created,
  });
  await approvedTranslations(
    client,
    "policy",
    revisionId,
    new Map(
      SUPPORTED_LOCALES.map((locale) => [
        locale,
        {
          title: `${locale} Fictional policy`,
          summary: `${locale} A test-only policy.`,
          body: `<p>${locale} No legal effect.</p>`,
        },
      ]),
    ),
    editor,
    reviewer,
    timeline,
  );
  return { target: { kind: "POLICY", policyKey }, revisionId };
}
/** All records are synthetic and use normal production triggers. */
export async function seedContentAuthoringFixtures(client, options = {}) {
  const fixtures = await seedAdminContentFixtures(client, options);
  const homepageId = randomUUID(),
    policyId = randomUUID(),
    policyKey = `fixture-policy-${randomUUID()}`;
  await client.query("BEGIN");
  try {
    await insert(client, "policies", {
      policy_key: policyKey,
      kind: "DELIVERY",
      created_at: time.created,
    });
    await insert(client, "homepage_revisions", {
      id: homepageId,
      revision: 1,
      lifecycle: "DRAFT",
      created_by: fixtures.editor,
      created_at: time.created,
    });
    await insert(client, "homepage_slots", {
      homepage_revision_id: homepageId,
      slot_key: "featured",
      kind: "FEATURED_IDOL",
      idol_id: fixtures.catalog.idols[0].id,
      sort_order: 0,
    });
    await insert(client, "policy_revisions", {
      id: policyId,
      policy_key: policyKey,
      kind: "DELIVERY",
      revision: 1,
      lifecycle: "DRAFT",
      effective_at: time.created,
      created_by: fixtures.editor,
      created_at: time.created,
    });
    await approvedTranslations(
      client,
      "homepage",
      homepageId,
      new Map(
        SUPPORTED_LOCALES.map((locale) => [
          locale,
          {
            heroTitle: `${locale} Thoughtful gifts`,
            heroSubtitle: `${locale} A fictional home page for tests.`,
            ctaLabel: `${locale} Discover`,
            slotLabels: [{ slotKey: "featured", label: `${locale} Featured` }],
            seoTitle: `${locale} Home`,
            seoDescription: `${locale} A fictional home page.`,
          },
        ]),
      ),
      fixtures.editor,
      fixtures.reviewer,
    );
    await approvedTranslations(
      client,
      "policy",
      policyId,
      new Map(
        SUPPORTED_LOCALES.map((locale) => [
          locale,
          {
            title: `${locale} Fictional delivery`,
            summary: `${locale} A synthetic policy with no legal effect.`,
            body: `<p>${locale} A test policy.</p>`,
          },
        ]),
      ),
      fixtures.editor,
      fixtures.reviewer,
    );
    const targets = {
      idol: { kind: "IDOL", idolId: fixtures.catalog.idols[0].id },
      gift: { kind: "GIFT", giftId: fixtures.catalog.gifts[0].id },
      media: {
        kind: "MEDIA_METADATA",
        mediaAssetId: fixtures.catalog.media[0].assetId,
      },
      homepage: { kind: "HOMEPAGE" },
      policy: { kind: "POLICY", policyKey },
    };
    const approvedSourceRevisionIds = {
      idol: fixtures.catalog.idols[0].revisionId,
      gift: fixtures.catalog.gifts[0].revisionId,
      media: fixtures.catalog.media[0].revisionId,
      homepage: homepageId,
      policy: policyId,
    };
    const content = {},
      headVersions = {};
    for (const [key, target] of Object.entries(targets)) {
      headVersions[key] = await authoringHeadVersion(client, target);
      const snapshot = await loadAuthoringSnapshot(
        client,
        target,
        approvedSourceRevisionIds[key],
        headVersions[key],
      );
      if (!snapshot) throw new Error("missing authoring fixture snapshot");
      content[key] = snapshot.content;
    }
    content.idol = {
      ...content.idol,
      aliases: [{ id: "stage-name", locale: null, text: "Fictional Star" }],
    };
    content.gift = {
      ...content.gift,
      details: {
        blocks: [{ id: "introduction", kind: "PARAGRAPH" }],
        translations: SUPPORTED_LOCALES.map((locale) => ({
          locale,
          origin: "HUMAN",
          blocks: [
            {
              blockId: "introduction",
              kind: "PARAGRAPH",
              text: `${locale} A thoughtful fictional gift.`,
            },
          ],
        })),
      },
    };
    await client.query("COMMIT");
    return {
      ...fixtures,
      targets,
      content,
      headVersions,
      approvedSourceRevisionIds,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
