import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import {
  SUPPORTED_LOCALES,
  paymentConfigurationRevisionSchema,
  sourceHashSchema,
} from "@fan-support/contracts";
const review = await import("./review-panel").catch(() => undefined);
const publish = await import("./publish-panel").catch(() => undefined);
const copies = await import("./copy").catch(() => undefined);
const manifest = await import("./review-manifest").catch(() => undefined);
const id = "10000000-0000-4000-8000-000000000001";
const revision = paymentConfigurationRevisionSchema.parse({
  revisionId: id,
  version: 1,
  lifecycle: "DRAFT",
  createdAt: "2026-09-22T00:00:00Z",
  createdBy: id,
  configuration: {
    schemaVersion: 1,
    channels: [
      {
        providerAccountId: id,
        enabled: true,
        displayOrder: 1,
        rolloutBasisPoints: 10000,
        healthPolicy: {
          failureThreshold: 3,
          failureWindowMs: 60000,
          openDurationMs: 10000,
          probeLeaseMs: 5000,
          probeRetryMs: 10000,
        },
        translations: [
          {
            locale: "en",
            displayName: "Test card",
            customerHint: "Hosted test checkout",
            translatedFromSourceHash: null,
          },
        ],
      },
    ],
    routes: [],
  },
  reviews: [
    {
      providerAccountId: id,
      locale: "en",
      status: "IN_REVIEW",
      sourceHash: "a".repeat(64),
      editorId: id,
      reviewerId: null,
      canApprove: false,
    },
  ],
});
test("review controls respect server approval authority and preserve a readable English source", () => {
  expect(review?.PaymentReviewPanel).toBeTypeOf("function");
  const View = review!.PaymentReviewPanel;
  const props = {
    revision,
    locale: "en" as const,
    canEdit: false,
    busy: false,
    accounts: [],
    mutate: () => {},
  };
  expect(renderToStaticMarkup(<View {...props} />)).not.toContain(
    "data-payment-approve",
  );
  const permitted = {
    ...revision,
    reviews: revision.reviews.map((r) => ({ ...r, canApprove: true })),
  };
  const html = renderToStaticMarkup(<View {...props} revision={permitted} />);
  expect(html).toContain("data-payment-approve");
  expect(html).toContain("Hosted test checkout");
});
test("publication confirmation is withheld for invalid validation and without server permission", () => {
  expect(publish?.PaymentPublishPanel).toBeTypeOf("function");
  const View = publish!.PaymentPublishPanel;
  const validation = {
    schemaVersion: 1 as const,
    outcome: "SUCCESS" as const,
    kind: "VALIDATION" as const,
    revisionId: id,
    expectedPublicationId: null,
    mode: "PUBLISH" as const,
    valid: false,
    validationHash: null,
    issues: [],
    diff: [],
  };
  const props = {
    validation,
    locale: "en" as const,
    accounts: [],
    canPublish: true,
    busy: false,
    mutate: () => {},
  };
  expect(renderToStaticMarkup(<View {...props} />)).not.toContain(
    "data-payment-confirm-publication",
  );
  const valid = {
    ...validation,
    valid: true,
    validationHash: sourceHashSchema.parse("a".repeat(64)),
  };
  expect(
    renderToStaticMarkup(<View {...props} validation={valid} />),
  ).toContain("data-payment-confirm-publication");
  expect(
    renderToStaticMarkup(
      <View {...props} validation={valid} canPublish={false} />,
    ),
  ).not.toContain("data-payment-confirm-publication");
});
test("all seven configuration copy versions have exact hashes and remain unapproved drafts", () => {
  expect(copies?.paymentCopy).toBeTypeOf("function");
  expect(manifest?.paymentCopyReviews).toBeDefined();
  const hash = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  for (const locale of SUPPORTED_LOCALES) {
    const copy = copies!.paymentCopy(locale);
    expect(Object.keys(copy)).toEqual(Object.keys(copies!.paymentCopy("en")));
    expect(
      Object.values(copy).every(
        (value) => typeof value === "string" && value.trim().length > 0,
      ),
    ).toBe(true);
    expect(
      manifest!.paymentCopyReviews.find((r) => r.locale === locale),
    ).toMatchObject({
      schemaVersion: 1,
      templateVersion: "admin-payment-config-v1",
      status: "DRAFT",
      reviewer: null,
      approvedCommit: null,
      sourceHash: hash(copies!.paymentCopy("en")),
      translationHash: hash(copy),
    });
  }
});
test("publication diff exposes before and after while hiding internal translation hashes", async () => {
  const { adminPaymentConfigurationResponseSchema } =
    await import("@fan-support/contracts");
  const validation = adminPaymentConfigurationResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "VALIDATION",
    revisionId: id,
    expectedPublicationId: null,
    mode: "PUBLISH",
    valid: false,
    validationHash: null,
    issues: [],
    diff: [
      {
        kind: "CHANNEL",
        key: id,
        change: "CHANGED",
        fields: ["translations", "rolloutBasisPoints"],
        values: [
          {
            field: "translations",
            before: null,
            after: [
              {
                locale: "en",
                displayName: "Fresh channel name",
                customerHint: "Fresh channel hint",
                translatedFromSourceHash: "a".repeat(64),
              },
            ],
          },
          { field: "rolloutBasisPoints", before: 2500, after: 5000 },
        ],
      },
    ],
  });
  if (validation.outcome !== "SUCCESS" || validation.kind !== "VALIDATION")
    throw new Error("Fixture invalid");
  const View = publish!.PaymentPublishPanel;
  const html = renderToStaticMarkup(
    <View
      validation={validation}
      locale="en"
      accounts={[]}
      canPublish
      busy={false}
      mutate={() => {}}
    />,
  );
  expect(html).toContain("Fresh channel name");
  expect(html).toContain("25%");
  expect(html).toContain("50%");
  expect(html).not.toContain("a".repeat(64));
});
test("editor cards continue the page heading outline after the workspace title", async () => {
  const { PaymentEditor } = await import("./editor");
  const html = renderToStaticMarkup(
    <>
      <h1>Payment settings</h1>
      <PaymentEditor
        initial={revision.configuration}
        accounts={[]}
        locale="en"
        busy={false}
        save={() => {}}
        back={() => {}}
      />
    </>,
  );
  expect(html).toContain("<h2>Connected account 1</h2>");
  expect(html).not.toContain("<h3>");
});
