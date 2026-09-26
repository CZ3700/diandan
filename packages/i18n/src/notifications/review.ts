import {
  notificationTemplateReviewSchema,
  SUPPORTED_LOCALES,
  type OrderNotificationEventType,
  type SupportedLocale,
} from "@fan-support/contracts";
import {
  eventTemplateKeys,
  hashMaterial,
  localeMaterialV1,
  templateVersionV1,
  variablesHashV1,
} from "./v1/identity.js";

/** The material one archived or current template version binds its reviews to. */
export type TemplateIdentity = Readonly<{
  templateVersion: (eventType: OrderNotificationEventType) => string;
  localeMaterial: (
    eventType: OrderNotificationEventType,
    locale: SupportedLocale,
  ) => unknown;
  variablesHash: string;
}>;

export const identityV1: TemplateIdentity = {
  templateVersion: templateVersionV1,
  localeMaterial: localeMaterialV1,
  variablesHash: variablesHashV1,
};

/** Reviews are trusted, checked-in release evidence, never an application/request option. */
export function assertApprovedReviews(
  input: readonly unknown[],
  identity: TemplateIdentity = identityV1,
): void {
  const reviews = input.map((value) => {
    const parsed = notificationTemplateReviewSchema.safeParse(value);
    if (!parsed.success) throw new Error("NOTIFICATION_TEMPLATES_UNAPPROVED");
    return parsed.data;
  });
  for (const eventType of Object.keys(
    eventTemplateKeys,
  ) as OrderNotificationEventType[]) {
    const templateVersion = identity.templateVersion(eventType);
    const sourceHash = hashMaterial(identity.localeMaterial(eventType, "en"));
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
          hashMaterial(identity.localeMaterial(eventType, locale)) ||
        parsed.data.variablesHash !== identity.variablesHash
      )
        throw new Error("NOTIFICATION_TEMPLATES_UNAPPROVED");
    }
  }
}
