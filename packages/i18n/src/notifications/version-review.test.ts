import { readFileSync } from "node:fs";
import {
  SUPPORTED_LOCALES,
  notificationTemplateReviewSchema,
  orderNotificationVariablesSchema,
  type OrderNotificationEventType,
} from "@fan-support/contracts";
import { IntlMessageFormat } from "intl-messageformat";
import { expect, it } from "vitest";
import { assertApprovedReviews } from "./review.js";
import { copyV1 } from "./v1/copy.js";
import {
  eventTemplateKeys,
  hashMaterial,
  localeMaterialV1,
  templateVersionV1,
  variablesHashV1,
} from "./v1/identity.js";
import reviews from "./v1/reviews.json" with { type: "json" };
import { copyV2 } from "./v2/copy.js";
import {
  localeMaterialV2,
  templateVersionV2,
  variableSchemaV2,
  variablesHashV2,
} from "./v2/identity.js";
import reviewsV2 from "./v2/reviews.json" with { type: "json" };

const versions = [
  {
    name: "v1",
    reviews,
    copy: copyV1,
    templateVersion: templateVersionV1,
    localeMaterial: localeMaterialV1,
    variablesHash: variablesHashV1,
  },
  {
    name: "v2",
    reviews: reviewsV2,
    copy: copyV2,
    templateVersion: templateVersionV2,
    localeMaterial: localeMaterialV2,
    variablesHash: variablesHashV2,
  },
] as const;

const events = Object.keys(eventTemplateKeys) as OrderNotificationEventType[];

it.each(versions)(
  "has a complete, exact-hash DRAFT review manifest for 21 $name locale/event templates",
  (version) => {
    expect(version.reviews).toHaveLength(21);
    for (const event of events)
      for (const locale of SUPPORTED_LOCALES) {
        const templateVersion = version.templateVersion(event);
        expect(templateVersion.startsWith(`${version.name}.`)).toBe(true);
        const review = notificationTemplateReviewSchema.parse(
          version.reviews.find(
            (entry) =>
              entry.locale === locale &&
              entry.templateVersion === templateVersion,
          ),
        );
        expect(review).toMatchObject({
          locale,
          templateVersion,
          status: "DRAFT",
          reviewer: null,
          approvedCommit: null,
          sourceHash: hashMaterial(version.localeMaterial(event, "en")),
          translationHash: hashMaterial(version.localeMaterial(event, locale)),
          variablesHash: version.variablesHash,
        });
      }
  },
);

it("validates exact review material and never treats a fabricated or stale hash as approved", () => {
  const synthetic = events.flatMap((event) =>
    SUPPORTED_LOCALES.map((locale) => ({
      schemaVersion: 1 as const,
      locale,
      templateVersion: templateVersionV1(event),
      sourceHash: hashMaterial(localeMaterialV1(event, "en")),
      translationHash: hashMaterial(localeMaterialV1(event, locale)),
      variablesHash: variablesHashV1,
      translator: "SYNTHETIC TEST FIXTURE",
      reviewer: "SYNTHETIC TEST FIXTURE",
      status: "APPROVED" as const,
      approvedCommit: "0".repeat(40),
    })),
  );
  expect(() => assertApprovedReviews(synthetic)).not.toThrow();
  for (const mutation of [
    { sourceHash: "a".repeat(64) },
    { translationHash: "b".repeat(64) },
    { variablesHash: "c".repeat(64) },
    { reviewer: " " },
    { approvedCommit: null },
    { status: "DRAFT", reviewer: null, approvedCommit: null },
  ] as const) {
    const changed: Record<string, unknown>[] = structuredClone(synthetic);
    changed[0] = { ...changed[0]!, ...mutation };
    expect(() => assertApprovedReviews(changed)).toThrow(
      "NOTIFICATION_TEMPLATES_UNAPPROVED",
    );
  }
  expect(() => assertApprovedReviews(synthetic.slice(1))).toThrow(
    "NOTIFICATION_TEMPLATES_UNAPPROVED",
  );
  expect(() => assertApprovedReviews([...synthetic, synthetic[0]!])).toThrow(
    "NOTIFICATION_TEMPLATES_UNAPPROVED",
  );
});

function parameters(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(parameters).sort();
  if (value !== null && typeof value === "object") {
    const node = value as Record<string, unknown>;
    const current =
      typeof node["type"] === "number" &&
      node["type"] !== 0 &&
      typeof node["value"] === "string"
        ? [`${node["type"]}:${node["value"]}`]
        : [];
    return [...current, ...Object.values(node).flatMap(parameters)].sort();
  }
  return [];
}

it.each(versions)(
  "compiles every $name ICU message with the same variable names and types in every locale",
  ({ copy: copyV1 }) => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = copyV1[locale];
      expect(Object.keys(catalog)).toEqual(Object.keys(copyV1.en));
      for (const event of events)
        for (const key of [
          "subject",
          "preheader",
          "heading",
          "body",
        ] as const) {
          expect(
            parameters(
              new IntlMessageFormat(
                catalog.events[event][key],
                locale,
              ).getAst(),
            ),
          ).toEqual(
            parameters(
              new IntlMessageFormat(
                copyV1.en.events[event][key],
                "en",
              ).getAst(),
            ),
          );
        }
      expect(
        parameters(new IntlMessageFormat(catalog.quantity, locale).getAst()),
      ).toEqual(["2:quantity"]);
      const summaryAst = new IntlMessageFormat(
        catalog.moreItems,
        locale,
      ).getAst();
      expect(parameters(summaryAst)).toEqual(
        parameters(new IntlMessageFormat(copyV1.en.moreItems, "en").getAst()),
      );
      const plural = summaryAst[0];
      expect(plural?.type).toBe(6);
      if (plural?.type === 6)
        expect(Object.keys(plural.options).sort()).toEqual(["one", "other"]);
    }
  },
);

it("pins the current variable schema to v2 and retains every archived template identity", () => {
  expect(
    orderNotificationVariablesSchema.toJSONSchema({ unrepresentable: "any" }),
  ).toEqual(variableSchemaV2);
  for (const version of versions) {
    const file = new URL(
      `./${version.name}/identity.fixture.json`,
      import.meta.url,
    );
    let fixture: unknown;
    try {
      fixture = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      fixture = undefined;
    }
    expect(
      fixture,
      `historical ${version.name} identity fixture must be retained`,
    ).toEqual(
      Object.fromEntries(
        events.map((event) => [event, version.templateVersion(event)]),
      ),
    );
  }
});
