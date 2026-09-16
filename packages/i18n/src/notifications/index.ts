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
import reviews from "./v1/reviews.json" with { type: "json" };
import { eventTemplateKeys, templateVersionV1 } from "./v1/identity.js";
import { renderV1 } from "./v1/render.js";

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
  if (options.mode === "APPROVED") assertApprovedReviews(reviews);
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
        templateVersion: templateVersionV1(event),
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
      if (
        command.locale.templateVersion !== templateVersionV1(command.eventType)
      )
        throw new Error("NOTIFICATION_TEMPLATE_VERSION_UNAVAILABLE");
      const orderFromUrl = new URL(command.variables.orderUrl).hash.split(
        "&order=",
      )[1];
      if (
        orderFromUrl?.toLowerCase() !==
        command.variables.publicOrderId.toLowerCase()
      )
        throw new Error("NOTIFICATION_VARIABLES_INVALID");
      const content = orderNotificationContentSchema.safeParse(
        renderV1(command),
      );
      if (!content.success)
        throw new Error("NOTIFICATION_TEMPLATE_CONTENT_INVALID");
      return content.data;
    },
  });
}
