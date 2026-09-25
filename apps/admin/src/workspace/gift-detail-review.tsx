"use client";
import { Button } from "@fan-support/ui";
import {
  contentReviewResponseSchema,
  adminMutationResponseSchema,
  type ContentReviewResponse,
  type SupportedLocale,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "./client";
import { GiftDetailPreview } from "./gift-detail-preview";
import { Status, type Translate } from "./components";

type Review = Extract<ContentReviewResponse, { outcome: "SUCCESS" }>;
export type GiftDetailReviewData = Review & {
  content: Extract<Review["content"], { kind: "GIFT_DETAILS" }>;
};
export async function loadGiftDetailReview(
  client: AdminClient,
  revisionId: string,
  locale: SupportedLocale,
): Promise<GiftDetailReviewData | null> {
  try {
    const result = await client.call(
      "alias-review-read",
      {
        schemaVersion: 1,
        target: { kind: "GIFT_DETAILS", revisionId, locale },
      },
      contentReviewResponseSchema,
    );
    if (
      result.context.target.kind !== "GIFT_DETAILS" ||
      result.context.target.revisionId.toLowerCase() !==
        revisionId.toLowerCase() ||
      result.context.target.locale !== locale ||
      result.content.kind !== "GIFT_DETAILS" ||
      result.source === null
    )
      throw new AdminClientError("INVALID_RESPONSE");
    return { ...result, content: result.content };
  } catch (error) {
    if (error instanceof AdminClientError && error.code === "NOT_FOUND")
      return null;
    throw error;
  }
}
export function sendGiftDetailReview(
  client: AdminClient,
  review: GiftDetailReviewData,
  action: "submit" | "approve",
  reasonCode: string,
) {
  const { context } = review;
  return client.call(
    `alias-review-${action}`,
    {
      schemaVersion: 1,
      target: context.target,
      expectedVersion: context.sequence,
      expectedContentHash: context.contentHash,
      expectedSourceHash: context.sourceHash,
      reasonCode,
    },
    adminMutationResponseSchema,
    true,
  );
}
/** Review evidence is scoped independently of access to the full authoring snapshot. */
export function GiftDetailReview({
  review,
  actorId,
  permissions,
  blocked,
  t,
  onReview,
}: {
  review: GiftDetailReviewData;
  actorId: string;
  permissions: readonly string[];
  blocked: boolean;
  t: Translate;
  onReview: (action: "submit" | "approve") => void;
}) {
  const { context, content, source } = review;
  const actor = actorId.toLowerCase();
  const isEditor = context.editorId.toLowerCase() === actor;
  const independent =
    !isEditor && context.structureEditorId.toLowerCase() !== actor;
  const media = () => <span className="admin-muted">{t("media")}</span>;
  return (
    <section aria-label={t("detailsReview")}>
      <div className="admin-translation-columns">
        <section>
          <h3>{t("content")}</h3>
          <GiftDetailPreview
            document={content.document}
            translation={content.translation}
            renderMedia={media}
          />
        </section>
        {source &&
          context.target.kind === "GIFT_DETAILS" &&
          context.target.locale !== "en" && (
            <aside className="admin-source">
              <h3>{t("source")}</h3>
              <GiftDetailPreview
                document={content.document}
                translation={source}
                renderMedia={media}
              />
            </aside>
          )}
      </div>
      <div className="admin-actions">
        <Status value={context.status} t={t} />
        <Button
          variant="secondary"
          disabled={
            blocked ||
            context.status !== "DRAFT" ||
            !isEditor ||
            !permissions.includes("content.edit")
          }
          onClick={() => onReview("submit")}
        >
          {t("submit")}
        </Button>
        <Button
          variant="secondary"
          disabled={
            blocked ||
            context.status !== "IN_REVIEW" ||
            !independent ||
            !permissions.includes("content.translation.review")
          }
          onClick={() => onReview("approve")}
        >
          {t("detailsReview")}
        </Button>
      </div>
    </section>
  );
}
