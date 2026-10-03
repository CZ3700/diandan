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
import { templateVersionV2 } from "./v2/identity.js";
import { renderV2 } from "./v2/render.js";
import reviews from "./v3/reviews.json" with { type: "json" };
import {
  eventTemplateKeys,
  localeMaterialV3,
  templateVersionV3,
  variablesHashV3,
} from "./v3/identity.js";
import { renderV3 } from "./v3/render.js";

/**
 * v3 (2026-10-03 copy review) is the only version new selections use. v1 and v2 stay
 * renderable for outbox retries and audit replay of messages that were selected under them.
 */
const currentIdentity = {
  templateVersion: templateVersionV3,
  localeMaterial: localeMaterialV3,
  variablesHash: variablesHashV3,
};
function rendererFor(eventType: OrderNotificationEventType, version: string) {
  if (version.startsWith("v1.") && version === templateVersionV1(eventType))
    return renderV1;
  if (version.startsWith("v2.") && version === templateVersionV2(eventType))
    return renderV2;
  if (version.startsWith("v3.") && version === templateVersionV3(eventType))
    return renderV3;
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
        templateVersion: templateVersionV3(event),
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
