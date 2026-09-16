import {
  notificationTemplateReviewSchema,
  SUPPORTED_LOCALES,
  type OrderNotificationEventType,
} from "@fan-support/contracts";
import {
  eventTemplateKeys,
  hashMaterial,
  localeMaterialV1,
  templateVersionV1,
  variablesHashV1,
} from "./v1/identity.js";

/** Reviews are trusted, checked-in release evidence, never an application/request option. */
export function assertApprovedReviews(input: readonly unknown[]): void {
  const reviews = input.map((value) => {
    const parsed = notificationTemplateReviewSchema.safeParse(value);
    if (!parsed.success) throw new Error("NOTIFICATION_TEMPLATES_UNAPPROVED");
    return parsed.data;
  });
  for (const eventType of Object.keys(
    eventTemplateKeys,
  ) as OrderNotificationEventType[]) {
    const templateVersion = templateVersionV1(eventType);
    const sourceHash = hashMaterial(localeMaterialV1(eventType, "en"));
    for (const locale of SUPPORTED_LOCALES) {
      const matches = reviews.filter(
        (review) =>
          review.templateVersion === templateVersion &&
          review.locale === locale,
      );
      const parsed = notificationTemplateReviewSchema.safeParse(matches[0]);
      if (
        matches.length !== 1 ||
        !parsed.success ||
        parsed.data.status !== "APPROVED" ||
        !parsed.data.reviewer?.trim() ||
        !parsed.data.translator.trim() ||
        parsed.data.sourceHash !== sourceHash ||
        parsed.data.translationHash !==
          hashMaterial(localeMaterialV1(eventType, locale)) ||
        parsed.data.variablesHash !== variablesHashV1
      )
        throw new Error("NOTIFICATION_TEMPLATES_UNAPPROVED");
    }
  }
}
