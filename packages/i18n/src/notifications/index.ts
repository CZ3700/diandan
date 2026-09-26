import {
  orderNotificationContentSchema,
  orderNotificationEventTypeSchema,
  orderNotificationRenderCommandSchema,
  orderNotificationTemplateSelectionSchema,
  supportedLocaleSchema,
  type OrderNotificationEventType,
  type OrderNotificationRenderCommand,
  type OrderNotificationTemplateSelection,
  type SupportedLocale,
} from "@fan-support/contracts";
import { assertApprovedReviews } from "./review.js";
import { templateVersionV1 } from "./v1/identity.js";
import { renderV1 } from "./v1/render.js";
import reviews from "./v2/reviews.json" with { type: "json" };
import {
  eventTemplateKeys,
  localeMaterialV2,
  templateVersionV2,
  variablesHashV2,
} from "./v2/identity.js";
import { renderV2 } from "./v2/render.js";

/**
 * v2 (ADR-019 digital support copy) is the only version new selections use. v1 stays
 * renderable for outbox retries and audit replay of messages that were selected under it.
 */
const currentIdentity = {
  templateVersion: templateVersionV2,
  localeMaterial: localeMaterialV2,
  variablesHash: variablesHashV2,
};
function rendererFor(eventType: OrderNotificationEventType, version: string) {
  if (version.startsWith("v1.") && version === templateVersionV1(eventType))
    return renderV1;
  if (version.startsWith("v2.") && version === templateVersionV2(eventType))
    return renderV2;
  throw new Error("NOTIFICATION_TEMPLATE_VERSION_UNAVAILABLE");
}

export type OrderNotificationTemplateOptions = Readonly<{
  mode: "TEST_DRAFT" | "APPROVED";
  incidentFallbackLocales?: readonly SupportedLocale[];
}>;

/** Server-only, deterministic renderer. It has no catalog, provider, clock or logging dependencies. */
export function createOrderNotificationTemplates(
  options: OrderNotificationTemplateOptions,
) {
  if (options.mode !== "TEST_DRAFT" && options.mode !== "APPROVED")
    throw new Error("NOTIFICATION_TEMPLATE_MODE_INVALID");
  if (options.mode === "APPROVED")
    assertApprovedReviews(reviews, currentIdentity);
  const incidents = new Set(
    (options.incidentFallbackLocales ?? []).map((locale) =>
      supportedLocaleSchema.parse(locale),
    ),
  );
  return Object.freeze({
    select(
      eventType: OrderNotificationEventType,
      requestedLocale: SupportedLocale,
    ): OrderNotificationTemplateSelection {
      const event = orderNotificationEventTypeSchema.parse(eventType);
      const locale = supportedLocaleSchema.parse(requestedLocale);
      const fallbackUsed = locale !== "en" && incidents.has(locale);
      return orderNotificationTemplateSelectionSchema.parse({
        schemaVersion: 1,
        eventType: event,
        requestedLocale: locale,
        resolvedLocale: fallbackUsed ? "en" : locale,
        fallbackUsed,
        templateKey: eventTemplateKeys[event],
        templateVersion: templateVersionV2(event),
        ...(fallbackUsed
          ? { fallbackReasonCode: "LOCALE_TEMPLATE_INCIDENT" }
          : {}),
      });
    },
    render(input: OrderNotificationRenderCommand) {
      const parsed = orderNotificationRenderCommandSchema.safeParse(input);
      if (!parsed.success) throw new Error("NOTIFICATION_VARIABLES_INVALID");
      const command = parsed.data;
      if (command.locale.templateKey !== eventTemplateKeys[command.eventType])
        throw new Error("NOTIFICATION_TEMPLATE_IDENTITY_INVALID");
      const render = rendererFor(
        command.eventType,
        command.locale.templateVersion,
      );
      const orderFromUrl = new URL(command.variables.orderUrl).hash.split(
        "&order=",
      )[1];
      if (
        orderFromUrl?.toLowerCase() !==
        command.variables.publicOrderId.toLowerCase()
      )
        throw new Error("NOTIFICATION_VARIABLES_INVALID");
      const content = orderNotificationContentSchema.safeParse(render(command));
      if (!content.success)
        throw new Error("NOTIFICATION_TEMPLATE_CONTENT_INVALID");
      return content.data;
    },
  });
}
